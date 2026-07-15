import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  Route53Client,
  CreateHealthCheckCommand,
  DeleteHealthCheckCommand,
  GetHealthCheckStatusCommand,
  ListHealthChecksCommand,
  ChangeTagsForResourceCommand,
  ListTagsForResourcesCommand,
  ChangeResourceRecordSetsCommand,
  Change
} from '@aws-sdk/client-route-53';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { promises as dns } from 'dns';
import { isLiveCell, Cell } from '../lib/consistent-hash';
import { listFailoverRecordSets, formatFailoverRecords } from '../lib/route53-failover';

// Route 53 is a global service; the client region only picks the endpoint.
const route53 = new Route53Client({ region: 'us-east-1' });
const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const STATE_CONFIG_ID = 'FAILOVER_DEMO';

// Real Route 53 pricing: $0.50/mo base (AWS endpoint) + ~$1.00/mo each for the
// HTTPS and fast-interval (10s) optional features ≈ $2.50/check/mo. Two checks
// armed ≈ $5/mo ≈ $0.0068/hr — prorated hourly, which is why arming on demand
// and DISARMING afterwards is the whole cost model of this demo.
const HEALTH_CHECK_MONTHLY_USD = 2.5;
const HOURS_PER_MONTH = 730;
export const RATE_PER_HOUR_USD = (2 * HEALTH_CHECK_MONTHLY_USD) / HOURS_PER_MONTH;

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

interface FailoverState {
  configId: string;
  armed: boolean;
  primaryCellId: string;
  secondaryCellId: string;
  primaryApiHost: string;
  secondaryApiHost: string;
  primaryApiUrl: string;
  secondaryApiUrl: string;
  primaryHealthCheckId: string;
  secondaryHealthCheckId: string;
  armedAt: string;
}

type RegistryCell = Cell & { url?: string; apiUrl?: string };

