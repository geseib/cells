import { mockClient } from 'aws-sdk-client-mock';
import {
  Route53Client,
  CreateHealthCheckCommand,
  DeleteHealthCheckCommand,
  ListHealthChecksCommand,
  ChangeTagsForResourceCommand,
  ListTagsForResourcesCommand,
  ChangeResourceRecordSetsCommand,
  ListResourceRecordSetsCommand
} from '@aws-sdk/client-route-53';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from '../failover-admin';

const route53Mock = mockClient(Route53Client);
const ddbMock = mockClient(DynamoDBDocumentClient);

const REGISTRY_TABLE = 'test-cell-registry';
const CONFIG_TABLE = 'test-routing-config';
const DOMAIN = 'cells.example.com';
const FQDN_DOT = `failover.${DOMAIN}.`;

const apiEvent = (method: string, path: string, body?: unknown) =>
  ({ httpMethod: method, path, body: body === undefined ? null : JSON.stringify(body) } as any);

const liveCell = (cellId: string) => ({
  cellId,
  region: 'us-east-1',
  availabilityZone: `${cellId}-az`,
  weight: 1,
  active: true,
  ttl: Math.floor(Date.now() / 1000) + 600,
  url: `https://${cellId}.${DOMAIN}`,
  apiUrl: `https://${cellId}.execute-api.us-east-1.amazonaws.com/prod`
});

const armedState = {
  configId: 'FAILOVER_DEMO',
  armed: true,
  primaryCellId: 'cell-a',
  secondaryCellId: 'cell-b',
  primaryApiHost: 'cell-a.execute-api.us-east-1.amazonaws.com',
  secondaryApiHost: 'cell-b.execute-api.us-east-1.amazonaws.com',
  primaryApiUrl: 'https://cell-a.execute-api.us-east-1.amazonaws.com/prod',
  secondaryApiUrl: 'https://cell-b.execute-api.us-east-1.amazonaws.com/prod',
  primaryHealthCheckId: 'hc-old-1',
  secondaryHealthCheckId: 'hc-old-2',
  armedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString()
};

const existingCnameRecordSets = [
  {
    Name: FQDN_DOT,
    Type: 'CNAME',
    TTL: 15,
    SetIdentifier: 'primary',
    Failover: 'PRIMARY',
    HealthCheckId: 'hc-old-1',
    ResourceRecords: [{ Value: 'cell-a.execute-api.us-east-1.amazonaws.com' }]
  },
  {
    Name: FQDN_DOT,
    Type: 'CNAME',
    TTL: 15,
    SetIdentifier: 'secondary',
    Failover: 'SECONDARY',
    HealthCheckId: 'hc-old-2',
    ResourceRecords: [{ Value: 'cell-b.execute-api.us-east-1.amazonaws.com' }]
  }
];

function stubRegistry() {
  ddbMock
    .on(GetCommand, { TableName: REGISTRY_TABLE, Key: { cellId: 'cell-a' } })
    .resolves({ Item: liveCell('cell-a') });
  ddbMock
    .on(GetCommand, { TableName: REGISTRY_TABLE, Key: { cellId: 'cell-b' } })
    .resolves({ Item: liveCell('cell-b') });
}

beforeEach(() => {
  route53Mock.reset();
  ddbMock.reset();
  process.env.CELL_REGISTRY_TABLE = REGISTRY_TABLE;
  process.env.ROUTING_CONFIG_TABLE = CONFIG_TABLE;
  process.env.HOSTED_ZONE_ID = 'Z123EXAMPLE';
  process.env.DOMAIN_NAME = DOMAIN;
  process.env.PROJECT_NAME = 'cell-demo';

  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(DeleteCommand).resolves({});
  route53Mock.on(ChangeTagsForResourceCommand).resolves({});
  route53Mock.on(ChangeResourceRecordSetsCommand).resolves({});
  route53Mock.on(DeleteHealthCheckCommand).resolves({});
  route53Mock.on(ListHealthChecksCommand).resolves({ HealthChecks: [], IsTruncated: false });
  route53Mock.on(ListTagsForResourcesCommand).resolves({ ResourceTagSets: [] });
});

