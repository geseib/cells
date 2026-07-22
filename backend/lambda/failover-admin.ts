import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  Route53Client,
  CreateHealthCheckCommand,
  DeleteHealthCheckCommand,
  GetHealthCheckStatusCommand,
  TestDNSAnswerCommand,
  ListHealthChecksCommand,
  ChangeTagsForResourceCommand,
  ListTagsForResourcesCommand,
  ChangeResourceRecordSetsCommand,
  Change
} from '@aws-sdk/client-route-53';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  BatchGetCommand
} from '@aws-sdk/lib-dynamodb';
import { promises as dns } from 'dns';
import { isLiveCell, Cell } from '../lib/consistent-hash';
import { listFailoverRecordSets, formatFailoverRecords } from '../lib/route53-failover';

// Route 53 is a global service; the client region only picks the endpoint.
const route53 = new Route53Client({ region: 'us-east-1' });
const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const STATE_CONFIG_ID = 'FAILOVER_DEMO';
const QUORUM_STATE_CONFIG_ID = 'QUORUM_DEMO';
const QUORUM_VOTERS = 5;
const QUORUM_DEFAULT_THRESHOLD = 3;
// The decision log seeds at v126 so the demo's version numbers rhyme with the
// site's "Versions, not retries" story (logs there end at "v126 · Routing =
// Disabled"; the first committed quorum decision becomes v127).
const QUORUM_SEED_VERSION = 126;
const QUORUM_LOG_RETURN_CAP = 20;

// Real Route 53 pricing: $0.50/mo base (AWS endpoint) + ~$1.00/mo each for the
// HTTPS and fast-interval (10s) optional features ≈ $2.50/check/mo. Two checks
// armed ≈ $5/mo ≈ $0.0068/hr — prorated hourly, which is why arming on demand
// and DISARMING afterwards is the whole cost model of this demo.
const HEALTH_CHECK_MONTHLY_USD = 2.5;
const HOURS_PER_MONTH = 730;
export const RATE_PER_HOUR_USD = (2 * HEALTH_CHECK_MONTHLY_USD) / HOURS_PER_MONTH;

// Quorum demo cost is HONESTLY two components, and the second is the bigger:
// 1. The checks themselves — 5 × HTTPS fast-interval checks (~$2.50/mo each)
//    plus 1 CALCULATED parent (~$1.00/mo) ≈ $13.50/mo ≈ $0.0185/hr.
// 2. The checker TRAFFIC — ~16 checkers × 5 checks × 1 req/10 s ≈ 27k
//    requests/hr hitting the routing API at ~$3.50/M REST requests
//    ≈ $0.095/hr.
// Total ≈ $0.12/hr while armed — which is why disarming on stage is part of
// the demo script.
export const QUORUM_CHECKS_RATE_PER_HOUR_USD =
  (QUORUM_VOTERS * HEALTH_CHECK_MONTHLY_USD + 1.0) / HOURS_PER_MONTH;
export const QUORUM_TRAFFIC_RATE_PER_HOUR_USD = (27000 * 3.5) / 1e6;
export const QUORUM_RATE_PER_HOUR_USD =
  QUORUM_CHECKS_RATE_PER_HOUR_USD + QUORUM_TRAFFIC_RATE_PER_HOUR_USD;

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

// ARC-style stored control: the committed decision, its version, and when it
// was committed. Flipped ONLY on a genuine parent transition — never rewritten.
interface QuorumStoredControl {
  on: boolean;
  version: number;
  since: string;
}

interface QuorumState {
  configId: string;
  armed: boolean;
  threshold: number;
  voterHealthCheckIds: string[];
  parentHealthCheckId: string;
  host: string;
  pathPrefix: string;
  armedAt: string;
  lastParentStatus: 'on' | 'off';
  storedControl: QuorumStoredControl;
  logVersions: number[];
  wired: boolean;
  originalPrimaryHealthCheckId?: string;
}

interface QuorumLogItem {
  configId: string;
  version: number;
  decision: 'on' | 'off';
  healthyChildren: number;
  threshold: number;
  at: string;
}

type RegistryCell = Cell & { url?: string; apiUrl?: string };

const quorumVoteKey = (i: number) => `QUORUM_VOTE#${i}`;
const quorumBrokenKey = (i: number) => `QUORUM_BROKEN#${i}`;
// Zero-padded so the item keys sort in version order in the console.
const quorumLogKey = (version: number) => `QUORUM_LOG#${String(version).padStart(8, '0')}`;

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