function respond(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResult {
  return {
    statusCode,
    headers: HEADERS,
    body: JSON.stringify({ ...body, timestamp: new Date().toISOString() })
  };
}

function env(name: string): string {
  return process.env[name] || '';
}

async function fetchJson(
  url: string,
  init: { method?: string; body?: string } = {},
  timeoutMs = 5000
): Promise<{ statusCode: number; body: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: init.method || 'GET',
      body: init.body,
      headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
      signal: controller.signal
    });
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { statusCode: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function getState(): Promise<FailoverState | undefined> {
  const result = await ddbDoc.send(new GetCommand({
    TableName: env('ROUTING_CONFIG_TABLE'),
    Key: { configId: STATE_CONFIG_ID }
  }));
  return result.Item as FailoverState | undefined;
}

async function getRegistryCell(cellId: string): Promise<RegistryCell | undefined> {
  const result = await ddbDoc.send(new GetCommand({
    TableName: env('CELL_REGISTRY_TABLE'),
    Key: { cellId }
  }));
  return result.Item as RegistryCell | undefined;
}

/** Delete every record set (any type) at failover.{domain}. Returns count deleted. */
async function sweepFailoverRecords(hostedZoneId: string, domainName: string): Promise<number> {
  const recordSets = await listFailoverRecordSets(route53, hostedZoneId, domainName);
  if (recordSets.length === 0) return 0;

  const changes: Change[] = recordSets.map((record) => ({
    Action: 'DELETE',
    ResourceRecordSet: record
  }));

  await route53.send(new ChangeResourceRecordSetsCommand({
    HostedZoneId: hostedZoneId,
    ChangeBatch: { Changes: changes }
  }));
  return recordSets.length;
}

async function deleteHealthCheckSafe(healthCheckId: string): Promise<boolean> {
  if (!healthCheckId) return false;
  try {
    await route53.send(new DeleteHealthCheckCommand({ HealthCheckId: healthCheckId }));
    return true;
  } catch (error) {
    // NoSuchHealthCheck etc. — disarm must stay idempotent.
    console.warn(`Could not delete health check ${healthCheckId}:`, error);
    return false;
  }
}

/**
 * Orphan sweep: delete any health check whose Name tag starts with
 * "{project}-failover-". Collects strays from crashed arms or concurrent
 * arm clicks that the state row never recorded.
 */
async function sweepOrphanHealthChecks(projectName: string): Promise<string[]> {
  const prefix = `${projectName}-failover-`;
  const deleted: string[] = [];
  let marker: string | undefined;

  do {
    const page = await route53.send(new ListHealthChecksCommand({ Marker: marker }));
    const ids = (page.HealthChecks || []).map((hc) => hc.Id || '').filter(Boolean);

    // ListTagsForResources accepts at most 10 resource ids per call.
    for (let i = 0; i < ids.length; i += 10) {
      const batch = ids.slice(i, i + 10);
      const tags = await route53.send(new ListTagsForResourcesCommand({
        ResourceType: 'healthcheck',
        ResourceIds: batch
      }));
      for (const tagSet of tags.ResourceTagSets || []) {
        const nameTag = (tagSet.Tags || []).find((t) => t.Key === 'Name');
        if (nameTag?.Value?.startsWith(prefix) && tagSet.ResourceId) {
          if (await deleteHealthCheckSafe(tagSet.ResourceId)) {
            deleted.push(tagSet.ResourceId);
          }
        }
      }
    }
    marker = page.IsTruncated ? page.NextMarker : undefined;
  } while (marker);

  return deleted;
}

/**
 * Full disarm routine, shared by disarm and the re-arm path.
 * Order matters: records FIRST (a health check referenced by a record set
 * cannot be deleted), then the state row's health checks, then the tag-based
 * orphan sweep, then the state row itself.
 */
async function disarmCore(hostedZoneId: string, domainName: string, projectName: string): Promise<{
  recordsDeleted: number;
  healthChecksDeleted: string[];
}> {
  const state = await getState();

  const recordsDeleted = await sweepFailoverRecords(hostedZoneId, domainName);

  const healthChecksDeleted: string[] = [];
  for (const id of [state?.primaryHealthCheckId, state?.secondaryHealthCheckId]) {
    if (id && (await deleteHealthCheckSafe(id))) {
      healthChecksDeleted.push(id);
    }
  }
  const orphans = await sweepOrphanHealthChecks(projectName);
  healthChecksDeleted.push(...orphans.filter((id) => !healthChecksDeleted.includes(id)));

  await ddbDoc.send(new DeleteCommand({
    TableName: env('ROUTING_CONFIG_TABLE'),
    Key: { configId: STATE_CONFIG_ID }
  }));

  return { recordsDeleted, healthChecksDeleted };
}

async function createCellHealthCheck(projectName: string, cellId: string, apiHost: string): Promise<string> {
  // CallerReference must be unique per create — a reference reused after a
  // delete is rejected by Route 53, so it always carries a timestamp.
  const created = await route53.send(new CreateHealthCheckCommand({
    CallerReference: `${projectName}-failover-${cellId}-${Date.now()}`,
    HealthCheckConfig: {
      Type: 'HTTPS',
      FullyQualifiedDomainName: apiHost,
      Port: 443,
      ResourcePath: '/prod/health',
      RequestInterval: 10, // fast interval (paid feature — see rate above)
      FailureThreshold: 2, // ~20-40s to declare failure
      MeasureLatency: false,
      EnableSNI: true
    }
  }));
  const id = created.HealthCheck?.Id;
  if (!id) throw new Error(`CreateHealthCheck for ${cellId} returned no id`);

  // "Name" is not a CreateHealthCheck field — it is the Name tag. The tag
  // prefix {project}-failover- is what the disarm orphan sweep keys on.
  await route53.send(new ChangeTagsForResourceCommand({
    ResourceType: 'healthcheck',
    ResourceId: id,
    AddTags: [{ Key: 'Name', Value: `${projectName}-failover-${cellId}` }]
  }));
  return id;
}

async function handleArm(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const hostedZoneId = env('HOSTED_ZONE_ID');
  const domainName = env('DOMAIN_NAME');
  const projectName = env('PROJECT_NAME') || 'cell-demo';

  let body: any = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { success: false, error: 'Request body must be JSON' });
  }
  const { primaryCellId, secondaryCellId } = body;

  if (!primaryCellId || !secondaryCellId || primaryCellId === secondaryCellId) {
    return respond(400, {
      success: false,
      error: 'primaryCellId and secondaryCellId are required and must be distinct'
    });
  }

  const [primary, secondary] = await Promise.all([
    getRegistryCell(primaryCellId),
    getRegistryCell(secondaryCellId)
  ]);

  for (const [cellId, cell] of [[primaryCellId, primary], [secondaryCellId, secondary]] as const) {
    if (!cell || !isLiveCell(cell)) {
      return respond(422, {
        success: false,
        error: `Cell ${cellId} is not registered and live — it must be active with a fresh heartbeat`
      });
    }
    if (!cell.apiUrl) {
      return respond(422, {
        success: false,
        error: `Cell ${cellId} has not registered its apiUrl yet — cells refresh it on their registration heartbeat (every 5 minutes). Redeploy the cell stack and wait for the next heartbeat.`
      });
    }
  }

  // Re-arm: tear the previous arm down completely first.
  const existing = await getState();
  if (existing?.armed) {
    await disarmCore(hostedZoneId, domainName, projectName);
  } else {
    // Stale-record protection: an old experiment may have left A records at
    // failover.{domain}; a CNAME UPSERT would conflict with them.
    await sweepFailoverRecords(hostedZoneId, domainName);
  }

  const primaryApiHost = new URL(primary!.apiUrl!).hostname;
  const secondaryApiHost = new URL(secondary!.apiUrl!).hostname;

  const primaryHealthCheckId = await createCellHealthCheck(projectName, primaryCellId, primaryApiHost);
  const secondaryHealthCheckId = await createCellHealthCheck(projectName, secondaryCellId, secondaryApiHost);

  const armedAt = new Date().toISOString();
  const failoverFqdn = `failover.${domainName}`;

  try {
    const changes: Change[] = [
      { role: 'PRIMARY' as const, setIdentifier: 'primary', host: primaryApiHost, healthCheckId: primaryHealthCheckId },
      { role: 'SECONDARY' as const, setIdentifier: 'secondary', host: secondaryApiHost, healthCheckId: secondaryHealthCheckId }
    ].map((r) => ({
      Action: 'UPSERT',
      ResourceRecordSet: {
        Name: failoverFqdn,
        Type: 'CNAME',
        TTL: 15,
        SetIdentifier: r.setIdentifier,
        Failover: r.role,
        HealthCheckId: r.healthCheckId,
        ResourceRecords: [{ Value: r.host }]
      }
    }));

    await route53.send(new ChangeResourceRecordSetsCommand({
      HostedZoneId: hostedZoneId,
      ChangeBatch: { Changes: changes }
    }));

    const state: FailoverState = {
      configId: STATE_CONFIG_ID,
      armed: true,
      primaryCellId,
      secondaryCellId,
      primaryApiHost,
      secondaryApiHost,
      primaryApiUrl: primary!.apiUrl!,
      secondaryApiUrl: secondary!.apiUrl!,
      primaryHealthCheckId,
      secondaryHealthCheckId,
      armedAt
    };
    await ddbDoc.send(new PutCommand({ TableName: env('ROUTING_CONFIG_TABLE'), Item: state }));

    return respond(200, {
      success: true,
      armed: true,
      failoverFqdn,
      primaryCellId,
      secondaryCellId,
      healthCheckIds: { primary: primaryHealthCheckId, secondary: secondaryHealthCheckId },
      armedAt,
      estimatedCost: { ratePerHourUsd: Number(RATE_PER_HOUR_USD.toFixed(6)) }
    });
  } catch (error) {
    // Partial-arm rollback: never leave paid health checks behind without the
    // records/state that disarm would use to find them.
    console.error('Arm failed after health-check creation; rolling back:', error);
    await deleteHealthCheckSafe(primaryHealthCheckId);
    await deleteHealthCheckSafe(secondaryHealthCheckId);
    return respond(500, {
      success: false,
      error: 'Failed to create failover records — created health checks were rolled back'
    });
  }
}