describe('POST /admin/failover/arm', () => {
  test('happy path creates 2 tagged health checks, 2 failover CNAMEs, and the state row', async () => {
    stubRegistry();
    ddbMock.on(GetCommand, { TableName: CONFIG_TABLE }).resolves({}); // not armed
    route53Mock.on(ListResourceRecordSetsCommand).resolves({ ResourceRecordSets: [] });
    route53Mock
      .on(CreateHealthCheckCommand)
      .resolvesOnce({ HealthCheck: { Id: 'hc-1' } as any })
      .resolvesOnce({ HealthCheck: { Id: 'hc-2' } as any });

    const result = await handler(
      apiEvent('POST', '/admin/failover/arm', { primaryCellId: 'cell-a', secondaryCellId: 'cell-b' })
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.armed).toBe(true);
    expect(body.failoverFqdn).toBe(`failover.${DOMAIN}`);
    expect(body.healthCheckIds).toEqual({ primary: 'hc-1', secondary: 'hc-2' });

    // Unique, never-reused CallerReferences (timestamped, cell-scoped)
    const creates = route53Mock.commandCalls(CreateHealthCheckCommand);
    expect(creates).toHaveLength(2);
    const refs = creates.map((c) => c.args[0].input.CallerReference!);
    expect(refs[0]).toMatch(/^cell-demo-failover-cell-a-\d+$/);
    expect(refs[1]).toMatch(/^cell-demo-failover-cell-b-\d+$/);
    expect(new Set(refs).size).toBe(2);
    expect(creates[0].args[0].input.HealthCheckConfig).toMatchObject({
      Type: 'HTTPS',
      FullyQualifiedDomainName: 'cell-a.execute-api.us-east-1.amazonaws.com',
      Port: 443,
      ResourcePath: '/prod/health',
      RequestInterval: 10,
      FailureThreshold: 2,
      EnableSNI: true
    });

    // Name is a tag, not a CreateHealthCheck field
    const tagCalls = route53Mock.commandCalls(ChangeTagsForResourceCommand);
    expect(tagCalls.map((c) => c.args[0].input.AddTags![0].Value)).toEqual([
      'cell-demo-failover-cell-a',
      'cell-demo-failover-cell-b'
    ]);

    // One UPSERT batch with both CNAMEs
    const changeCalls = route53Mock.commandCalls(ChangeResourceRecordSetsCommand);
    expect(changeCalls).toHaveLength(1);
    const changes = changeCalls[0].args[0].input.ChangeBatch!.Changes!;
    expect(changes).toHaveLength(2);
    for (const change of changes) {
      expect(change.Action).toBe('UPSERT');
      expect(change.ResourceRecordSet!.Type).toBe('CNAME');
      expect(change.ResourceRecordSet!.Name).toBe(`failover.${DOMAIN}`);
      expect(change.ResourceRecordSet!.TTL).toBe(15);
    }
    expect(changes.map((c) => c.ResourceRecordSet!.SetIdentifier)).toEqual(['primary', 'secondary']);
    expect(changes.map((c) => c.ResourceRecordSet!.Failover)).toEqual(['PRIMARY', 'SECONDARY']);
    expect(changes.map((c) => c.ResourceRecordSet!.HealthCheckId)).toEqual(['hc-1', 'hc-2']);

    const put = ddbMock.commandCalls(PutCommand)[0].args[0].input;
    expect(put.TableName).toBe(CONFIG_TABLE);
    expect(put.Item).toMatchObject({
      configId: 'FAILOVER_DEMO',
      armed: true,
      primaryHealthCheckId: 'hc-1',
      secondaryHealthCheckId: 'hc-2'
    });
  });

  test('re-arm tears down the previous arm (old records and health checks) first', async () => {
    stubRegistry();
    ddbMock.on(GetCommand, { TableName: CONFIG_TABLE }).resolves({ Item: armedState });
    route53Mock.on(ListResourceRecordSetsCommand).resolves({ ResourceRecordSets: existingCnameRecordSets as any });
    route53Mock
      .on(CreateHealthCheckCommand)
      .resolvesOnce({ HealthCheck: { Id: 'hc-new-1' } as any })
      .resolvesOnce({ HealthCheck: { Id: 'hc-new-2' } as any });

    const result = await handler(
      apiEvent('POST', '/admin/failover/arm', { primaryCellId: 'cell-a', secondaryCellId: 'cell-b' })
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.healthCheckIds).toEqual({ primary: 'hc-new-1', secondary: 'hc-new-2' });

    // Old health checks were deleted
    const deleted = route53Mock.commandCalls(DeleteHealthCheckCommand)
      .map((c) => c.args[0].input.HealthCheckId);
    expect(deleted).toEqual(expect.arrayContaining(['hc-old-1', 'hc-old-2']));

    // Old records deleted before new checks were created
    const calls = route53Mock.calls();
    const deleteRecordsIdx = calls.findIndex(
      (c) =>
        c.args[0] instanceof ChangeResourceRecordSetsCommand &&
        (c.args[0].input as any).ChangeBatch.Changes[0].Action === 'DELETE'
    );
    const firstCreateIdx = calls.findIndex((c) => c.args[0] instanceof CreateHealthCheckCommand);
    expect(deleteRecordsIdx).toBeGreaterThanOrEqual(0);
    expect(deleteRecordsIdx).toBeLessThan(firstCreateIdx);
  });

  test('422 when a cell has no registered apiUrl yet', async () => {
    const cellWithoutApiUrl = { ...liveCell('cell-a'), apiUrl: undefined };
    ddbMock
      .on(GetCommand, { TableName: REGISTRY_TABLE, Key: { cellId: 'cell-a' } })
      .resolves({ Item: cellWithoutApiUrl });
    ddbMock
      .on(GetCommand, { TableName: REGISTRY_TABLE, Key: { cellId: 'cell-b' } })
      .resolves({ Item: liveCell('cell-b') });
    ddbMock.on(GetCommand, { TableName: CONFIG_TABLE }).resolves({});

    const result = await handler(
      apiEvent('POST', '/admin/failover/arm', { primaryCellId: 'cell-a', secondaryCellId: 'cell-b' })
    );

    expect(result.statusCode).toBe(422);
    expect(JSON.parse(result.body).error).toMatch(/heartbeat/i);
    expect(route53Mock.commandCalls(CreateHealthCheckCommand)).toHaveLength(0);
  });

  test('rolls back created health checks when the record change fails', async () => {
    stubRegistry();
    ddbMock.on(GetCommand, { TableName: CONFIG_TABLE }).resolves({});
    route53Mock.on(ListResourceRecordSetsCommand).resolves({ ResourceRecordSets: [] });
    route53Mock
      .on(CreateHealthCheckCommand)
      .resolvesOnce({ HealthCheck: { Id: 'hc-1' } as any })
      .resolvesOnce({ HealthCheck: { Id: 'hc-2' } as any });
    route53Mock.on(ChangeResourceRecordSetsCommand).rejects(new Error('InvalidChangeBatch'));

    const result = await handler(
      apiEvent('POST', '/admin/failover/arm', { primaryCellId: 'cell-a', secondaryCellId: 'cell-b' })
    );

    expect(result.statusCode).toBe(500);
    const deleted = route53Mock.commandCalls(DeleteHealthCheckCommand)
      .map((c) => c.args[0].input.HealthCheckId);
    expect(deleted).toEqual(expect.arrayContaining(['hc-1', 'hc-2']));
  });
});

