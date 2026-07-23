import { mockClient } from 'aws-sdk-client-mock';
import {
  Route53Client,
  CreateHealthCheckCommand,
  DeleteHealthCheckCommand,
  GetHealthCheckStatusCommand,
  ListHealthChecksCommand,
  ChangeTagsForResourceCommand,
  ListTagsForResourcesCommand,
  ChangeResourceRecordSetsCommand,
  ListResourceRecordSetsCommand
} from '@aws-sdk/client-route-53';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  BatchGetCommand
} from '@aws-sdk/lib-dynamodb';
import { handler } from '../failover-admin';

const route53Mock = mockClient(Route53Client);
const ddbMock = mockClient(DynamoDBDocumentClient);

const CONFIG_TABLE = 'test-routing-config';
const REGISTRY_TABLE = 'test-cell-registry';
const DOMAIN = 'cells.example.com';
const FQDN_DOT = `failover.${DOMAIN}.`;

const apiEvent = (method: string, path: string, body?: unknown, pathParameters?: Record<string, string>) =>
  ({
    httpMethod: method,
    path,
    body: body === undefined ? null : JSON.stringify(body),
    pathParameters: pathParameters ?? null,
    requestContext: { apiId: 'testapi' }
  } as any);

const VOTER_IDS = ['hc-v1', 'hc-v2', 'hc-v3', 'hc-v4', 'hc-v5'];

const quorumState = (overrides: Record<string, unknown> = {}) => ({
  configId: 'QUORUM_DEMO',
  armed: true,
  threshold: 3,
  voterHealthCheckIds: [...VOTER_IDS],
  parentHealthCheckId: 'hc-parent',
  host: `api.${DOMAIN}`,
  pathPrefix: '',
  armedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  lastParentStatus: 'off',
  storedControl: { on: false, version: 126, since: '2026-01-01T10:00:00Z' },
  logVersions: [126],
  wired: false,
  ...overrides
});

const voteItem = (i: number) => ({ configId: `QUORUM_VOTE#${i}`, i });
const brokenItem = (i: number) => ({ configId: `QUORUM_BROKEN#${i}`, i });
const logItem = (version: number, decision: 'on' | 'off') => ({
  configId: `QUORUM_LOG#${String(version).padStart(8, '0')}`,
  version,
  decision,
  healthyChildren: decision === 'on' ? 5 : 0,
  threshold: 3,
  at: '2026-01-01T10:00:00Z'
});

const observations = (healthy: number, total = 16) => ({
  HealthCheckObservations: Array.from({ length: total }, (_, k) => ({
    Region: 'us-east-1',
    StatusReport: {
      Status: k < healthy ? 'Success: HTTP Status Code 200, OK' : 'Failure: HTTP Status Code 503'
    }
  })) as any
});

const primaryFailoverRecord = (healthCheckId: string) => ({
  Name: FQDN_DOT,
  Type: 'CNAME',
  TTL: 15,
  SetIdentifier: 'primary',
  Failover: 'PRIMARY',
  HealthCheckId: healthCheckId,
  ResourceRecords: [{ Value: 'cell-a.execute-api.us-east-1.amazonaws.com' }]
});

function stubQuorumGet(state: Record<string, unknown> | undefined) {
  ddbMock
    .on(GetCommand, { TableName: CONFIG_TABLE, Key: { configId: 'QUORUM_DEMO' } })
    .resolves(state ? { Item: state } : {});
}

function stubBatch(items: Record<string, unknown>[]) {
  ddbMock.on(BatchGetCommand).resolves({ Responses: { [CONFIG_TABLE]: items } });
}

beforeEach(() => {
  route53Mock.reset();
  ddbMock.reset();
  process.env.CELL_REGISTRY_TABLE = REGISTRY_TABLE;
  process.env.ROUTING_CONFIG_TABLE = CONFIG_TABLE;
  process.env.HOSTED_ZONE_ID = 'Z123EXAMPLE';
  process.env.DOMAIN_NAME = DOMAIN;
  process.env.PROJECT_NAME = 'cell-demo';
  process.env.AWS_REGION = 'us-east-1';

  ddbMock.on(GetCommand).resolves({});
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(DeleteCommand).resolves({});
  ddbMock.on(BatchGetCommand).resolves({ Responses: { [CONFIG_TABLE]: [] } });
  route53Mock.on(ChangeTagsForResourceCommand).resolves({});
  route53Mock.on(ChangeResourceRecordSetsCommand).resolves({});
  route53Mock.on(DeleteHealthCheckCommand).resolves({});
  route53Mock.on(ListHealthChecksCommand).resolves({ HealthChecks: [], IsTruncated: false });
  route53Mock.on(ListTagsForResourcesCommand).resolves({ ResourceTagSets: [] });
  route53Mock.on(ListResourceRecordSetsCommand).resolves({ ResourceRecordSets: [] });
});