async function getQuorumState(): Promise<QuorumState | undefined> {
  const result = await ddbDoc.send(new GetCommand({
    TableName: env('ROUTING_CONFIG_TABLE'),
    Key: { configId: QUORUM_STATE_CONFIG_ID }
  }));
  return result.Item as QuorumState | undefined;
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
 * Orphan sweep: delete any health check whose Name tag starts with the given
 * prefix ("{project}-failover-" or "{project}-quorum-"). Collects strays from
 * crashed arms or concurrent arm clicks that the state row never recorded.
 * Deletion is parent-first: a CALCULATED parent references its children, and
 * Route 53 refuses to delete a child that is still referenced.
 */
async function sweepOrphanHealthChecks(prefix: string): Promise<string[]> {
  const matches: { id: string; name: string }[] = [];
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
          matches.push({ id: tagSet.ResourceId, name: nameTag.Value });
        }
      }
    }
    marker = page.IsTruncated ? page.NextMarker : undefined;
  } while (marker);

  matches.sort((a, b) => Number(b.name.includes('-parent')) - Number(a.name.includes('-parent')));

  const deleted: string[] = [];
  for (const match of matches) {
    if (await deleteHealthCheckSafe(match.id)) {
      deleted.push(match.id);
    }
  }
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
  const orphans = await sweepOrphanHealthChecks(`${projectName}-failover-`);
  healthChecksDeleted.push(...orphans.filter((id) => !healthChecksDeleted.includes(id)));

  await ddbDoc.send(new DeleteCommand({
    TableName: env('ROUTING_CONFIG_TABLE'),
    Key: { configId: STATE_CONFIG_ID }
  }));

  // A wired quorum demo pointed the PRIMARY failover record at the quorum
  // parent — that record is gone now, so clear the stale wire flags. Without
  // this, a failover re-arm would inherit ghost wire state (the quorum status
  // would claim "wired" against records that no longer reference the parent).
  const quorumState = await getQuorumState();
  if (quorumState?.wired) {
    const { originalPrimaryHealthCheckId: _dropped, ...rest } = quorumState;
    await ddbDoc.send(new PutCommand({
      TableName: env('ROUTING_CONFIG_TABLE'),
      Item: { ...rest, wired: false }
    }));
  }

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

interface CheckObservation {
  status: 'healthy' | 'unhealthy' | 'unknown';
  checkersReporting: number;
  healthyCount: number;
  sample: { region?: string; status?: string; checkedAt?: Date }[];
  error?: string;
}

/**
 * Summarize the checker observations for one NON-calculated health check.
 * (GetHealthCheckStatus does not work on CALCULATED checks — the quorum
 * parent's status is computed from its children's observations instead.)
 */
async function observeHealthCheck(healthCheckId: string): Promise<CheckObservation> {
  try {
    const status = await route53.send(new GetHealthCheckStatusCommand({ HealthCheckId: healthCheckId }));
    const observations = status.HealthCheckObservations || [];
    const healthyCount = observations.filter((o) =>
      (o.StatusReport?.Status || '').startsWith('Success')
    ).length;
    return {
      status: observations.length === 0
        ? 'unknown'
        : healthyCount > observations.length / 2 ? 'healthy' : 'unhealthy',
      checkersReporting: observations.length,
      healthyCount,
      sample: observations.slice(0, 3).map((o) => ({
        region: o.Region,
        status: o.StatusReport?.Status,
        checkedAt: o.StatusReport?.CheckedTime
      }))
    };
  } catch (error) {
    console.warn(`GetHealthCheckStatus failed for ${healthCheckId}:`, error);
    return { status: 'unknown', checkersReporting: 0, healthyCount: 0, sample: [], error: 'status unavailable' };
  }
}