describe('POST /admin/failover/disarm', () => {
  test('deletes records BEFORE health checks (a referenced check cannot be deleted)', async () => {
    ddbMock.on(GetCommand, { TableName: CONFIG_TABLE }).resolves({ Item: armedState });
    route53Mock.on(ListResourceRecordSetsCommand).resolves({ ResourceRecordSets: existingCnameRecordSets as any });

    const result = await handler(apiEvent('POST', '/admin/failover/disarm'));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.armed).toBe(false);
    expect(body.recordsDeleted).toBe(2);
    expect(body.healthChecksDeleted).toEqual(expect.arrayContaining(['hc-old-1', 'hc-old-2']));

    const calls = route53Mock.calls();
    const recordDeleteIdx = calls.findIndex((c) => c.args[0] instanceof ChangeResourceRecordSetsCommand);
    const checkDeleteIdx = calls.findIndex((c) => c.args[0] instanceof DeleteHealthCheckCommand);
    expect(recordDeleteIdx).toBeGreaterThanOrEqual(0);
    expect(checkDeleteIdx).toBeGreaterThan(recordDeleteIdx);

    const deleteBatch = route53Mock.commandCalls(ChangeResourceRecordSetsCommand)[0].args[0].input;
    expect(deleteBatch.ChangeBatch!.Changes!.every((c) => c.Action === 'DELETE')).toBe(true);

    // State row cleared
    const stateDelete = ddbMock.commandCalls(DeleteCommand)
      .find((c) => c.args[0].input.TableName === CONFIG_TABLE);
    expect(stateDelete?.args[0].input.Key).toEqual({ configId: 'FAILOVER_DEMO' });
  });

  test('sweeps stale A records of any type, not just CNAMEs', async () => {
    ddbMock.on(GetCommand, { TableName: CONFIG_TABLE }).resolves({});
    route53Mock.on(ListResourceRecordSetsCommand).resolves({
      ResourceRecordSets: [
        {
          Name: FQDN_DOT,
          Type: 'A',
          TTL: 60,
          SetIdentifier: 'primary',
          Failover: 'PRIMARY',
          ResourceRecords: [{ Value: '192.0.2.1' }]
        },
        // Unrelated record at another name must NOT be touched
        { Name: `other.${DOMAIN}.`, Type: 'A', TTL: 60, ResourceRecords: [{ Value: '192.0.2.9' }] }
      ] as any
    });

    const result = await handler(apiEvent('POST', '/admin/failover/disarm'));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).recordsDeleted).toBe(1);
    const changes = route53Mock.commandCalls(ChangeResourceRecordSetsCommand)[0].args[0].input.ChangeBatch!.Changes!;
    expect(changes).toHaveLength(1);
    expect(changes[0].ResourceRecordSet!.Type).toBe('A');
  });

  test('orphan sweep deletes only health checks tagged with the {project}-failover- prefix', async () => {
    ddbMock.on(GetCommand, { TableName: CONFIG_TABLE }).resolves({}); // not armed — still sweeps
    route53Mock.on(ListResourceRecordSetsCommand).resolves({ ResourceRecordSets: [] });
    route53Mock.on(ListHealthChecksCommand).resolves({
      HealthChecks: [{ Id: 'hc-orphan' }, { Id: 'hc-unrelated' }] as any,
      IsTruncated: false
    });
    route53Mock.on(ListTagsForResourcesCommand).resolves({
      ResourceTagSets: [
        { ResourceId: 'hc-orphan', Tags: [{ Key: 'Name', Value: 'cell-demo-failover-cell-x' }] },
        { ResourceId: 'hc-unrelated', Tags: [{ Key: 'Name', Value: 'somebody-elses-check' }] }
      ] as any
    });

    const result = await handler(apiEvent('POST', '/admin/failover/disarm'));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.healthChecksDeleted).toEqual(['hc-orphan']);
    const deleted = route53Mock.commandCalls(DeleteHealthCheckCommand)
      .map((c) => c.args[0].input.HealthCheckId);
    expect(deleted).toEqual(['hc-orphan']);
  });
});