async function handleDisarm(): Promise<APIGatewayProxyResult> {
  const result = await disarmCore(env('HOSTED_ZONE_ID'), env('DOMAIN_NAME'), env('PROJECT_NAME') || 'cell-demo');
  return respond(200, {
    success: true,
    armed: false,
    recordsDeleted: result.recordsDeleted,
    healthChecksDeleted: result.healthChecksDeleted
  });
}

async function summarizeHealthCheck(healthCheckId: string): Promise<Record<string, unknown>> {
  try {
    const status = await route53.send(new GetHealthCheckStatusCommand({ HealthCheckId: healthCheckId }));
    const observations = status.HealthCheckObservations || [];
    const healthyObservers = observations.filter((o) =>
      (o.StatusReport?.Status || '').startsWith('Success')
    ).length;
    return {
      healthCheckId,
      healthy: observations.length > 0 && healthyObservers > observations.length / 2,
      observers: observations.length,
      healthyObservers,
      sample: observations.slice(0, 3).map((o) => ({
        region: o.Region,
        status: o.StatusReport?.Status,
        checkedAt: o.StatusReport?.CheckedTime
      }))
    };
  } catch (error) {
    console.warn(`GetHealthCheckStatus failed for ${healthCheckId}:`, error);
    return { healthCheckId, healthy: null, error: 'status unavailable' };
  }
}