describe('POST /admin/quorum/arm', () => {
  function stubCreates() {
    let mock = route53Mock.on(CreateHealthCheckCommand);
    for (const id of VOTER_IDS) {
      mock = mock.resolvesOnce({ HealthCheck: { Id: id } as any });
    }
    mock.resolvesOnce({ HealthCheck: { Id: 'hc-parent' } as any });
  }

  test('creates 5 vote items, 5 HTTPS children, then the CALCULATED parent — and seeds the decision log at v126', async () => {
    stubCreates();

    const result = await handler(apiEvent('POST', '/admin/quorum/arm', {}));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.armed).toBe(true);
    expect(body.threshold).toBe(3);
    expect(body.voterHealthCheckIds).toEqual(VOTER_IDS);
    expect(body.parentHealthCheckId).toBe('hc-parent');
    expect(body.voteStatusUrl).toBe(`https://api.${DOMAIN}/vote-status/{i}`);
    expect(body.storedControl).toEqual({ on: false, version: 126, since: expect.any(String) });
    // Honest two-component cost
    expect(body.estimatedCost.healthChecksPerHourUsd).toBeCloseTo(0.0185, 3);
    expect(body.estimatedCost.checkerTrafficPerHourUsd).toBeCloseTo(0.0945, 3);
    expect(body.estimatedCost.ratePerHourUsd).toBeCloseTo(0.113, 3);

    // All five vote items are created ON
    const votePuts = ddbMock.commandCalls(PutCommand)
      .map((c) => c.args[0].input.Item!.configId)
      .filter((id) => String(id).startsWith('QUORUM_VOTE#'));
    expect(votePuts).toEqual(['QUORUM_VOTE#1', 'QUORUM_VOTE#2', 'QUORUM_VOTE#3', 'QUORUM_VOTE#4', 'QUORUM_VOTE#5']);

    // 5 HTTPS children then 1 CALCULATED parent, in that order
    const creates = route53Mock.commandCalls(CreateHealthCheckCommand);
    expect(creates).toHaveLength(6);
    creates.slice(0, 5).forEach((c, idx) => {
      expect(c.args[0].input.HealthCheckConfig).toMatchObject({
        Type: 'HTTPS',
        FullyQualifiedDomainName: `api.${DOMAIN}`,
        Port: 443,
        ResourcePath: `/vote-status/${idx + 1}`,
        RequestInterval: 10,
        FailureThreshold: 1,
        EnableSNI: true
      });
      expect(c.args[0].input.CallerReference).toMatch(
        new RegExp(`^cell-demo-quorum-voter-${idx + 1}-\\d+$`)
      );
    });
    const parentConfig = creates[5].args[0].input.HealthCheckConfig!;
    expect(parentConfig).toMatchObject({
      Type: 'CALCULATED',
      ChildHealthChecks: VOTER_IDS,
      HealthThreshold: 3,
      Inverted: false
    });
    // CALCULATED checks take NO interval or endpoint
    expect(parentConfig.RequestInterval).toBeUndefined();
    expect(parentConfig.FullyQualifiedDomainName).toBeUndefined();

    // Tag prefix is what the disarm sweep keys on
    const tagValues = route53Mock.commandCalls(ChangeTagsForResourceCommand)
      .map((c) => c.args[0].input.AddTags![0].Value);
    expect(tagValues).toEqual([
      'cell-demo-quorum-voter-1', 'cell-demo-quorum-voter-2', 'cell-demo-quorum-voter-3',
      'cell-demo-quorum-voter-4', 'cell-demo-quorum-voter-5', 'cell-demo-quorum-parent'
    ]);

    // Decision-log seed: zero-padded v126, decision off
    const logPut = ddbMock.commandCalls(PutCommand)
      .find((c) => c.args[0].input.Item!.configId === 'QUORUM_LOG#00000126');
    expect(logPut).toBeDefined();
    expect(logPut!.args[0].input.Item).toMatchObject({ version: 126, decision: 'off', threshold: 3 });

    // State row
    const statePut = ddbMock.commandCalls(PutCommand)
      .find((c) => c.args[0].input.Item!.configId === 'QUORUM_DEMO');
    expect(statePut!.args[0].input.Item).toMatchObject({
      armed: true,
      threshold: 3,
      voterHealthCheckIds: VOTER_IDS,
      parentHealthCheckId: 'hc-parent',
      storedControl: { on: false, version: 126 },
      logVersions: [126],
      wired: false
    });
  });

  test('without a custom domain, targets the API Gateway hostname with the /prod prefix (no zone gate)', async () => {
    delete process.env.DOMAIN_NAME;
    delete process.env.HOSTED_ZONE_ID;
    stubCreates();

    const result = await handler(apiEvent('POST', '/admin/quorum/arm', {}));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.voteStatusUrl).toBe('https://testapi.execute-api.us-east-1.amazonaws.com/prod/vote-status/{i}');
    const first = route53Mock.commandCalls(CreateHealthCheckCommand)[0].args[0].input.HealthCheckConfig!;
    expect(first.FullyQualifiedDomainName).toBe('testapi.execute-api.us-east-1.amazonaws.com');
    expect(first.ResourcePath).toBe('/prod/vote-status/1');
  });

  test('honors a custom threshold and rejects invalid ones', async () => {
    stubCreates();
    const ok = await handler(apiEvent('POST', '/admin/quorum/arm', { threshold: 4 }));
    expect(ok.statusCode).toBe(200);
    const parent = route53Mock.commandCalls(CreateHealthCheckCommand)[5].args[0].input.HealthCheckConfig!;
    expect(parent.HealthThreshold).toBe(4);

    for (const threshold of [0, 6, 2.5, 'three']) {
      const bad = await handler(apiEvent('POST', '/admin/quorum/arm', { threshold }));
      expect(bad.statusCode).toBe(400);
    }
  });

  test('rolls back children and vote items when the parent creation fails', async () => {
    let mock = route53Mock.on(CreateHealthCheckCommand);
    for (const id of VOTER_IDS) {
      mock = mock.resolvesOnce({ HealthCheck: { Id: id } as any });
    }
    mock.rejectsOnce(new Error('Throttling'));

    const result = await handler(apiEvent('POST', '/admin/quorum/arm', {}));

    expect(result.statusCode).toBe(500);
    const deleted = route53Mock.commandCalls(DeleteHealthCheckCommand)
      .map((c) => c.args[0].input.HealthCheckId);
    expect(deleted).toEqual(VOTER_IDS);

    const itemDeletes = ddbMock.commandCalls(DeleteCommand).map((c) => c.args[0].input.Key!.configId);
    for (let i = 1; i <= 5; i++) {
      expect(itemDeletes).toContain(`QUORUM_VOTE#${i}`);
    }
    // No state row was ever written
    const statePuts = ddbMock.commandCalls(PutCommand)
      .filter((c) => c.args[0].input.Item!.configId === 'QUORUM_DEMO');
    expect(statePuts).toHaveLength(0);
  });

  test('re-arm tears the previous arm down first (parent deleted before children, before new creates)', async () => {
    stubQuorumGet(quorumState());
    stubCreates();

    const result = await handler(apiEvent('POST', '/admin/quorum/arm', {}));
    expect(result.statusCode).toBe(200);

    const deletes = route53Mock.commandCalls(DeleteHealthCheckCommand)
      .map((c) => c.args[0].input.HealthCheckId);
    expect(deletes[0]).toBe('hc-parent'); // parent FIRST
    expect(deletes).toEqual(expect.arrayContaining(VOTER_IDS));

    const calls = route53Mock.calls();
    const lastDeleteIdx = calls.map((c) => c.args[0] instanceof DeleteHealthCheckCommand).lastIndexOf(true);
    const firstCreateIdx = calls.findIndex((c) => c.args[0] instanceof CreateHealthCheckCommand);
    expect(lastDeleteIdx).toBeGreaterThanOrEqual(0);
    expect(lastDeleteIdx).toBeLessThan(firstCreateIdx);
  });
});

