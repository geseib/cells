import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

// Admin surface for the idempotency-across-failover demo. Deliberately NOT
// part of failover-admin: this function needs zero Route 53 IAM and must keep
// working without a hosted zone/domain (no 503 gate). Its only AWS read is
// the IDEM_ENDPOINTS row in routing-config; everything else is proxied
// server-side to the regional idem APIs (browser only ever talks to the
// admin API host - same proxy-friendly rule as the failover demo).
const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const ENDPOINTS_CONFIG_ID = 'IDEM_ENDPOINTS';

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

interface IdemEndpoint {
  region: string;
  apiUrl: string;
}

interface RegionRecords {
  shared: any[];
  isolated: any[];
  charges: any[];
}

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

/**
 * IDEM_ENDPOINTS is written by deploy.sh after the two idem stacks deploy,
 * ORDERED PRIMARY FIRST — this handler preserves that order everywhere.
 * Missing/empty row = the demo is not deployed (the FE shows a hint state).
 */
async function getEndpoints(): Promise<IdemEndpoint[] | null> {
  const result = await ddbDoc.send(new GetCommand({
    TableName: env('ROUTING_CONFIG_TABLE'),
    Key: { configId: ENDPOINTS_CONFIG_ID }
  }));
  const endpoints = (result.Item as { endpoints?: IdemEndpoint[] } | undefined)?.endpoints;
  if (!Array.isArray(endpoints)) return null;
  const valid = endpoints.filter(
    (e) => typeof e?.region === 'string' && typeof e?.apiUrl === 'string' && e.apiUrl.length > 0
  );
  return valid.length > 0 ? valid : null;
}

const NOT_CONFIGURED =
  'Idempotency demo endpoints are not configured — deploy.sh writes IDEM_ENDPOINTS into routing-config after the idem stacks deploy';

async function handlePay(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  let body: any = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { success: false, error: 'Request body must be JSON' });
  }
  const { region, orderId, amount, mode } = body;

  const endpoints = await getEndpoints();
  if (!endpoints) {
    return respond(503, { configured: false, error: NOT_CONFIGURED });
  }

  if (mode !== 'shared' && mode !== 'isolated') {
    return respond(400, { success: false, error: "mode must be 'shared' or 'isolated'" });
  }
  const target = endpoints.find((e) => e.region === region);
  if (!target) {
    return respond(400, {
      success: false,
      error: `region must be one of: ${endpoints.map((e) => e.region).join(', ')}`
    });
  }
  if (typeof orderId !== 'string' || orderId.trim().length === 0) {
    return respond(400, { success: false, error: 'orderId (non-empty string) is required' });
  }
  if (typeof amount !== 'number' || !(amount > 0)) {
    return respond(400, { success: false, error: 'amount (positive number) is required' });
  }

  try {
    // Pass the regional API's status straight through: 200 receipt, 409
    // in-progress race, 503 killed region — all honest outcomes the FE maps
    // to badges. The receipt's `region` field (where the charge EXECUTED) is
    // the dedupe proof, so never rewrite it; `region` here is who we asked.
    const { statusCode, body: resBody } = await fetchJson(`${target.apiUrl}/pay`, {
      method: 'POST',
      body: JSON.stringify({ orderId, amount, mode })
    });
    return respond(statusCode, { region, ...(resBody ?? {}) });
  } catch (error) {
    return respond(502, {
      region,
      error: `Could not reach ${region} idem API: ${error instanceof Error ? error.message : 'fetch failed'}`
    });
  }
}

async function fetchRegionHealth(ep: IdemEndpoint): Promise<{ statusCode: number; killed: boolean }> {
  try {
    const { statusCode, body } = await fetchJson(`${ep.apiUrl}/health`);
    return { statusCode, killed: body?.killed === true };
  } catch {
    return { statusCode: 0, killed: false }; // unreachable ≠ killed-by-chaos
  }
}