async function summarizeHealthCheck(cellId: string, healthCheckId: string): Promise<Record<string, unknown>> {
  const observation = await observeHealthCheck(healthCheckId);
  return { cellId, healthCheckId, ...observation };
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

// Ask Route 53 itself what it would answer right now, honoring health-check
// state. Unlike a recursive resolve this can't be poisoned by negative
// caching from a lookup that raced record creation, so the demo's DNS
// display reacts on health-check time, not resolver-cache time.
async function authoritativeAnswer(hostedZoneId: string, fqdn: string): Promise<string | null> {
  try {
    const res = await route53.send(new TestDNSAnswerCommand({
      HostedZoneId: hostedZoneId,
      RecordName: fqdn,
      RecordType: 'CNAME'
    }));
    const data = res.RecordData || [];
    return data.length > 0 ? data[0].replace(/\.$/, '') : null;
  } catch (error) {
    console.warn('TestDNSAnswer failed, falling back to resolver:', error);
    return resolveFailoverCname(fqdn);
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
      summarizeHealthCheck(state.primaryCellId, state.primaryHealthCheckId),
      summarizeHealthCheck(state.secondaryCellId, state.secondaryHealthCheckId),
      listFailoverRecordSets(route53, hostedZoneId, domainName),
      authoritativeAnswer(hostedZoneId, failoverFqdn),
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
    healthChecks: [primaryCheck, secondaryCheck],
    records: formatFailoverRecords(recordSets),
    cellHealth: [primaryHealth, secondaryHealth],
    // Authoritative answer straight from Route 53 (TestDNSAnswer) — the admin
    // UI's primary DNS display. Browser DoH lookups are an optional extra.
    dnsAnswer: dnsAnswer === null ? null : {
      value: dnsAnswer,
      matchesCellId: hostToCellId(dnsAnswer, state),
      resolvedAt: new Date().toISOString()
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

// ---------------------------------------------------------------------------
// Quorum / ARC demo — a Route 53 CALCULATED health check IS the consensus
// evaluator. Five "reverse" health checks each observe one vote flag
// (/vote-status/{i}: an item in the routing-config table); the CALCULATED
// parent with HealthThreshold over those five children decides. DynamoDB only
// stores vote flags — Route 53's checker fleet does the actual evaluating.
// Works WITHOUT a custom domain (checkers hit the API Gateway hostname); only
// /admin/quorum/wire touches DNS.
// ---------------------------------------------------------------------------

function quorumRates() {
  return {
    healthChecksPerHourUsd: Number(QUORUM_CHECKS_RATE_PER_HOUR_USD.toFixed(4)),
    checkerTrafficPerHourUsd: Number(QUORUM_TRAFFIC_RATE_PER_HOUR_USD.toFixed(4)),
    ratePerHourUsd: Number(QUORUM_RATE_PER_HOUR_USD.toFixed(4))
  };
}

const voterIndexes = Array.from({ length: QUORUM_VOTERS }, (_, idx) => idx + 1);

/**
 * Public checker target. 200 = vote on, 503 = vote off, 500 = voter broken,
 * 404 = bad index. One BatchGet per call; Route 53's ~16 checkers per voter
 * keep this route permanently warm while armed.
 */
async function handleVoteStatus(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const raw = event.pathParameters?.i ?? event.path.split('/').pop() ?? '';
  const i = Number(raw);
  if (!/^\d+$/.test(String(raw)) || !Number.isInteger(i) || i < 1 || i > QUORUM_VOTERS) {
    return respond(404, { error: `voter index must be 1..${QUORUM_VOTERS}` });
  }

  const table = env('ROUTING_CONFIG_TABLE');
  const result = await ddbDoc.send(new BatchGetCommand({
    RequestItems: {
      [table]: { Keys: [{ configId: quorumVoteKey(i) }, { configId: quorumBrokenKey(i) }] }
    }
  }));
  const items = result.Responses?.[table] || [];
  const broken = items.some((item) => item.configId === quorumBrokenKey(i));
  const on = items.some((item) => item.configId === quorumVoteKey(i));

  if (broken) {
    return respond(500, { i, vote: on ? 'on' : 'off', broken: true, error: 'voter is broken (simulated fault)' });
  }
  return on ? respond(200, { i, vote: 'on' }) : respond(503, { i, vote: 'off' });
}

async function createQuorumVoterCheck(projectName: string, i: number, host: string, pathPrefix: string): Promise<string> {
  const created = await route53.send(new CreateHealthCheckCommand({
    // Unique per create: Route 53 rejects a CallerReference reused after delete.
    CallerReference: `${projectName}-quorum-voter-${i}-${Date.now()}`,
    HealthCheckConfig: {
      Type: 'HTTPS',
      FullyQualifiedDomainName: host,
      Port: 443,
      ResourcePath: `${pathPrefix}/vote-status/${i}`,
      RequestInterval: 10, // fast interval (paid feature)
      FailureThreshold: 1, // votes should register on the next observation
      MeasureLatency: false,
      EnableSNI: true
    }
  }));
  const id = created.HealthCheck?.Id;
  if (!id) throw new Error(`CreateHealthCheck for quorum voter ${i} returned no id`);

  // The {project}-quorum- tag prefix is what the disarm orphan sweep keys on.
  await route53.send(new ChangeTagsForResourceCommand({
    ResourceType: 'healthcheck',
    ResourceId: id,
    AddTags: [{ Key: 'Name', Value: `${projectName}-quorum-voter-${i}` }]
  }));
  return id;
}

async function createQuorumParentCheck(projectName: string, childIds: string[], threshold: number): Promise<string> {
  // CALCULATED checks take NO interval/FQDN — Route 53 recomputes them from
  // the children's states; HealthThreshold is the quorum.
  const created = await route53.send(new CreateHealthCheckCommand({
    CallerReference: `${projectName}-quorum-parent-${Date.now()}`,
    HealthCheckConfig: {
      Type: 'CALCULATED',
      ChildHealthChecks: childIds,
      HealthThreshold: threshold,
      Inverted: false
    }
  }));
  const id = created.HealthCheck?.Id;
  if (!id) throw new Error('CreateHealthCheck for the quorum parent returned no id');

  await route53.send(new ChangeTagsForResourceCommand({
    ResourceType: 'healthcheck',
    ResourceId: id,
    AddTags: [{ Key: 'Name', Value: `${projectName}-quorum-parent` }]
  }));
  return id;
}

/** UPSERT the PRIMARY failover record with a different HealthCheckId (or none). */
async function upsertPrimaryRecordHealthCheck(
  hostedZoneId: string,
  domainName: string,
  healthCheckId: string | undefined
): Promise<boolean> {
  const records = await listFailoverRecordSets(route53, hostedZoneId, domainName);
  const primary = records.find((r) => r.Failover === 'PRIMARY');
  if (!primary) return false;

  const recordSet = { ...primary };
  if (healthCheckId) {
    recordSet.HealthCheckId = healthCheckId;
  } else {
    delete recordSet.HealthCheckId;
  }
  await route53.send(new ChangeResourceRecordSetsCommand({
    HostedZoneId: hostedZoneId,
    ChangeBatch: { Changes: [{ Action: 'UPSERT', ResourceRecordSet: recordSet }] }
  }));
  return true;
}

/** Point the PRIMARY failover record back at whatever it referenced pre-wire. */
async function restoreWiredRecord(state: QuorumState, hostedZoneId: string, domainName: string): Promise<boolean> {
  if (!hostedZoneId || !domainName) return false;
  try {
    return await upsertPrimaryRecordHealthCheck(hostedZoneId, domainName, state.originalPrimaryHealthCheckId);
  } catch (error) {
    // The failover demo may already be disarmed (record gone) — not fatal.
    console.warn('Could not restore the wired PRIMARY record:', error);
    return false;
  }
}

/**
 * Full quorum teardown, shared by disarm and the re-arm path. Order matters:
 * 1. restore the wired record (a record referencing the parent blocks its
 *    deletion), 2. the parent FIRST (children of a CALCULATED check cannot be
 *    deleted while referenced), 3. the children, 4. the {project}-quorum- tag
 *    sweep (parent-first) for strays, 5. the vote/broken/log items, 6. the
 *    state row. Idempotent throughout.
 */
async function quorumDisarmCore(projectName: string, hostedZoneId: string, domainName: string): Promise<{
  healthChecksDeleted: string[];
}> {
  const state = await getQuorumState();

  if (state?.wired) {
    await restoreWiredRecord(state, hostedZoneId, domainName);
  }

  const healthChecksDeleted: string[] = [];
  const stateCheckIds = [state?.parentHealthCheckId, ...(state?.voterHealthCheckIds || [])];
  for (const id of stateCheckIds) {
    if (id && (await deleteHealthCheckSafe(id))) {
      healthChecksDeleted.push(id);
    }
  }
  const orphans = await sweepOrphanHealthChecks(`${projectName}-quorum-`);
  healthChecksDeleted.push(...orphans.filter((id) => !healthChecksDeleted.includes(id)));

  const table = env('ROUTING_CONFIG_TABLE');
  const itemKeys = [
    ...voterIndexes.map(quorumVoteKey),
    ...voterIndexes.map(quorumBrokenKey),
    ...(state?.logVersions || []).map(quorumLogKey)
  ];
  for (const configId of itemKeys) {
    await ddbDoc.send(new DeleteCommand({ TableName: table, Key: { configId } }));
  }
  await ddbDoc.send(new DeleteCommand({ TableName: table, Key: { configId: QUORUM_STATE_CONFIG_ID } }));

  return { healthChecksDeleted };
}

async function handleQuorumArm(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const projectName = env('PROJECT_NAME') || 'cell-demo';
  const domainName = env('DOMAIN_NAME');
  const hostedZoneId = env('HOSTED_ZONE_ID');

  let body: any = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { success: false, error: 'Request body must be JSON' });
  }
  const threshold = body.threshold === undefined ? QUORUM_DEFAULT_THRESHOLD : body.threshold;
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > QUORUM_VOTERS) {
    return respond(400, { success: false, error: `threshold must be an integer between 1 and ${QUORUM_VOTERS}` });
  }

  // Re-arm: tear the previous arm down completely first.
  const existing = await getQuorumState();
  if (existing?.armed) {
    await quorumDisarmCore(projectName, hostedZoneId, domainName);
  }

  // Checker target: the routing API itself — a host that already exists and
  // is public. NO new DNS names for an audience (or their proxy) to allowlist.
  let host: string;
  let pathPrefix: string;
  if (domainName) {
    host = `api.${domainName}`;
    pathPrefix = '';
  } else {
    const apiId = event.requestContext?.apiId;
    if (!apiId) {
      return respond(500, { success: false, error: 'Could not determine the API Gateway id for the checker target' });
    }
    host = `${apiId}.execute-api.${env('AWS_REGION') || 'us-east-1'}.amazonaws.com`;
    pathPrefix = '/prod';
  }

  const armedAt = new Date().toISOString();
  const table = env('ROUTING_CONFIG_TABLE');

  // Vote items first, all ON, so the checkers' first observations see 200s.
  for (const i of voterIndexes) {
    await ddbDoc.send(new PutCommand({
      TableName: table,
      Item: { configId: quorumVoteKey(i), i, votedAt: armedAt }
    }));
  }

  const voterHealthCheckIds: string[] = [];
  let parentHealthCheckId = '';
  try {
    for (const i of voterIndexes) {
      voterHealthCheckIds.push(await createQuorumVoterCheck(projectName, i, host, pathPrefix));
    }
    parentHealthCheckId = await createQuorumParentCheck(projectName, voterHealthCheckIds, threshold);

    // Seed the versioned decision log. The stored control starts OFF at v126:
    // no quorum has confirmed health yet — the first genuine parent-healthy
    // transition commits v127 ("Routing = Enabled") for real.
    const seedLog: QuorumLogItem = {
      configId: quorumLogKey(QUORUM_SEED_VERSION),
      version: QUORUM_SEED_VERSION,
      decision: 'off',
      healthyChildren: 0,
      threshold,
      at: armedAt
    };
    await ddbDoc.send(new PutCommand({ TableName: table, Item: seedLog }));

    const state: QuorumState = {
      configId: QUORUM_STATE_CONFIG_ID,
      armed: true,
      threshold,
      voterHealthCheckIds,
      parentHealthCheckId,
      host,
      pathPrefix,
      armedAt,
      lastParentStatus: 'off',
      storedControl: { on: false, version: QUORUM_SEED_VERSION, since: armedAt },
      logVersions: [QUORUM_SEED_VERSION],
      wired: false
    };
    await ddbDoc.send(new PutCommand({ TableName: table, Item: state }));

    return respond(200, {
      success: true,
      armed: true,
      threshold,
      voterHealthCheckIds,
      parentHealthCheckId,
      voteStatusUrl: `https://${host}${pathPrefix}/vote-status/{i}`,
      armedAt,
      storedControl: state.storedControl,
      estimatedCost: quorumRates()
    });
  } catch (error) {
    // Partial-arm rollback: never leave paid health checks behind without the
    // state that disarm would use to find them. Parent first (it references
    // the children), then children, then the vote items.
    console.error('Quorum arm failed part-way; rolling back:', error);
    await deleteHealthCheckSafe(parentHealthCheckId);
    for (const id of voterHealthCheckIds) {
      await deleteHealthCheckSafe(id);
    }
    for (const i of voterIndexes) {
      await ddbDoc.send(new DeleteCommand({ TableName: table, Key: { configId: quorumVoteKey(i) } }));
    }
    await ddbDoc.send(new DeleteCommand({ TableName: table, Key: { configId: quorumLogKey(QUORUM_SEED_VERSION) } }));
    return respond(500, {
      success: false,
      error: 'Failed to arm the quorum demo — created health checks and vote items were rolled back'
    });
  }
}

async function handleQuorumDisarm(): Promise<APIGatewayProxyResult> {
  const result = await quorumDisarmCore(
    env('PROJECT_NAME') || 'cell-demo',
    env('HOSTED_ZONE_ID'),
    env('DOMAIN_NAME')
  );
  return respond(200, {
    success: true,
    armed: false,
    healthChecksDeleted: result.healthChecksDeleted
  });
}

function parseVoterBody(event: APIGatewayProxyEvent, flagName: string): { i: number; flag: boolean } | APIGatewayProxyResult {
  let body: any = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { success: false, error: 'Request body must be JSON' });
  }
  const { i } = body;
  const flag = body[flagName];
  if (!Number.isInteger(i) || i < 1 || i > QUORUM_VOTERS || typeof flag !== 'boolean') {
    return respond(400, {
      success: false,
      error: `i (integer 1..${QUORUM_VOTERS}) and ${flagName} (boolean) are required`
    });
  }
  return { i, flag };
}