async function fetchCellHealth(cellId: string, apiUrl: string): Promise<Record<string, unknown>> {
  try {
    const { statusCode, body } = await fetchJson(`${apiUrl}/health`);
    return {
      cellId,
      statusCode,
      status: body?.status ?? null,
      chaos: body?.chaos ?? { enabled: false }
    };
  } catch (error) {
    return { cellId, statusCode: 0, error: error instanceof Error ? error.message : 'fetch failed' };
  }
}

async function resolveFailoverCname(fqdn: string): Promise<string | null> {
  try {
    const answers = await dns.resolveCname(fqdn);
    return answers.length > 0 ? answers[0].replace(/\.$/, '') : null;
  } catch {
    return null; // NXDOMAIN while unarmed / mid-propagation — not an error.
  }
}

function hostToCellId(host: string | null, state: FailoverState): string | null {
  if (!host) return null;
  if (host === state.primaryApiHost) return state.primaryCellId;
  if (host === state.secondaryApiHost) return state.secondaryCellId;
  return null;
}

async function handleStatus(): Promise<APIGatewayProxyResult> {
  const domainName = env('DOMAIN_NAME');
  const failoverFqdn = `failover.${domainName}`;
  const state = await getState();

  if (!state?.armed) {
    // Deliberately cheap: no Route 53 or cell calls while unarmed — this is
    // the steady state the admin dashboard polls.
    return respond(200, {
      armed: false,
      failoverFqdn,
      whatArmingCreates: {
        healthChecks: '2 × HTTPS health checks against the cells\' /prod/health (10s interval, 2-failure threshold)',
        records: `2 × CNAME ${failoverFqdn} (TTL 15, PRIMARY/SECONDARY failover routing)`,
        ratePerHourUsd: Number(RATE_PER_HOUR_USD.toFixed(6))
      }
    });
  }

  const hostedZoneId = env('HOSTED_ZONE_ID');
  const [primaryCheck, secondaryCheck, recordSets, dnsAnswer, primaryHealth, secondaryHealth] =
    await Promise.all([
      summarizeHealthCheck(state.primaryHealthCheckId),
      summarizeHealthCheck(state.secondaryHealthCheckId),
      listFailoverRecordSets(route53, hostedZoneId, domainName),
      resolveFailoverCname(failoverFqdn),
      fetchCellHealth(state.primaryCellId, state.primaryApiUrl),
      fetchCellHealth(state.secondaryCellId, state.secondaryApiUrl)
    ]);

  const armedMinutes = Math.max(0, (Date.now() - new Date(state.armedAt).getTime()) / 60000);

  return respond(200, {
    armed: true,
    failoverFqdn,
    armedAt: state.armedAt,
    primaryCellId: state.primaryCellId,
    secondaryCellId: state.secondaryCellId,
    healthChecks: { primary: primaryCheck, secondary: secondaryCheck },
    records: formatFailoverRecords(recordSets),
    cellHealth: { primary: primaryHealth, secondary: secondaryHealth },
    // Authoritative answer as the Lambda's resolver sees it — the admin UI's
    // primary DNS display. Browser DoH lookups are an optional extra.
    dns: {
      answer: dnsAnswer,
      answerCellId: hostToCellId(dnsAnswer, state)
    },
    estimatedCost: {
      ratePerHourUsd: Number(RATE_PER_HOUR_USD.toFixed(6)),
      armedMinutes: Math.round(armedMinutes),
      accruedUsd: Number(((armedMinutes / 60) * RATE_PER_HOUR_USD).toFixed(4))
    }
  });
}

