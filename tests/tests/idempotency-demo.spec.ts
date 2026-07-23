/**
 * Idempotency demo (admin dashboard, cross-region payment dedupe UI).
 *
 * Two suites, mirroring failover-demo.spec.ts's harness exactly:
 *
 *  1. "stubbed"  — needs NO env vars and NO network. The local admin build
 *     (frontend/admin/dist) is served entirely via page.route at
 *     http://localhost:3000 — the same origin the app targets for its API
 *     when the hostname is "localhost" (http://localhost:3000/prod), so API
 *     calls are same-origin and every request is intercepted in-process.
 *     Skips (cleanly) only when the admin build output does not exist.
 *  2. "deployed" — house pattern: skips cleanly when ADMIN_BASE_URL is unset.
 *
 * The stub backend SIMULATES the real contract of idem-admin.ts + pay.py:
 * shared mode dedupes by (orderId, amount) across regions and returns the
 * ORIGINAL receipt (same chargeId, region = who executed); isolated mode
 * keeps per-region stores so a cross-region retry genuinely double-charges.
 */
import { test, expect, Page, Route } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { ADMIN_BASE_URL } from './config';

const ADMIN_DIST = path.resolve(__dirname, '../../frontend/admin/dist');
const HAS_ADMIN_BUILD = fs.existsSync(path.join(ADMIN_DIST, 'index.html'));
// The app served at localhost targets this API base (see admin App.tsx).
const APP_ORIGIN = 'http://localhost:3000';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PRIMARY = 'us-east-1';
const SECONDARY = 'us-west-2';
const PRIMARY_API = 'https://idem-a.execute-api.us-east-1.amazonaws.com/prod';
const SECONDARY_API = 'https://idem-b.execute-api.us-west-2.amazonaws.com/prod';

interface StubReceipt {
  orderId: string;
  amount: number;
  chargeId: string;
  region: string;
  processedAt: string;
  executionId: string;
}

interface StubChargeRow {
  id: string;
  orderId: string;
  amount: number;
  chargeId: string;
  region: string;
  processedAt: string;
}

// ---------------------------------------------------------------------------
// Stub harness
// ---------------------------------------------------------------------------

/** Mutable backend the routes read on every request — tests flip its fields. */
interface StubBackend {
  configured: boolean;
  /** When set, /admin/idem/status returns this verbatim (contract-drift tests). */
  statusOverride?: any;
  /** When set, the next /admin/idem/pay returns this verbatim. */
  payOverride?: { status: number; body: any };
  killed: Record<string, boolean>;
  sharedStore: Map<string, StubReceipt>; // global table: one store, both regions see it
  isolatedStore: Record<string, Map<string, StubReceipt>>; // per-region stores
  charges: Record<string, StubChargeRow[]>;
  payCalls: any[];
  chaosCalls: any[];
  chargeSeq: number;
}

const newBackend = (): StubBackend => ({
  configured: true,
  killed: { [PRIMARY]: false, [SECONDARY]: false },
  sharedStore: new Map(),
  isolatedStore: { [PRIMARY]: new Map(), [SECONDARY]: new Map() },
  charges: { [PRIMARY]: [], [SECONDARY]: [] },
  payCalls: [],
  chaosCalls: [],
  chargeSeq: 0
});

const payKey = (orderId: string, amount: number) => `${orderId}|${amount}`;

/** Powertools stores a HASHED id (module.function#md5) — mimic that shape. */
const hashedId = (fn: string, orderId: string, amount: number) =>
  `pay.charge_${fn}#md5-${Buffer.from(payKey(orderId, amount)).toString('hex').slice(0, 16)}`;

const idemRecord = (fn: string, receipt: StubReceipt) => ({
  id: hashedId(fn, receipt.orderId, receipt.amount),
  status: 'COMPLETED',
  expiration: Math.floor(Date.now() / 1000) + 3600,
  data: receipt,
  orderId: receipt.orderId,
  chargeId: receipt.chargeId,
  region: receipt.region
});