describe('POST /admin/quorum/vote and /break-voter', () => {
  test('vote on creates QUORUM_VOTE#{i}; vote off deletes it', async () => {
    stubQuorumGet(quorumState());

    const on = await handler(apiEvent('POST', '/admin/quorum/vote', { i: 2, on: true }));
    expect(on.statusCode).toBe(200);
    const put = ddbMock.commandCalls(PutCommand)
      .find((c) => c.args[0].input.Item!.configId === 'QUORUM_VOTE#2');
    expect(put).toBeDefined();

    const off = await handler(apiEvent('POST', '/admin/quorum/vote', { i: 2, on: false }));
    expect(off.statusCode).toBe(200);
    const del = ddbMock.commandCalls(DeleteCommand)
      .find((c) => c.args[0].input.Key!.configId === 'QUORUM_VOTE#2');
    expect(del).toBeDefined();
  });

  test('break-voter creates/deletes the SEPARATE QUORUM_BROKEN#{i} item', async () => {
    stubQuorumGet(quorumState());

    await handler(apiEvent('POST', '/admin/quorum/break-voter', { i: 4, broken: true }));
    const put = ddbMock.commandCalls(PutCommand)
      .find((c) => c.args[0].input.Item!.configId === 'QUORUM_BROKEN#4');
    expect(put).toBeDefined();

    await handler(apiEvent('POST', '/admin/quorum/break-voter', { i: 4, broken: false }));
    const del = ddbMock.commandCalls(DeleteCommand)
      .find((c) => c.args[0].input.Key!.configId === 'QUORUM_BROKEN#4');
    expect(del).toBeDefined();
  });

  test('409 when not armed; 400 on bad input', async () => {
    stubQuorumGet(undefined);
    const notArmed = await handler(apiEvent('POST', '/admin/quorum/vote', { i: 1, on: true }));
    expect(notArmed.statusCode).toBe(409);

    stubQuorumGet(quorumState());
    for (const body of [{ i: 0, on: true }, { i: 6, on: true }, { i: 1 }, { on: true }]) {
      const bad = await handler(apiEvent('POST', '/admin/quorum/vote', body));
      expect(bad.statusCode).toBe(400);
    }
  });
});