/** The vote IS an item creation/deletion — that's the whole point. */
async function handleQuorumVote(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const parsed = parseVoterBody(event, 'on');
  if ('statusCode' in parsed) return parsed;
  const { i, flag: on } = parsed;

  const state = await getQuorumState();
  if (!state?.armed) {
    return respond(409, { success: false, error: 'Quorum demo is not armed' });
  }

  const table = env('ROUTING_CONFIG_TABLE');
  if (on) {
    await ddbDoc.send(new PutCommand({
      TableName: table,
      Item: { configId: quorumVoteKey(i), i, votedAt: new Date().toISOString() }
    }));
  } else {
    await ddbDoc.send(new DeleteCommand({ TableName: table, Key: { configId: quorumVoteKey(i) } }));
  }
  return respond(200, { success: true, i, on });
}

/** Simulated voter fault: /vote-status/{i} answers 500 while the flag exists. */
async function handleQuorumBreakVoter(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const parsed = parseVoterBody(event, 'broken');
  if ('statusCode' in parsed) return parsed;
  const { i, flag: broken } = parsed;

  const state = await getQuorumState();
  if (!state?.armed) {
    return respond(409, { success: false, error: 'Quorum demo is not armed' });
  }

  const table = env('ROUTING_CONFIG_TABLE');
  if (broken) {
    await ddbDoc.send(new PutCommand({
      TableName: table,
      Item: { configId: quorumBrokenKey(i), i, brokenAt: new Date().toISOString() }
    }));
  } else {
    await ddbDoc.send(new DeleteCommand({ TableName: table, Key: { configId: quorumBrokenKey(i) } }));
  }
  return respond(200, { success: true, i, broken });
}