const doCharge = (backend: StubBackend, region: string, orderId: string, amount: number): StubReceipt => {
  backend.chargeSeq += 1;
  const receipt: StubReceipt = {
    orderId,
    amount,
    chargeId: `ch_${String(backend.chargeSeq).padStart(4, '0')}${region === PRIMARY ? 'a' : 'b'}`,
    region,
    processedAt: new Date().toISOString(),
    executionId: `ex${backend.chargeSeq}`
  };
  backend.charges[region].push({
    id: `CHARGE#${orderId}#${backend.chargeSeq}`,
    orderId,
    amount,
    chargeId: receipt.chargeId,
    region,
    processedAt: receipt.processedAt
  });
  return receipt;
};

const handlePay = (backend: StubBackend, body: any): { status: number; body: any } => {
  const { region, orderId, amount, mode } = body;
  if (backend.killed[region]) {
    return {
      status: 503,
      body: { error: 'Region is killed (chaos flag active) - payment refused', region, killed: true }
    };
  }
  const key = payKey(orderId, amount);
  if (mode === 'shared') {
    const existing = backend.sharedStore.get(key);
    if (existing) {
      // The global table replicated the record: the retry region returns the
      // ORIGINAL stored receipt — identical chargeId, region = who executed.
      return { status: 200, body: { ...existing, mode, servedBy: region } };
    }
    const receipt = doCharge(backend, region, orderId, amount);
    backend.sharedStore.set(key, receipt);
    return { status: 200, body: { ...receipt, mode, servedBy: region } };
  }
  const store = backend.isolatedStore[region];
  const existing = store.get(key);
  if (existing) {
    return { status: 200, body: { ...existing, mode, servedBy: region } };
  }
  const receipt = doCharge(backend, region, orderId, amount);
  store.set(key, receipt);
  return { status: 200, body: { ...receipt, mode, servedBy: region } };
};

const buildStatus = (backend: StubBackend) => {
  if (!backend.configured) return { configured: false, regions: [], sharedRecords: [] };
  const sharedList = Array.from(backend.sharedStore.values());
  const regions = [
    { region: PRIMARY, apiUrl: PRIMARY_API },
    { region: SECONDARY, apiUrl: SECONDARY_API }
  ].map(({ region, apiUrl }) => ({
    region,
    apiUrl,
    health: { statusCode: backend.killed[region] ? 503 : 200, killed: backend.killed[region] },
    shared: sharedList.map((r) => idemRecord('shared', r)),
    isolated: Array.from(backend.isolatedStore[region].values()).map((r) => idemRecord('isolated', r)),
    charges: backend.charges[region]
  }));
  const sharedRecords = sharedList.map((r) => ({
    id: hashedId('shared', r.orderId, r.amount),
    orderId: r.orderId,
    inRegions: [PRIMARY, SECONDARY],
    replicated: true
  }));
  return { configured: true, regions, sharedRecords };
};

const jsonResponse = (body: any, status = 200) => ({
  status,
  contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' },
  body: JSON.stringify(body)
});

const STATIC_TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.map': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon'
};