async function fetchRegionRecords(ep: IdemEndpoint): Promise<RegionRecords> {
  try {
    const { statusCode, body } = await fetchJson(`${ep.apiUrl}/records`);
    if (statusCode !== 200 || !body) return { shared: [], isolated: [], charges: [] };
    return {
      shared: Array.isArray(body.shared) ? body.shared : [],
      isolated: Array.isArray(body.isolated) ? body.isolated : [],
      charges: Array.isArray(body.charges) ? body.charges : []
    };
  } catch {
    return { shared: [], isolated: [], charges: [] };
  }
}

async function handleStatus(): Promise<APIGatewayProxyResult> {
  const endpoints = await getEndpoints();
  if (!endpoints) {
    return respond(200, { configured: false, regions: [], sharedRecords: [] });
  }

  const regions = await Promise.all(endpoints.map(async (ep) => {
    const [health, records] = await Promise.all([fetchRegionHealth(ep), fetchRegionRecords(ep)]);
    return {
      region: ep.region,
      apiUrl: ep.apiUrl,
      health,
      shared: records.shared,
      isolated: records.isolated,
      charges: records.charges
    };
  }));

  // Replication badge by id-set intersection: a shared idempotency record's
  // raw (hashed) id is the same in every replica, so an id present in ALL
  // regions' shared scans has replicated; anything else is still in flight
  // (or one replica scan failed — honest either way).
  const byId = new Map<string, { orderId: string | null; inRegions: string[] }>();
  for (const r of regions) {
    for (const rec of r.shared) {
      const id = typeof rec?.id === 'string' ? rec.id : null;
      if (!id) continue;
      const entry = byId.get(id) || { orderId: null, inRegions: [] };
      if (entry.orderId === null && typeof rec?.orderId === 'string') entry.orderId = rec.orderId;
      if (!entry.inRegions.includes(r.region)) entry.inRegions.push(r.region);
      byId.set(id, entry);
    }
  }
  const sharedRecords = Array.from(byId.entries()).map(([id, entry]) => ({
    id,
    orderId: entry.orderId,
    inRegions: entry.inRegions,
    replicated: entry.inRegions.length === regions.length
  }));

  return respond(200, { configured: true, regions, sharedRecords });
}

async function handleChaosProxy(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  let body: any = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { success: false, error: 'Request body must be JSON' });
  }
  const { region, enabled, durationMinutes } = body;

  const endpoints = await getEndpoints();
  if (!endpoints) {
    return respond(503, { configured: false, error: NOT_CONFIGURED });
  }
  if (typeof enabled !== 'boolean') {
    return respond(400, { success: false, error: 'enabled (boolean) is required' });
  }
  const target = endpoints.find((e) => e.region === region);
  if (!target) {
    return respond(400, {
      success: false,
      error: `region must be one of: ${endpoints.map((e) => e.region).join(', ')}`
    });
  }

  try {
    const { statusCode, body: resBody } = await fetchJson(`${target.apiUrl}/chaos`, {
      method: 'POST',
      body: JSON.stringify({ enabled, durationMinutes })
    });
    if (statusCode < 200 || statusCode >= 300) {
      return respond(502, { success: false, error: `${region} idem API /chaos returned ${statusCode}` });
    }
    return respond(200, { success: true, region, ...(resBody ?? {}) });
  } catch (error) {
    return respond(502, {
      success: false,
      error: `Could not reach ${region} idem API: ${error instanceof Error ? error.message : 'fetch failed'}`
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

    if (path === '/admin/idem/pay' && method === 'POST') {
      return await handlePay(event);
    } else if (path === '/admin/idem/status' && method === 'GET') {
      return await handleStatus();
    } else if (path === '/admin/idem/chaos' && method === 'POST') {
      return await handleChaosProxy(event);
    }

    return respond(404, { error: 'Not found' });
  } catch (error) {
    console.error('Error in idem-admin handler:', error);
    return respond(500, { success: false, error: 'Internal server error' });
  }
};