/**
 * Optional wire-to-DNS: point the PRIMARY failover record's HealthCheckId at
 * the quorum parent, so the committed quorum decision drives real DNS
 * failover. The only quorum route that touches the hosted zone.
 */
async function handleQuorumWire(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const hostedZoneId = env('HOSTED_ZONE_ID');
  const domainName = env('DOMAIN_NAME');
  if (!hostedZoneId || !domainName) {
    return respond(503, {
      success: false,
      error: 'HOSTED_ZONE_ID and DOMAIN_NAME must be configured to wire the quorum parent into DNS'
    });
  }

  let body: any = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { success: false, error: 'Request body must be JSON' });
  }
  if (typeof body.on !== 'boolean') {
    return respond(400, { success: false, error: 'on (boolean) is required' });
  }

  const state = await getQuorumState();
  if (!state?.armed) {
    return respond(409, { success: false, error: 'Quorum demo is not armed' });
  }
  const table = env('ROUTING_CONFIG_TABLE');

  if (body.on) {
    if (state.wired) {
      return respond(200, { success: true, wired: true, recordHealthCheckId: state.parentHealthCheckId });
    }
    const failoverState = await getState();
    if (!failoverState?.armed) {
      return respond(409, {
        success: false,
        error: 'The failover demo must be armed first — wiring points its PRIMARY record at the quorum parent'
      });
    }

    const records = await listFailoverRecordSets(route53, hostedZoneId, domainName);
    const primary = records.find((r) => r.Failover === 'PRIMARY');
    if (!primary) {
      return respond(409, { success: false, error: 'No PRIMARY failover record found to wire' });
    }
    const originalPrimaryHealthCheckId = primary.HealthCheckId || '';

    await upsertPrimaryRecordHealthCheck(hostedZoneId, domainName, state.parentHealthCheckId);
    await ddbDoc.send(new PutCommand({
      TableName: table,
      Item: { ...state, wired: true, originalPrimaryHealthCheckId }
    }));
    return respond(200, {
      success: true,
      wired: true,
      recordHealthCheckId: state.parentHealthCheckId,
      originalPrimaryHealthCheckId
    });
  }

  if (!state.wired) {
    return respond(200, { success: true, wired: false });
  }
  await restoreWiredRecord(state, hostedZoneId, domainName);
  const { originalPrimaryHealthCheckId: _dropped, ...rest } = state;
  await ddbDoc.send(new PutCommand({ TableName: table, Item: { ...rest, wired: false } }));
  return respond(200, { success: true, wired: false });
}

