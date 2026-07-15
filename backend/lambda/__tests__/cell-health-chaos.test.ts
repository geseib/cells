// Env must exist before the module is loaded (module-level `process.env.X!`),
// so use require() instead of a hoisted import.
process.env.CELL_ID = 'test-cell';
process.env.CELL_DATA_TABLE = 'test-cell-data';

import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

/* eslint-disable @typescript-eslint/no-var-requires */
const {
  handler,
  computeChaosExpiresAt,
  isChaosActive,
  CHAOS_DEFAULT_MINUTES,
  CHAOS_MAX_MINUTES
} = require('../cell-health');

const ddbMock = mockClient(DynamoDBDocumentClient);

const NOW = 1_750_000_000_000;
const MINUTE = 60_000;

describe('chaos expiry math', () => {
  test('defaults to 30 minutes', () => {
    expect(CHAOS_DEFAULT_MINUTES).toBe(30);
    expect(computeChaosExpiresAt(undefined, NOW)).toBe(NOW + 30 * MINUTE);
  });

  test('honors an explicit duration', () => {
    expect(computeChaosExpiresAt(10, NOW)).toBe(NOW + 10 * MINUTE);
  });

  test('caps at 120 minutes so a forgotten flag cannot wedge a cell', () => {
    expect(CHAOS_MAX_MINUTES).toBe(120);
    expect(computeChaosExpiresAt(999, NOW)).toBe(NOW + 120 * MINUTE);
    expect(computeChaosExpiresAt(120, NOW)).toBe(NOW + 120 * MINUTE);
  });

  test('zero, negative, and non-numeric durations fall back to the default', () => {
    expect(computeChaosExpiresAt(0, NOW)).toBe(NOW + 30 * MINUTE);
    expect(computeChaosExpiresAt(-5, NOW)).toBe(NOW + 30 * MINUTE);
    expect(computeChaosExpiresAt('60' as any, NOW)).toBe(NOW + 30 * MINUTE);
  });

  test('isChaosActive: active only when enabled and unexpired', () => {
    const item = { pk: 'CHAOS', sk: 'test-cell', enabled: true, expiresAt: NOW + MINUTE, setAt: '' };
    expect(isChaosActive(item, NOW)).toBe(true);
    expect(isChaosActive({ ...item, expiresAt: NOW - 1 }, NOW)).toBe(false); // expired
    expect(isChaosActive({ ...item, expiresAt: NOW }, NOW)).toBe(false); // boundary: expired
    expect(isChaosActive({ ...item, enabled: false }, NOW)).toBe(false);
    expect(isChaosActive(undefined, NOW)).toBe(false);
  });
});

describe('GET /health chaos short-circuit', () => {
  beforeEach(() => {
    ddbMock.reset();
    ddbMock.on(UpdateCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(DeleteCommand).resolves({});
  });

  const healthEvent = { httpMethod: 'GET', path: '/health' };

  test('returns 503 with chaos details while an unexpired CHAOS item exists', async () => {
    const expiresAt = Date.now() + 10 * MINUTE;
    ddbMock.on(GetCommand).resolves({
      Item: { pk: 'CHAOS', sk: 'test-cell', enabled: true, expiresAt, setAt: 'x' }
    });

    const result = await handler(healthEvent);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(503);
    expect(body.status).toBe('failing (chaos)');
    expect(body.checks.chaos).toBe(false);
    expect(body.chaos).toEqual({ enabled: true, expiresAt });
  });

  test('an expired CHAOS item is treated as absent (code-honored expiry — no table TTL)', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { pk: 'CHAOS', sk: 'test-cell', enabled: true, expiresAt: Date.now() - 1, setAt: 'x' }
    });

    const result = await handler(healthEvent);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.status).toBe('healthy');
    expect(body.chaos).toEqual({ enabled: false });
  });

  test('POST /chaos {enabled:true} writes the item with a capped expiry', async () => {
    const before = Date.now();
    const result = await handler({
      httpMethod: 'POST',
      path: '/chaos',
      body: JSON.stringify({ enabled: true, durationMinutes: 999 })
    });
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.chaos.enabled).toBe(true);
    expect(body.chaos.expiresAt).toBeLessThanOrEqual(Date.now() + 120 * MINUTE);
    expect(body.chaos.expiresAt).toBeGreaterThanOrEqual(before + 120 * MINUTE);

    const put = ddbMock.commandCalls(PutCommand)[0].args[0].input;
    expect(put.Item).toMatchObject({ pk: 'CHAOS', sk: 'test-cell', enabled: true });
  });

  test('POST /chaos {enabled:false} deletes the item', async () => {
    const result = await handler({
      httpMethod: 'POST',
      path: '/chaos',
      body: JSON.stringify({ enabled: false })
    });
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.chaos).toEqual({ enabled: false });
    const del = ddbMock.commandCalls(DeleteCommand)[0].args[0].input;
    expect(del.Key).toEqual({ pk: 'CHAOS', sk: 'test-cell' });
  });
});