async function handleProbe(): Promise<APIGatewayProxyResult> {
  const domainName = env('DOMAIN_NAME');
  const failoverFqdn = `failover.${domainName}`;
  const state = await getState();

  if (!state?.armed) {
    return respond(200, { armed: false, fqdn: failoverFqdn });
  }

  const note =
    'failover.' + domainName + ' has no regional custom domain, so direct HTTPS to it is impossible; ' +
    'the probe resolves the CNAME and fetches the winning cell\'s API host with matching SNI.';

  const cnameTarget = await resolveFailoverCname(failoverFqdn);
  if (!cnameTarget) {
    return respond(200, {
      armed: true,
      fqdn: failoverFqdn,
      cnameTarget: null,
      error: 'CNAME did not resolve (propagation may take a few seconds after arming)',
      note
    });
  }

  const winningCellId = hostToCellId(cnameTarget, state);
  let cellInfo: Record<string, unknown> | null = null;
  try {
    const { body } = await fetchJson(`https://${cnameTarget}/prod/info`);
    if (body) cellInfo = { cellId: body.cellId, region: body.region };
  } catch (error) {
    console.warn('Probe fetch failed:', error);
  }

  return respond(200, {
    armed: true,
    fqdn: failoverFqdn,
    cnameTarget,
    winningCellId,
    cellInfo,
    resolvedAt: new Date().toISOString(),
    note
  });
}

/**
 * Proxy-friendly chaos toggle: the browser only ever talks to the admin API
 * host, so this route flips the target cell's OWN /chaos endpoint server-side
 * (Lambda egress is unrestricted). The cell keeps owning the flag in its own
 * table — this is control plane → cell, never cell → cell.
 */
async function handleChaosProxy(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  let body: any = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { success: false, error: 'Request body must be JSON' });
  }
  const { cellId, enabled, durationMinutes } = body;

  if (!cellId || typeof enabled !== 'boolean') {
    return respond(400, { success: false, error: 'cellId (string) and enabled (boolean) are required' });
  }

  const cell = await getRegistryCell(cellId);
  if (!cell) {
    return respond(404, { success: false, error: `Cell ${cellId} is not in the registry` });
  }
  if (!cell.apiUrl) {
    return respond(422, {
      success: false,
      error: `Cell ${cellId} has not registered its apiUrl yet — wait for its next registration heartbeat (every 5 minutes)`
    });
  }

  try {
    const { statusCode, body: cellResponse } = await fetchJson(`${cell.apiUrl}/chaos`, {
      method: 'POST',
      body: JSON.stringify({ enabled, durationMinutes })
    });
    if (statusCode < 200 || statusCode >= 300) {
      return respond(502, { success: false, error: `Cell ${cellId} /chaos returned ${statusCode}` });
    }
    return respond(200, { success: true, cellId, ...cellResponse });
  } catch (error) {
    return respond(502, {
      success: false,
      error: `Could not reach cell ${cellId}: ${error instanceof Error ? error.message : 'fetch failed'}`
    });
  }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  try {
    const path = event.path;
    const method = event.httpMethod;

    // The chaos proxy only needs the cell registry, not Route 53.
    if (path === '/admin/failover/chaos' && method === 'POST') {
      return await handleChaosProxy(event);
    }

    if (!env('HOSTED_ZONE_ID') || !env('DOMAIN_NAME')) {
      return respond(503, {
        success: false,
        error: 'HOSTED_ZONE_ID and DOMAIN_NAME must be configured for the failover demo'
      });
    }

    if (path === '/admin/failover/arm' && method === 'POST') {
      return await handleArm(event);
    } else if (path === '/admin/failover/disarm' && method === 'POST') {
      return await handleDisarm();
    } else if (path === '/admin/failover/status' && method === 'GET') {
      return await handleStatus();
    } else if (path === '/admin/failover/probe' && method === 'GET') {
      return await handleProbe();
    }

    return respond(404, { error: 'Not found' });
  } catch (error) {
    console.error('Error in failover-admin handler:', error);
    return respond(500, { success: false, error: 'Internal server error' });
  }
};