async function handleQuorumStatus(): Promise<APIGatewayProxyResult> {
  const state = await getQuorumState();

  if (!state?.armed) {
    // Deliberately cheap while unarmed — this is the steady state the admin
    // dashboard polls.
    return respond(200, {
      armed: false,
      whatArmingCreates: {
        healthChecks: `${QUORUM_VOTERS} × HTTPS checkers against /vote-status/{i} (10s interval, 1-failure threshold) + 1 CALCULATED parent (healthy children >= threshold)`,
        checkerTraffic: '~27,000 checker requests/hour against the routing API while armed',
        ...quorumRates()
      }
    });
  }

  const table = env('ROUTING_CONFIG_TABLE');
  const logVersionsNewestFirst = [...(state.logVersions || [])]
    .sort((a, b) => b - a)
    .slice(0, QUORUM_LOG_RETURN_CAP);

  // One BatchGet for vote flags + broken flags + the newest log entries
  // (log versions are tracked on the state row, so no scan is ever needed).
  const keys = [
    ...voterIndexes.map((i) => ({ configId: quorumVoteKey(i) })),
    ...voterIndexes.map((i) => ({ configId: quorumBrokenKey(i) })),
    ...logVersionsNewestFirst.map((v) => ({ configId: quorumLogKey(v) }))
  ];
  const [batch, observations, failoverState] = await Promise.all([
    ddbDoc.send(new BatchGetCommand({ RequestItems: { [table]: { Keys: keys } } })),
    Promise.all(state.voterHealthCheckIds.map((id) => observeHealthCheck(id))),
    getState()
  ]);
  const items = batch.Responses?.[table] || [];
  const byConfigId = new Map(items.map((item) => [item.configId as string, item]));

  const voters = voterIndexes.map((i) => {
    const observation = observations[i - 1];
    return {
      i,
      on: byConfigId.has(quorumVoteKey(i)),
      broken: byConfigId.has(quorumBrokenKey(i)),
      healthCheckId: state.voterHealthCheckIds[i - 1] || '',
      status: observation.status,
      healthyCount: observation.healthyCount,
      checkersReporting: observation.checkersReporting
    };
  });

  // Correction 1, honestly labeled: GetHealthCheckStatus does NOT work on
  // CALCULATED checks, so the parent's status is COMPUTED here the same way
  // Route 53 computes it: count(healthy children) >= HealthThreshold.
  const healthyChildren = voters.filter((v) => v.status === 'healthy').length;
  const parentOn = healthyChildren >= state.threshold;

  let storedControl = state.storedControl;
  let decisionLogItems = logVersionsNewestFirst
    .map((v) => byConfigId.get(quorumLogKey(v)))
    .filter((item): item is Record<string, any> => !!item);

  if (parentOn !== storedControl.on) {
    // Genuine parent transition → commit a NEW version to the decision log.
    // This runs in the polled status handler, so two concurrent polls can
    // race; last write wins, which is acceptable for a demo and documented.
    const version = storedControl.version + 1;
    const at = new Date().toISOString();
    const entry: QuorumLogItem = {
      configId: quorumLogKey(version),
      version,
      decision: parentOn ? 'on' : 'off',
      healthyChildren,
      threshold: state.threshold,
      at
    };
    await ddbDoc.send(new PutCommand({ TableName: table, Item: entry }));

    storedControl = { on: parentOn, version, since: at };
    const updatedState: QuorumState = {
      ...state,
      lastParentStatus: parentOn ? 'on' : 'off',
      storedControl,
      logVersions: [...(state.logVersions || []), version]
    };
    await ddbDoc.send(new PutCommand({ TableName: table, Item: updatedState }));
    decisionLogItems = [entry, ...decisionLogItems];
  }

  const decisionLog = decisionLogItems
    .sort((a, b) => (b.version as number) - (a.version as number))
    .slice(0, QUORUM_LOG_RETURN_CAP)
    .map((item) => ({
      version: item.version,
      decision: item.decision,
      healthyChildren: item.healthyChildren,
      threshold: item.threshold,
      at: item.at
    }));

  // Wire truth comes from the RECORD, not our state row: report the PRIMARY
  // failover record's ACTUAL HealthCheckId when it can be read.
  const failoverArmed = !!failoverState?.armed;
  let recordHealthCheckId: string | null = null;
  if (failoverArmed && env('HOSTED_ZONE_ID') && env('DOMAIN_NAME')) {
    try {
      const records = await listFailoverRecordSets(route53, env('HOSTED_ZONE_ID'), env('DOMAIN_NAME'));
      recordHealthCheckId = records.find((r) => r.Failover === 'PRIMARY')?.HealthCheckId || null;
    } catch (error) {
      console.warn('Could not read the PRIMARY failover record for wire status:', error);
    }
  }

  const armedMinutes = Math.max(0, (Date.now() - new Date(state.armedAt).getTime()) / 60000);

  return respond(200, {
    armed: true,
    threshold: state.threshold,
    armedAt: state.armedAt,
    voters,
    parent: {
      healthCheckId: state.parentHealthCheckId,
      threshold: state.threshold,
      healthyChildren,
      status: parentOn ? 'healthy' : 'unhealthy',
      computedFrom: 'count(healthy children) >= threshold, computed from the child checks\' checker observations — Route 53 does not expose GetHealthCheckStatus for CALCULATED health checks'
    },
    storedControl,
    decisionLog,
    wire: {
      wired: !!state.wired,
      failoverArmed,
      recordHealthCheckId,
      pointsAtParent: recordHealthCheckId !== null && recordHealthCheckId === state.parentHealthCheckId
    },
    voteStatusUrl: `https://${state.host}${state.pathPrefix}/vote-status/{i}`,
    estimatedCost: {
      ...quorumRates(),
      armedMinutes: Math.round(armedMinutes),
      accruedUsd: Number(((armedMinutes / 60) * QUORUM_RATE_PER_HOUR_USD).toFixed(4))
    }
  });
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

    // Quorum routes dispatch BEFORE the hosted-zone gate: the quorum demo
    // works without a custom domain (its checkers hit the API Gateway
    // hostname directly). Only /admin/quorum/wire needs the zone, and it
    // checks that itself.
    if (path.startsWith('/vote-status/') && method === 'GET') {
      return await handleVoteStatus(event);
    }
    if (path === '/admin/quorum/arm' && method === 'POST') {
      return await handleQuorumArm(event);
    }
    if (path === '/admin/quorum/disarm' && method === 'POST') {
      return await handleQuorumDisarm();
    }
    if (path === '/admin/quorum/vote' && method === 'POST') {
      return await handleQuorumVote(event);
    }
    if (path === '/admin/quorum/break-voter' && method === 'POST') {
      return await handleQuorumBreakVoter(event);
    }
    if (path === '/admin/quorum/wire' && method === 'POST') {
      return await handleQuorumWire(event);
    }
    if (path === '/admin/quorum/status' && method === 'GET') {
      return await handleQuorumStatus();
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