describe('GET /admin/failover/status', () => {
  test('unarmed status is cheap: no Route 53 calls, advertises what arming creates', async () => {
    ddbMock.on(GetCommand, { TableName: CONFIG_TABLE }).resolves({});

    const result = await handler(apiEvent('GET', '/admin/failover/status'));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.armed).toBe(false);
    expect(body.failoverFqdn).toBe(`failover.${DOMAIN}`);
    expect(body.whatArmingCreates.ratePerHourUsd).toBeCloseTo(0.00685, 4);
    expect(route53Mock.calls()).toHaveLength(0);
  });
});

describe('503 without a configured domain', () => {
  test.each([
    ['POST', '/admin/failover/arm'],
    ['POST', '/admin/failover/disarm'],
    ['GET', '/admin/failover/status'],
    ['GET', '/admin/failover/probe']
  ])('%s %s returns 503', async (method, path) => {
    delete process.env.HOSTED_ZONE_ID;
    delete process.env.DOMAIN_NAME;

    const result = await handler(apiEvent(method, path, {}));

    expect(result.statusCode).toBe(503);
    expect(JSON.parse(result.body).error).toMatch(/HOSTED_ZONE_ID and DOMAIN_NAME/);
  });

  test('the chaos proxy does not require a domain (registry-driven, no Route 53)', async () => {
    delete process.env.HOSTED_ZONE_ID;
    delete process.env.DOMAIN_NAME;

    // Invalid body → 400 (not the 503 domain gate)
    const result = await handler(apiEvent('POST', '/admin/failover/chaos', {}));
    expect(result.statusCode).toBe(400);
  });
});

describe('POST /admin/failover/chaos (server-side proxy)', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
  });

  test('calls the target cell\'s own /chaos endpoint server-side', async () => {
    ddbMock
      .on(GetCommand, { TableName: REGISTRY_TABLE, Key: { cellId: 'cell-a' } })
      .resolves({ Item: liveCell('cell-a') });

    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ cellId: 'cell-a', chaos: { enabled: true, expiresAt: 1234567890 } })
    });
    global.fetch = fetchMock as any;

    const result = await handler(
      apiEvent('POST', '/admin/failover/chaos', { cellId: 'cell-a', enabled: true, durationMinutes: 10 })
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.chaos).toEqual({ enabled: true, expiresAt: 1234567890 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://cell-a.execute-api.us-east-1.amazonaws.com/prod/chaos');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ enabled: true, durationMinutes: 10 });
  });

  test('422 when the target cell has not registered its apiUrl', async () => {
    ddbMock
      .on(GetCommand, { TableName: REGISTRY_TABLE, Key: { cellId: 'cell-a' } })
      .resolves({ Item: { ...liveCell('cell-a'), apiUrl: undefined } });

    const result = await handler(
      apiEvent('POST', '/admin/failover/chaos', { cellId: 'cell-a', enabled: true })
    );

    expect(result.statusCode).toBe(422);
    expect(JSON.parse(result.body).error).toMatch(/heartbeat/i);
  });
});