describe('GET /vote-status/{i} (public checker target)', () => {
  test('200 when the vote item exists', async () => {
    stubBatch([voteItem(3)]);
    const result = await handler(apiEvent('GET', '/vote-status/3', undefined, { i: '3' }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({ i: 3, vote: 'on' });

    // Single BatchGet with exactly the vote + broken keys
    const batches = ddbMock.commandCalls(BatchGetCommand);
    expect(batches).toHaveLength(1);
    expect(batches[0].args[0].input.RequestItems![CONFIG_TABLE].Keys).toEqual([
      { configId: 'QUORUM_VOTE#3' },
      { configId: 'QUORUM_BROKEN#3' }
    ]);
  });

  test('503 when the vote is off (also the disarmed-at-rest answer)', async () => {
    stubBatch([]);
    const result = await handler(apiEvent('GET', '/vote-status/1', undefined, { i: '1' }));
    expect(result.statusCode).toBe(503);
    expect(JSON.parse(result.body)).toMatchObject({ i: 1, vote: 'off' });
  });

  test('500 when the voter is broken, even if the vote is on', async () => {
    stubBatch([voteItem(2), brokenItem(2)]);
    const result = await handler(apiEvent('GET', '/vote-status/2', undefined, { i: '2' }));
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toMatchObject({ i: 2, broken: true });
  });

  test('404 for out-of-range or non-numeric indexes', async () => {
    for (const i of ['0', '6', 'abc', '-1']) {
      const result = await handler(apiEvent('GET', `/vote-status/${i}`, undefined, { i }));
      expect(result.statusCode).toBe(404);
    }
    expect(ddbMock.commandCalls(BatchGetCommand)).toHaveLength(0);
  });

  test('works without a configured domain (dispatches before the zone gate)', async () => {
    delete process.env.DOMAIN_NAME;
    delete process.env.HOSTED_ZONE_ID;
    stubBatch([voteItem(1)]);
    const result = await handler(apiEvent('GET', '/vote-status/1', undefined, { i: '1' }));
    expect(result.statusCode).toBe(200);
  });
});

describe('GET /admin/quorum/status', () => {
  test('unarmed status is cheap and advertises the honest two-component cost', async () => {
    stubQuorumGet(undefined);
    const result = await handler(apiEvent('GET', '/admin/quorum/status'));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.armed).toBe(false);
    expect(body.whatArmingCreates.healthChecksPerHourUsd).toBeCloseTo(0.0185, 3);
    expect(body.whatArmingCreates.checkerTrafficPerHourUsd).toBeCloseTo(0.0945, 3);
    expect(body.whatArmingCreates.ratePerHourUsd).toBeCloseTo(0.113, 3);
    expect(route53Mock.calls()).toHaveLength(0);
  });

  test('works without a configured domain (dispatches before the zone gate)', async () => {
    delete process.env.DOMAIN_NAME;
    delete process.env.HOSTED_ZONE_ID;
    stubQuorumGet(undefined);
    const result = await handler(apiEvent('GET', '/admin/quorum/status'));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).armed).toBe(false);
  });

  function stubObservations(healthyPerVoter: number[]) {
    VOTER_IDS.forEach((id, idx) => {
      route53Mock
        .on(GetHealthCheckStatusCommand, { HealthCheckId: id })
        .resolves(observations(healthyPerVoter[idx]));
    });
  }

  test('computes the parent from child observations and flips the stored control ONLY on a genuine transition', async () => {
    stubQuorumGet(quorumState()); // storedControl off @ v126
    stubBatch([voteItem(1), voteItem(2), voteItem(3), voteItem(4), voteItem(5), logItem(126, 'off')]);
    stubObservations([16, 16, 16, 0, 0]); // 3 healthy of 5, threshold 3

    const result = await handler(apiEvent('GET', '/admin/quorum/status'));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(Array.isArray(body.voters)).toBe(true); // ARRAYS, never keyed objects
    expect(body.voters.map((v: any) => v.i)).toEqual([1, 2, 3, 4, 5]);
    expect(body.voters[0]).toMatchObject({
      i: 1, on: true, broken: false, healthCheckId: 'hc-v1',
      status: 'healthy', healthyCount: 16, checkersReporting: 16
    });
    expect(body.parent).toMatchObject({
      healthCheckId: 'hc-parent',
      threshold: 3,
      healthyChildren: 3,
      status: 'healthy'
    });
    // Honest label: the parent's status is computed, not fetched
    expect(body.parent.computedFrom).toMatch(/computed/i);

    // Transition off→on committed v127
    expect(body.storedControl).toEqual({ on: true, version: 127, since: expect.any(String) });
    const logPut = ddbMock.commandCalls(PutCommand)
      .find((c) => c.args[0].input.Item!.configId === 'QUORUM_LOG#00000127');
    expect(logPut!.args[0].input.Item).toMatchObject({
      version: 127, decision: 'on', healthyChildren: 3, threshold: 3
    });
    const statePut = ddbMock.commandCalls(PutCommand)
      .find((c) => c.args[0].input.Item!.configId === 'QUORUM_DEMO');
    expect(statePut!.args[0].input.Item).toMatchObject({
      lastParentStatus: 'on',
      storedControl: { on: true, version: 127 },
      logVersions: [126, 127]
    });

    // Decision log newest-first
    expect(Array.isArray(body.decisionLog)).toBe(true);
    expect(body.decisionLog.map((e: any) => e.version)).toEqual([127, 126]);
    expect(body.decisionLog[0].decision).toBe('on');

    // Cost carries both components plus accrual
    expect(body.estimatedCost.healthChecksPerHourUsd).toBeCloseTo(0.0185, 3);
    expect(body.estimatedCost.checkerTrafficPerHourUsd).toBeCloseTo(0.0945, 3);
    expect(body.estimatedCost.armedMinutes).toBe(30);
    expect(body.estimatedCost.accruedUsd).toBeGreaterThan(0);
  });

  test('NO writes when the parent state matches the stored control', async () => {
    stubQuorumGet(quorumState({
      storedControl: { on: true, version: 127, since: '2026-01-01T10:05:00Z' },
      lastParentStatus: 'on',
      logVersions: [126, 127]
    }));
    stubBatch([
      voteItem(1), voteItem(2), voteItem(3), voteItem(4), voteItem(5),
      logItem(126, 'off'), logItem(127, 'on')
    ]);
    stubObservations([16, 16, 16, 16, 16]);

    const result = await handler(apiEvent('GET', '/admin/quorum/status'));
    const body = JSON.parse(result.body);

    expect(body.storedControl.version).toBe(127);
    expect(body.decisionLog.map((e: any) => e.version)).toEqual([127, 126]);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  test('appends the drop-below-threshold transition with the observed healthyChildren', async () => {
    stubQuorumGet(quorumState({
      storedControl: { on: true, version: 127, since: '2026-01-01T10:05:00Z' },
      lastParentStatus: 'on',
      logVersions: [126, 127]
    }));
    stubBatch([voteItem(4), voteItem(5), logItem(126, 'off'), logItem(127, 'on')]);
    stubObservations([0, 0, 0, 16, 16]); // 2 healthy < threshold 3

    const result = await handler(apiEvent('GET', '/admin/quorum/status'));
    const body = JSON.parse(result.body);

    expect(body.parent.status).toBe('unhealthy');
    expect(body.storedControl).toMatchObject({ on: false, version: 128 });
    const logPut = ddbMock.commandCalls(PutCommand)
      .find((c) => c.args[0].input.Item!.configId === 'QUORUM_LOG#00000128');
    expect(logPut!.args[0].input.Item).toMatchObject({ decision: 'off', healthyChildren: 2 });
    expect(body.decisionLog.map((e: any) => e.version)).toEqual([128, 127, 126]);
  });

  test('caps the decision log at the 20 newest versions in one BatchGet', async () => {
    const versions = Array.from({ length: 25 }, (_, k) => 126 + k); // 126..150
    stubQuorumGet(quorumState({
      storedControl: { on: false, version: 150, since: '2026-01-01T10:05:00Z' },
      logVersions: versions
    }));
    stubBatch(versions.slice(5).map((v) => logItem(v, 'off')));
    stubObservations([0, 0, 0, 0, 0]); // stays off — no transition

    const result = await handler(apiEvent('GET', '/admin/quorum/status'));
    const body = JSON.parse(result.body);

    const batchKeys = ddbMock.commandCalls(BatchGetCommand)[0].args[0].input
      .RequestItems![CONFIG_TABLE].Keys!.map((k) => k.configId as string);
    expect(batchKeys).toHaveLength(10 + 20); // 5 votes + 5 broken + 20 logs
    expect(batchKeys).toContain('QUORUM_LOG#00000150');
    expect(batchKeys).toContain('QUORUM_LOG#00000131');
    expect(batchKeys).not.toContain('QUORUM_LOG#00000130');

    expect(body.decisionLog).toHaveLength(20);
    expect(body.decisionLog[0].version).toBe(150);
    expect(body.decisionLog[19].version).toBe(131);
  });

  test('wire truth comes from the actual PRIMARY record HealthCheckId', async () => {
    stubQuorumGet(quorumState({
      wired: true,
      originalPrimaryHealthCheckId: 'hc-fo-1',
      storedControl: { on: false, version: 126, since: '2026-01-01T10:00:00Z' }
    }));
    ddbMock
      .on(GetCommand, { TableName: CONFIG_TABLE, Key: { configId: 'FAILOVER_DEMO' } })
      .resolves({ Item: { configId: 'FAILOVER_DEMO', armed: true } });
    stubBatch([logItem(126, 'off')]);
    stubObservations([0, 0, 0, 0, 0]);
    route53Mock.on(ListResourceRecordSetsCommand).resolves({
      ResourceRecordSets: [primaryFailoverRecord('hc-parent')] as any
    });

    const result = await handler(apiEvent('GET', '/admin/quorum/status'));
    const body = JSON.parse(result.body);

    expect(body.wire).toEqual({
      wired: true,
      failoverArmed: true,
      recordHealthCheckId: 'hc-parent',
      pointsAtParent: true
    });
  });
});

describe('POST /admin/quorum/wire', () => {
  test('409 when the failover demo is not armed', async () => {
    stubQuorumGet(quorumState());
    ddbMock
      .on(GetCommand, { TableName: CONFIG_TABLE, Key: { configId: 'FAILOVER_DEMO' } })
      .resolves({});

    const result = await handler(apiEvent('POST', '/admin/quorum/wire', { on: true }));

    expect(result.statusCode).toBe(409);
    expect(route53Mock.commandCalls(ChangeResourceRecordSetsCommand)).toHaveLength(0);
  });

  test('wire on UPSERTs the PRIMARY record to the parent and saves the original id', async () => {
    stubQuorumGet(quorumState());
    ddbMock
      .on(GetCommand, { TableName: CONFIG_TABLE, Key: { configId: 'FAILOVER_DEMO' } })
      .resolves({ Item: { configId: 'FAILOVER_DEMO', armed: true } });
    route53Mock.on(ListResourceRecordSetsCommand).resolves({
      ResourceRecordSets: [primaryFailoverRecord('hc-fo-1')] as any
    });

    const result = await handler(apiEvent('POST', '/admin/quorum/wire', { on: true }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body).toMatchObject({
      wired: true,
      recordHealthCheckId: 'hc-parent',
      originalPrimaryHealthCheckId: 'hc-fo-1'
    });

    const change = route53Mock.commandCalls(ChangeResourceRecordSetsCommand)[0].args[0].input
      .ChangeBatch!.Changes![0];
    expect(change.Action).toBe('UPSERT');
    expect(change.ResourceRecordSet!.HealthCheckId).toBe('hc-parent');
    expect(change.ResourceRecordSet!.SetIdentifier).toBe('primary');

    const statePut = ddbMock.commandCalls(PutCommand)
      .find((c) => c.args[0].input.Item!.configId === 'QUORUM_DEMO');
    expect(statePut!.args[0].input.Item).toMatchObject({
      wired: true,
      originalPrimaryHealthCheckId: 'hc-fo-1'
    });
  });

  test('wire off restores the original HealthCheckId and clears the wire fields', async () => {
    stubQuorumGet(quorumState({ wired: true, originalPrimaryHealthCheckId: 'hc-fo-1' }));
    route53Mock.on(ListResourceRecordSetsCommand).resolves({
      ResourceRecordSets: [primaryFailoverRecord('hc-parent')] as any
    });

    const result = await handler(apiEvent('POST', '/admin/quorum/wire', { on: false }));

    expect(result.statusCode).toBe(200);
    const change = route53Mock.commandCalls(ChangeResourceRecordSetsCommand)[0].args[0].input
      .ChangeBatch!.Changes![0];
    expect(change.ResourceRecordSet!.HealthCheckId).toBe('hc-fo-1');

    const statePut = ddbMock.commandCalls(PutCommand)
      .find((c) => c.args[0].input.Item!.configId === 'QUORUM_DEMO');
    expect(statePut!.args[0].input.Item!.wired).toBe(false);
    expect(statePut!.args[0].input.Item!.originalPrimaryHealthCheckId).toBeUndefined();
  });

  test('503 without a configured domain (the ONE quorum route that needs the zone)', async () => {
    delete process.env.DOMAIN_NAME;
    delete process.env.HOSTED_ZONE_ID;
    const result = await handler(apiEvent('POST', '/admin/quorum/wire', { on: true }));
    expect(result.statusCode).toBe(503);
  });
});

describe('POST /admin/failover/disarm clears stale quorum wire state (correction 10)', () => {
  test('a wired quorum demo loses its wire flags when failover disarms', async () => {
    ddbMock
      .on(GetCommand, { TableName: CONFIG_TABLE, Key: { configId: 'FAILOVER_DEMO' } })
      .resolves({ Item: { configId: 'FAILOVER_DEMO', armed: true, primaryHealthCheckId: 'hc-fo-1', secondaryHealthCheckId: 'hc-fo-2' } });
    stubQuorumGet(quorumState({ wired: true, originalPrimaryHealthCheckId: 'hc-fo-1' }));

    const result = await handler(apiEvent('POST', '/admin/failover/disarm'));

    expect(result.statusCode).toBe(200);
    const statePut = ddbMock.commandCalls(PutCommand)
      .find((c) => c.args[0].input.Item!.configId === 'QUORUM_DEMO');
    expect(statePut).toBeDefined();
    expect(statePut!.args[0].input.Item!.wired).toBe(false);
    expect(statePut!.args[0].input.Item!.originalPrimaryHealthCheckId).toBeUndefined();
    // The quorum demo itself stays armed — only the wire is cleared
    expect(statePut!.args[0].input.Item!.armed).toBe(true);
  });
});

describe('POST /admin/quorum/disarm', () => {
  test('order: restore wired record → parent → children → sweep → items → state row', async () => {
    stubQuorumGet(quorumState({
      wired: true,
      originalPrimaryHealthCheckId: 'hc-fo-1',
      logVersions: [126, 127]
    }));
    route53Mock.on(ListResourceRecordSetsCommand).resolves({
      ResourceRecordSets: [primaryFailoverRecord('hc-parent')] as any
    });

    const result = await handler(apiEvent('POST', '/admin/quorum/disarm'));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.armed).toBe(false);
    expect(body.healthChecksDeleted).toEqual(['hc-parent', ...VOTER_IDS]);

    const calls = route53Mock.calls();
    const restoreIdx = calls.findIndex((c) => c.args[0] instanceof ChangeResourceRecordSetsCommand);
    const parentDeleteIdx = calls.findIndex(
      (c) => c.args[0] instanceof DeleteHealthCheckCommand &&
        (c.args[0].input as any).HealthCheckId === 'hc-parent'
    );
    const firstChildDeleteIdx = calls.findIndex(
      (c) => c.args[0] instanceof DeleteHealthCheckCommand &&
        (c.args[0].input as any).HealthCheckId === 'hc-v1'
    );
    const sweepIdx = calls.findIndex((c) => c.args[0] instanceof ListHealthChecksCommand);
    expect(restoreIdx).toBeGreaterThanOrEqual(0);
    expect(restoreIdx).toBeLessThan(parentDeleteIdx);
    expect(parentDeleteIdx).toBeLessThan(firstChildDeleteIdx); // parent FIRST
    expect(firstChildDeleteIdx).toBeLessThan(sweepIdx);

    // Restore put the ORIGINAL id back on the record
    const change = route53Mock.commandCalls(ChangeResourceRecordSetsCommand)[0].args[0].input
      .ChangeBatch!.Changes![0];
    expect(change.ResourceRecordSet!.HealthCheckId).toBe('hc-fo-1');

    // Items: 5 votes + 5 broken + 2 logs, then the state row LAST
    const deletes = ddbMock.commandCalls(DeleteCommand).map((c) => c.args[0].input.Key!.configId);
    for (let i = 1; i <= 5; i++) {
      expect(deletes).toContain(`QUORUM_VOTE#${i}`);
      expect(deletes).toContain(`QUORUM_BROKEN#${i}`);
    }
    expect(deletes).toContain('QUORUM_LOG#00000126');
    expect(deletes).toContain('QUORUM_LOG#00000127');
    expect(deletes[deletes.length - 1]).toBe('QUORUM_DEMO');
  });

  test('idempotent with no state: still sweeps the tag prefix, parent-first', async () => {
    stubQuorumGet(undefined);
    route53Mock.on(ListHealthChecksCommand).resolves({
      HealthChecks: [{ Id: 'hc-stray-child' }, { Id: 'hc-stray-parent' }, { Id: 'hc-other' }] as any,
      IsTruncated: false
    });
    route53Mock.on(ListTagsForResourcesCommand).resolves({
      ResourceTagSets: [
        { ResourceId: 'hc-stray-child', Tags: [{ Key: 'Name', Value: 'cell-demo-quorum-voter-2' }] },
        { ResourceId: 'hc-stray-parent', Tags: [{ Key: 'Name', Value: 'cell-demo-quorum-parent' }] },
        { ResourceId: 'hc-other', Tags: [{ Key: 'Name', Value: 'cell-demo-failover-cell-a' }] }
      ] as any
    });

    const result = await handler(apiEvent('POST', '/admin/quorum/disarm'));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    // Parent-first sweep; the failover-tagged check is NOT touched here
    expect(body.healthChecksDeleted).toEqual(['hc-stray-parent', 'hc-stray-child']);
  });
});

describe('demo sweeper (scheduled cost dead-man switch)', () => {
  test('a {demoSweeper:true} event runs BOTH disarm cores and reports counts', async () => {
    // Unarmed everywhere: both cores are idempotent no-ops that still 200.
    stubQuorumGet(undefined);
    ddbMock.on(GetCommand, { TableName: 'routing-config-table', Key: { configId: 'FAILOVER_DEMO' } }).resolves({});
    route53Mock.on(ListHealthChecksCommand).resolves({ HealthChecks: [], IsTruncated: false });
    route53Mock.on(ListResourceRecordSetsCommand).resolves({ ResourceRecordSets: [] });

    const result = await handler({ demoSweeper: true } as any);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sweeper).toBe(true);
    expect(body.quorum).toEqual({ healthChecksDeleted: 0 });
    // Domain configured in this harness → failover core runs too.
    expect(body.failover).toMatchObject({ healthChecksDeleted: 0 });
  });

  test('sweeper never dispatches to API routes (no method/path on the event)', async () => {
    stubQuorumGet(undefined);
    ddbMock.on(GetCommand).resolves({});
    route53Mock.on(ListHealthChecksCommand).resolves({ HealthChecks: [], IsTruncated: false });
    route53Mock.on(ListResourceRecordSetsCommand).resolves({ ResourceRecordSets: [] });

    const result = await handler({ demoSweeper: true } as any);
    const body = JSON.parse(result.body);
    expect(body.error).toBeUndefined();
    expect(body.sweptAt).toBeTruthy();
  });
});