function serveStatic(route: Route, urlPath: string) {
  let file = path.join(ADMIN_DIST, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(ADMIN_DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(ADMIN_DIST, 'index.html');
  }
  return route.fulfill({
    status: 200,
    contentType: STATIC_TYPES[path.extname(file)] || 'application/octet-stream',
    body: fs.readFileSync(file)
  });
}

async function handleApi(route: Route, apiPath: string, backend: StubBackend) {
  const method = route.request().method();

  if (apiPath === '/admin/idem/status') {
    return route.fulfill(jsonResponse(backend.statusOverride ?? buildStatus(backend)));
  }
  if (apiPath === '/admin/idem/pay' && method === 'POST') {
    const body = route.request().postDataJSON();
    backend.payCalls.push(body);
    const resp = backend.payOverride ?? handlePay(backend, body);
    return route.fulfill(jsonResponse(resp.body, resp.status));
  }
  if (apiPath === '/admin/idem/chaos' && method === 'POST') {
    const body = route.request().postDataJSON();
    backend.chaosCalls.push(body);
    backend.killed[body.region] = body.enabled;
    return route.fulfill(jsonResponse({ success: true, region: body.region, chaos: { enabled: body.enabled } }));
  }
  // Benign defaults for everything else the dashboard fetches on load
  // (the Cell Demo tab is mounted first, so these must be shape-correct).
  if (apiPath === '/admin/cells') return route.fulfill(jsonResponse({ cells: [] }));
  if (apiPath === '/admin/cell-urls') {
    return route.fulfill(jsonResponse({ cellUrls: [], customDomain: '', totalCells: 0 }));
  }
  if (apiPath === '/admin/hash-ring') {
    return route.fulfill(jsonResponse({ distribution: [], ring: [], totalVirtualNodes: 0 }));
  }
  return route.fulfill(jsonResponse({}));
}

/** One catch-all route serves the built app AND stubs its same-origin API. */
async function installStubs(page: Page, backend: StubBackend) {
  await page.route(`${APP_ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/prod/')) {
      return handleApi(route, url.pathname.slice('/prod'.length), backend);
    }
    return serveStatic(route, decodeURIComponent(url.pathname));
  });
}

async function openIdemTab(page: Page, baseUrl: string) {
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Idempotency' }).click();
  await expect(page.getByTestId('idem-root')).toBeVisible();
}

// ---------------------------------------------------------------------------
// Suite 1: fully stubbed — runs without any deployment env vars
// ---------------------------------------------------------------------------

test.describe('Idempotency demo — stubbed admin build', () => {
  test.skip(!HAS_ADMIN_BUILD,
    'frontend/admin/dist not built — run `cd frontend/admin && npm run build` first');
  // One engine is enough for a fully-stubbed UI suite, and firefox/webkit may
  // not be installed where only PW_CHROMIUM_PATH is provisioned.
  test.skip(({ browserName }) => browserName !== 'chromium', 'stubbed suite runs on chromium only');

  // Every request is fulfilled by page.route — nothing listens on this origin.
  const baseUrl = APP_ORIGIN;

  test('unconfigured: deploy-hint panel, no region cards', async ({ page }) => {
    const backend = newBackend();
    backend.configured = false;
    await installStubs(page, backend);
    await openIdemTab(page, baseUrl);

    await expect(page.getByTestId('idem-unconfigured')).toBeVisible();
    await expect(page.getByTestId('idem-unconfigured')).toContainText('IDEM_ENDPOINTS');
    await expect(page.getByTestId('idem-unconfigured')).toContainText('deploy.sh');
    await expect(page.getByTestId(`region-card-${PRIMARY}`)).toHaveCount(0);
  });

  test('configured: region cards primary-first, health chips, controls, cost note', async ({ page }) => {
    const backend = newBackend();
    await installStubs(page, backend);
    await openIdemTab(page, baseUrl);

    // Primary-first ordering straight from the endpoints row.
    const cards = page.locator('[data-testid^="region-card-"]');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toHaveAttribute('data-testid', `region-card-${PRIMARY}`);
    await expect(cards.nth(1)).toHaveAttribute('data-testid', `region-card-${SECONDARY}`);
    await expect(page.getByTestId(`region-card-${PRIMARY}`)).toContainText('primary');
    await expect(page.getByTestId(`region-card-${SECONDARY}`)).toContainText('secondary');

    await expect(page.getByTestId(`idem-health-${PRIMARY}`)).toHaveClass(/good/);
    await expect(page.getByTestId(`idem-health-${SECONDARY}`)).toHaveClass(/good/);

    // Order controls: auto-generated editable orderId, amount, mode toggle.
    await expect(page.getByTestId('order-id-input')).toHaveValue(/^order-/);
    await expect(page.getByTestId('amount-input')).toHaveValue('25');
    await expect(page.getByTestId('mode-toggle')).toBeVisible();
    await expect(page.getByTestId('mode-shared')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('mode-isolated')).toHaveAttribute('aria-pressed', 'false');

    // Pay/retry name their regions.
    await expect(page.getByTestId('pay-button')).toHaveText(`Pay via ${PRIMARY}`);
    await expect(page.getByTestId('retry-button')).toHaveText(`Retry same order via ${SECONDARY}`);

    // Near-zero-cost note (unlike failover/quorum, nothing bills hourly).
    await expect(page.getByTestId('idem-root')).toContainText('Near-zero cost');
    expect(await page.locator('body').innerText()).not.toMatch(/simulat/i);
  });

  test('dedupe: pay A, kill A, retry B returns the SAME chargeId with executed-by proof', async ({ page }) => {
    const backend = newBackend();
    await installStubs(page, backend);
    await openIdemTab(page, baseUrl);

    await page.getByTestId('order-id-input').fill('order-demo1');
    await page.getByTestId('pay-button').click();

    const firstCard = page.getByTestId('outcome-card').first();
    await expect(firstCard).toContainText('Charged');
    await expect(firstCard).toContainText('ch_0001a');
    expect(backend.payCalls[0]).toEqual({
      region: PRIMARY, orderId: 'order-demo1', amount: 25, mode: 'shared'
    });

    // Kill the primary region (server-side chaos proxy, never a direct call).
    await page.getByTestId(`kill-toggle-${PRIMARY}`).click();
    await expect.poll(() => backend.chaosCalls.length).toBe(1);
    expect(backend.chaosCalls[0]).toEqual({ region: PRIMARY, enabled: true });
    await expect(page.getByTestId(`idem-health-${PRIMARY}`)).toHaveClass(/bad/, { timeout: 10_000 });
    await expect(page.getByTestId(`idem-health-${PRIMARY}`)).toContainText('503');
    await expect(page.getByTestId(`idem-health-${PRIMARY}`)).toContainText('killed');
    await expect(page.getByTestId(`kill-toggle-${PRIMARY}`)).toContainText(`Revive ${PRIMARY}`);

    // Retry the same order via the secondary: deduped, identical chargeId.
    await page.getByTestId('retry-button').click();
    const retryCard = page.getByTestId('outcome-card').first();
    await expect(retryCard).toContainText('Deduped');
    await expect(retryCard).toContainText('ch_0001a'); // SAME chargeId as attempt 1
    await expect(retryCard).toContainText(`served by ${SECONDARY}, executed by ${PRIMARY}`);

    // Requests-vs-charges: two requests, but money moved exactly once.
    await expect(page.getByTestId('request-counter')).toHaveText('2');
    await expect(page.getByTestId('charge-counter')).toHaveText('1');

    // Under the covers: replicated shared record + records tables both sides.
    await expect(page.getByTestId('replicated-badge')).toBeVisible();
    await expect(page.getByTestId('replicated-badge')).toContainText(`${PRIMARY} + ${SECONDARY}`);
    await expect(page.getByTestId(`records-table-${PRIMARY}`)).toContainText('COMPLETED');
    await expect(page.getByTestId(`records-table-${PRIMARY}`)).toContainText('order-demo1');
    await expect(page.getByTestId(`records-table-${SECONDARY}`)).toContainText('order-demo1');

    const timeline = page.getByTestId('timeline');
    await expect(timeline).toContainText('Deduped');
    await expect(timeline).toContainText(`Kill switch active on ${PRIMARY}`);
  });

  test('double charge: isolated mode retry via B charges AGAIN', async ({ page }) => {
    const backend = newBackend();
    await installStubs(page, backend);
    await openIdemTab(page, baseUrl);

    await page.getByTestId('order-id-input').fill('order-double');
    await page.getByTestId('mode-isolated').click();
    await expect(page.getByTestId('mode-isolated')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('pay-button').click();
    await expect(page.getByTestId('outcome-card').first()).toContainText('Charged');

    await page.getByTestId('retry-button').click();
    const retryCard = page.getByTestId('outcome-card').first();
    await expect(retryCard).toContainText('Double-charged');
    await expect(retryCard).toContainText('money moved a second time');

    expect(backend.payCalls.map((c) => c.mode)).toEqual(['isolated', 'isolated']);

    // Two REAL charge rows, one per region — the honest proof.
    await expect(page.getByTestId('charge-counter')).toHaveText('2');
    await expect(page.getByTestId('charge-counter')).toHaveClass(/bad/);
    expect(backend.charges[PRIMARY]).toHaveLength(1);
    expect(backend.charges[SECONDARY]).toHaveLength(1);
    expect(backend.charges[PRIMARY][0].chargeId).not.toBe(backend.charges[SECONDARY][0].chargeId);

    await expect(page.getByTestId('timeline')).toContainText('DOUBLE CHARGE');
  });

  test('409 in-progress: honest badge, nothing counted as charged', async ({ page }) => {
    const backend = newBackend();
    await installStubs(page, backend);
    await openIdemTab(page, baseUrl);

    await page.getByTestId('order-id-input').fill('order-race');
    backend.payOverride = {
      status: 409,
      body: {
        error: 'A payment with this exact payload is already in progress - retry after it completes',
        region: PRIMARY,
        orderId: 'order-race',
        inProgress: true
      }
    };
    await page.getByTestId('pay-button').click();

    const card = page.getByTestId('outcome-card').first();
    await expect(card).toContainText('In progress');
    await expect(card).toContainText('already in progress');
    await expect(page.getByTestId('charge-counter')).toHaveText('0');
    await expect(page.getByTestId('timeline')).toContainText('In progress (409)');
  });

  test('paying a killed region fails honestly (503)', async ({ page }) => {
    const backend = newBackend();
    backend.killed[PRIMARY] = true;
    await installStubs(page, backend);
    await openIdemTab(page, baseUrl);

    await expect(page.getByTestId(`idem-health-${PRIMARY}`)).toHaveClass(/bad/);
    await page.getByTestId('order-id-input').fill('order-dead');
    await page.getByTestId('pay-button').click();

    const card = page.getByTestId('outcome-card').first();
    await expect(card).toContainText('Failed');
    await expect(card).toContainText('killed');
    await expect(page.getByTestId('charge-counter')).toHaveText('0');
  });

  test('contract drift guard: regions as a keyed object degrades to the boundary panel', async ({ page }) => {
    const backend = newBackend();
    // The arrays-not-keyed-objects contract, violated on purpose: a payload
    // like this must surface the DemoBoundary error panel, NOT a blank page.
    backend.statusOverride = {
      configured: true,
      regions: {
        [PRIMARY]: { region: PRIMARY, apiUrl: PRIMARY_API, health: { statusCode: 200, killed: false }, shared: [], isolated: [], charges: [] },
        [SECONDARY]: { region: SECONDARY, apiUrl: SECONDARY_API, health: { statusCode: 200, killed: false }, shared: [], isolated: [], charges: [] }
      },
      sharedRecords: []
    };
    await installStubs(page, backend);
    await page.goto(baseUrl);
    await page.getByRole('button', { name: 'Idempotency' }).click();

    const boundary = page.getByTestId('demo-boundary-panel');
    await expect(boundary).toBeVisible({ timeout: 10_000 });
    await expect(boundary).toContainText('rendering error');
    await expect(boundary.getByRole('button', { name: 'Reload panel' })).toBeVisible();
    // Not a blank page: the rest of the dashboard is still standing.
    await expect(page.getByRole('button', { name: 'Cell demo' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: deployed (house pattern — skips without ADMIN_BASE_URL)
// ---------------------------------------------------------------------------

test.describe('Idempotency demo — deployed admin', () => {
  test.skip(!ADMIN_BASE_URL, 'ADMIN_BASE_URL not set — no deployment to test against');

  test('idempotency tab loads live status', async ({ page }) => {
    const statusCalls: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/admin/idem/status')) statusCalls.push(request.url());
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Idempotency' }).click();
    await expect(page.getByTestId('idem-root')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Idempotency across regional failover/ })).toBeVisible();

    // Status poll fired; one of the two states is on screen.
    await expect.poll(() => statusCalls.length, { timeout: 20_000 }).toBeGreaterThan(0);
    await expect(
      page.getByTestId('idem-unconfigured').or(page.locator('[data-testid^="region-card-"]').first())
    ).toBeVisible({ timeout: 20_000 });
  });
});
