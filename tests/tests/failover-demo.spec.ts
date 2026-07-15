/**
 * Failover demo (admin dashboard, real Route 53 arm/disarm UI).
 *
 * Two suites:
 *
 *  1. "deployed"  — house pattern: skips cleanly when ADMIN_BASE_URL is unset.
 *  2. "stubbed"   — needs NO env vars and NO network. The local admin build
 *     (frontend/admin/dist) is served entirely via page.route at
 *     http://localhost:3000 — the same origin the app targets for its API
 *     when the hostname is "localhost" (http://localhost:3000/prod), so API
 *     calls are same-origin and every request (app assets, API, and the DoH
 *     resolvers dns.google / cloudflare-dns.com) is intercepted in-process.
 *     Skips (cleanly) only when the admin build output does not exist.
 *
 * Do not copy selectors from admin-dashboard.spec.ts — it predates the tabbed UI.
 */
import { test, expect, Page, Route } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { ADMIN_BASE_URL } from './config';

const ADMIN_DIST = path.resolve(__dirname, '../../frontend/admin/dist');
const HAS_ADMIN_BUILD = fs.existsSync(path.join(ADMIN_DIST, 'index.html'));
// The app served at localhost targets this API base (see admin App.tsx).
const APP_ORIGIN = 'http://localhost:3000';
const STUB_API = `${APP_ORIGIN}/prod`;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PRIMARY = 'us-east-1-az1';
const SECONDARY = 'us-west-2-az1';
const PENDING = 'eu-west-1-az1'; // registered but no apiUrl yet (heartbeat pending)
const PRIMARY_HOST = 'api-primary.execute-api.us-east-1.amazonaws.com';
const SECONDARY_HOST = 'api-secondary.execute-api.us-west-2.amazonaws.com';
const FQDN = 'failover.cells.example.com';
const RATE = 0.0068;

const cellUrls = () => ({
  cellUrls: [
    {
      cellId: PRIMARY, region: 'us-east-1', availabilityZone: 'az1',
      directUrl: 'https://cell-a.example.com', routingUrl: '', weight: 1, active: true,
      apiUrl: `https://${PRIMARY_HOST}/prod`
    },
    {
      cellId: SECONDARY, region: 'us-west-2', availabilityZone: 'az1',
      directUrl: 'https://cell-b.example.com', routingUrl: '', weight: 1, active: true,
      apiUrl: `https://${SECONDARY_HOST}/prod`
    },
    {
      cellId: PENDING, region: 'eu-west-1', availabilityZone: 'az1',
      directUrl: 'https://cell-c.example.com', routingUrl: '', weight: 1, active: true,
      apiUrl: ''
    }
  ],
  customDomain: 'cells.example.com',
  totalCells: 3
});

const statusUnarmed = () => ({
  armed: false,
  failoverFqdn: FQDN,
  estimatedCost: { ratePerHourUsd: RATE }
});

const records = () => ([
  {
    name: `${FQDN}.`, type: 'CNAME', ttl: 15, setIdentifier: 'primary',
    failover: 'PRIMARY', healthCheckId: 'hc-primary-1', values: [PRIMARY_HOST]
  },
  {
    name: `${FQDN}.`, type: 'CNAME', ttl: 15, setIdentifier: 'secondary',
    failover: 'SECONDARY', healthCheckId: 'hc-secondary-1', values: [SECONDARY_HOST]
  }
]);

const statusArmedHealthy = () => ({
  armed: true,
  failoverFqdn: FQDN,
  primaryCellId: PRIMARY,
  secondaryCellId: SECONDARY,
  armedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  healthChecks: [
    { cellId: PRIMARY, healthCheckId: 'hc-primary-1', checkersReporting: 16, healthyCount: 16, status: 'healthy' },
    { cellId: SECONDARY, healthCheckId: 'hc-secondary-1', checkersReporting: 16, healthyCount: 16, status: 'healthy' }
  ],
  records: records(),
  cellHealth: [
    { cellId: PRIMARY, statusCode: 200, chaos: null },
    { cellId: SECONDARY, statusCode: 200, chaos: null }
  ],
  dnsAnswer: { value: PRIMARY_HOST, matchesCellId: PRIMARY, resolvedAt: new Date().toISOString() },
  estimatedCost: { ratePerHourUsd: RATE, armedMinutes: 5, accruedUsd: 0.0006 }
});

const statusArmedFailing = () => {
  const s = statusArmedHealthy();
  s.healthChecks[0] = {
    cellId: PRIMARY, healthCheckId: 'hc-primary-1', checkersReporting: 16, healthyCount: 2, status: 'unhealthy'
  };
  s.cellHealth[0] = {
    cellId: PRIMARY, statusCode: 503,
    chaos: { enabled: true, expiresAt: Date.now() + 30 * 60_000 } as any
  };
  s.dnsAnswer = { value: SECONDARY_HOST, matchesCellId: SECONDARY, resolvedAt: new Date().toISOString() };
  return s;
};

const probeSecondary = () => ({
  armed: true,
  fqdn: FQDN,
  cnameTarget: SECONDARY_HOST,
  winningCellId: SECONDARY,
  cellInfo: { cellId: SECONDARY, region: 'us-west-2' },
  note: 'The probe fetches the CNAME target directly: failover.{domain} has no regional custom domain, so HTTPS to it would fail SNI.'
});

// ---------------------------------------------------------------------------
// Stub harness
// ---------------------------------------------------------------------------

/** Mutable backend the routes read on every request — tests flip its fields. */
interface StubBackend {
  status: any;
  cellUrls: any;
  probe: any;
  armResponse?: { status: number; body: any; delayMs?: number };
  armCalls: any[];
  chaosCalls: any[];
  disarmCalls: number;
}

const newBackend = (): StubBackend => ({
  status: statusUnarmed(),
  cellUrls: cellUrls(),
  probe: probeSecondary(),
  armCalls: [],
  chaosCalls: [],
  disarmCalls: 0
});

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

  if (apiPath === '/admin/failover/status') {
    return route.fulfill(jsonResponse(backend.status));
  }
  if (apiPath === '/admin/cell-urls') {
    return route.fulfill(jsonResponse(backend.cellUrls));
  }
  if (apiPath === '/admin/failover/arm' && method === 'POST') {
    backend.armCalls.push(route.request().postDataJSON());
    const resp = backend.armResponse || { status: 200, body: { armed: true } };
    if (resp.delayMs) await new Promise((r) => setTimeout(r, resp.delayMs));
    if (resp.status === 200) backend.status = statusArmedHealthy();
    return route.fulfill(jsonResponse(resp.body, resp.status));
  }
  if (apiPath === '/admin/failover/disarm' && method === 'POST') {
    backend.disarmCalls += 1;
    backend.status = statusUnarmed();
    return route.fulfill(jsonResponse({ armed: false }));
  }
  if (apiPath === '/admin/failover/chaos' && method === 'POST') {
    const body = route.request().postDataJSON();
    backend.chaosCalls.push(body);
    backend.status = body.enabled ? statusArmedFailing() : statusArmedHealthy();
    return route.fulfill(jsonResponse({ chaos: { enabled: body.enabled } }));
  }
  if (apiPath === '/admin/failover/probe') {
    return route.fulfill(jsonResponse(backend.probe));
  }
  // Benign defaults for everything else the dashboard fetches on load
  // (cells, hash-ring, clients, qr-code, ...).
  if (apiPath === '/admin/cells') return route.fulfill(jsonResponse({ cells: [] }));
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

async function blockDoh(page: Page) {
  await page.route('https://dns.google/**', (route) => route.abort('connectionrefused'));
  await page.route('https://cloudflare-dns.com/**', (route) => route.abort('connectionrefused'));
}

async function openFailoverTab(page: Page, baseUrl: string) {
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Failover demo' }).click();
  await expect(page.getByTestId('failover-root')).toBeVisible();
}

// ---------------------------------------------------------------------------
// Suite 1: source-level guard (no browser, no env, always runs)
// ---------------------------------------------------------------------------

test.describe('Failover demo — component source', () => {
  test('no simulation copy remains in FailoverDemo.tsx', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../frontend/admin/src/components/FailoverDemo.tsx'),
      'utf8'
    );
    expect(src).not.toMatch(/simulat/i);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: fully stubbed — runs without any deployment env vars
// ---------------------------------------------------------------------------

test.describe('Failover demo — stubbed admin build', () => {
  test.skip(!HAS_ADMIN_BUILD,
    'frontend/admin/dist not built — run `cd frontend/admin && npm run build` first');
  // One engine is enough for a fully-stubbed UI suite, and firefox/webkit may
  // not be installed where only PW_CHROMIUM_PATH is provisioned.
  test.skip(({ browserName }) => browserName !== 'chromium', 'stubbed suite runs on chromium only');

  // Every request is fulfilled by page.route — nothing listens on this origin.
  const baseUrl = APP_ORIGIN;

  test('unarmed: explainer, cost rate, pair pickers, disabled no-apiUrl cell, no simulation copy', async ({ page }) => {
    const backend = newBackend();
    await installStubs(page, backend);
    await openFailoverTab(page, baseUrl);

    await expect(page.getByTestId('unarmed-panel')).toBeVisible();
    await expect(page.getByTestId('unarmed-panel')).toContainText('2 Route 53 health checks');
    await expect(page.getByTestId('unarmed-panel')).toContainText('2 failover CNAME records');
    await expect(page.getByTestId('unarmed-panel')).toContainText(FQDN);
    await expect(page.getByTestId('unarmed-panel')).toContainText('$0.0068/hour');

    // Selects list all active cells; the one without apiUrl is disabled.
    const primarySelect = page.getByTestId('primary-select');
    await expect(primarySelect.locator('option', { hasText: PRIMARY })).not.toHaveAttribute('disabled');
    await expect(primarySelect.locator('option', { hasText: PENDING })).toHaveAttribute('disabled', '');
    await expect(page.getByTestId('apiurl-hint')).toContainText(PENDING);
    await expect(page.getByTestId('apiurl-hint')).toContainText('5 minutes');

    await expect(page.getByTestId('arm-button')).toBeEnabled();

    // The retired simulation walkthrough must be gone from the rendered tab.
    expect(await page.locator('body').innerText()).not.toMatch(/simulat/i);
  });

  test('arming: busy state, POST body, armed view appears with timeline entry', async ({ page }) => {
    const backend = newBackend();
    backend.armResponse = { status: 200, body: { armed: true }, delayMs: 500 };
    await installStubs(page, backend);
    await openFailoverTab(page, baseUrl);

    await page.getByTestId('primary-select').selectOption(PRIMARY);
    await page.getByTestId('secondary-select').selectOption(SECONDARY);
    await page.getByTestId('arm-button').click();

    await expect(page.getByTestId('arm-button')).toHaveText('Arming…');
    await expect(page.getByTestId('armed-panel')).toBeVisible({ timeout: 10_000 });

    expect(backend.armCalls).toEqual([{ primaryCellId: PRIMARY, secondaryCellId: SECONDARY }]);
    await expect(page.getByTestId('timeline')).toContainText(`Armed: ${PRIMARY} primary, ${SECONDARY} secondary`);
    await expect(page.getByTestId('timeline')).toContainText('Arm requested');
  });

  test('arm 422: heartbeat hint from the server is rendered', async ({ page }) => {
    const backend = newBackend();
    backend.armResponse = {
      status: 422,
      body: {
        error: `Cell ${SECONDARY} has not registered an API URL yet`,
        hint: 'The registration heartbeat publishes apiUrl within 5 minutes — wait for the next heartbeat and try again.'
      }
    };
    await installStubs(page, backend);
    await openFailoverTab(page, baseUrl);

    await page.getByTestId('primary-select').selectOption(PRIMARY);
    await page.getByTestId('secondary-select').selectOption(SECONDARY);
    await page.getByTestId('arm-button').click();

    await expect(page.getByTestId('action-error')).toContainText('has not registered an API URL');
    await expect(page.getByTestId('action-error')).toContainText('within 5 minutes');
    await expect(page.getByTestId('unarmed-panel')).toBeVisible(); // still unarmed
  });

  test('armed-healthy: pair, cost, checker cards, records, green health chips, DNS primary', async ({ page }) => {
    const backend = newBackend();
    backend.status = statusArmedHealthy();
    await installStubs(page, backend);
    await openFailoverTab(page, baseUrl);

    const armed = page.getByTestId('armed-panel');
    await expect(armed).toBeVisible();
    await expect(armed).toContainText(PRIMARY);
    await expect(armed).toContainText(SECONDARY);
    await expect(page.getByTestId('cost-line')).toContainText('$0.0068/hour');
    await expect(page.getByTestId('cost-line')).toContainText('so far');

    // Two checker cards with healthy/total counts and a status pill.
    await expect(page.getByTestId(`checker-card-${PRIMARY}`)).toContainText('16/16');
    await expect(page.getByTestId(`checker-card-${PRIMARY}`)).toContainText('healthy');
    await expect(page.getByTestId(`checker-card-${SECONDARY}`)).toContainText('16/16');

    // Record cards render the two CNAMEs.
    const cards = page.getByTestId('record-cards');
    await expect(cards).toContainText('CNAME');
    await expect(cards).toContainText(PRIMARY_HOST);
    await expect(cards).toContainText(SECONDARY_HOST);
    await expect(cards).toContainText('PRIMARY');
    await expect(cards).toContainText('SECONDARY');

    // Both cells healthy: green chips, no chaos badge.
    await expect(page.getByTestId(`health-chip-${PRIMARY}`)).toHaveClass(/good/);
    await expect(page.getByTestId(`health-chip-${SECONDARY}`)).toHaveClass(/good/);
    await expect(page.getByTestId(`health-chip-${PRIMARY}`)).not.toContainText('chaos');

    // Server-reported DNS answer is the primary display.
    await expect(page.getByTestId('dns-answer')).toContainText(PRIMARY_HOST);
    await expect(page.getByTestId('dns-pill')).toHaveText('Primary');

    // Chaos + disarm controls present; timeline observed the armed state.
    await expect(page.getByTestId('chaos-toggle')).toContainText(`Break ${PRIMARY}'s /health`);
    await expect(page.getByTestId('disarm-button')).toBeVisible();
    await expect(page.getByTestId('timeline')).toContainText('Observed armed state');

    expect(await page.locator('body').innerText()).not.toMatch(/simulat/i);
  });

  test('armed-failing: chaos toggle drives 503 chip, unhealthy checker, DNS flip, timeline entries', async ({ page }) => {
    const backend = newBackend();
    backend.status = statusArmedHealthy();
    await installStubs(page, backend);
    await openFailoverTab(page, baseUrl);
    await expect(page.getByTestId('armed-panel')).toBeVisible();

    await page.getByTestId('chaos-toggle').click();

    // Chaos POST went to the admin proxy endpoint (never to a cell API).
    await expect.poll(() => backend.chaosCalls.length).toBe(1);
    expect(backend.chaosCalls[0]).toEqual({ cellId: PRIMARY, enabled: true });

    // Failing state (from the post-toggle refresh / next 5s poll):
    await expect(page.getByTestId(`health-chip-${PRIMARY}`)).toHaveClass(/bad/, { timeout: 10_000 });
    await expect(page.getByTestId(`health-chip-${PRIMARY}`)).toContainText('503');
    await expect(page.getByTestId(`health-chip-${PRIMARY}`)).toContainText('chaos');
    await expect(page.getByTestId(`checker-card-${PRIMARY}`)).toContainText('unhealthy');
    await expect(page.getByTestId(`checker-card-${PRIMARY}`)).toContainText('2/16');
    await expect(page.getByTestId('dns-answer')).toContainText(SECONDARY_HOST);
    await expect(page.getByTestId('dns-pill')).toHaveText('Secondary');
    await expect(page.getByTestId('chaos-toggle')).toContainText(`Heal ${PRIMARY}'s /health`);

    // Timeline recorded the observed transitions.
    const timeline = page.getByTestId('timeline');
    await expect(timeline).toContainText(`Chaos enabled on ${PRIMARY}`);
    await expect(timeline).toContainText(`${PRIMARY} /health now returns 503`);
    await expect(timeline).toContainText(`Health check for ${PRIMARY}: healthy → unhealthy`);
    await expect(timeline).toContainText(`DNS answer flipped to ${SECONDARY}`);

    // Heal: everything transitions back and the recovery is logged.
    await page.getByTestId('chaos-toggle').click();
    await expect(page.getByTestId(`health-chip-${PRIMARY}`)).toHaveClass(/good/, { timeout: 10_000 });
    await expect(timeline).toContainText(`${PRIMARY} /health recovered (200)`);
    await expect(timeline).toContainText(`DNS answer flipped to ${PRIMARY}`);
    await expect(timeline).toContainText(`Chaos cleared on ${PRIMARY}`);
  });

  test('probe confirms the secondary is winning', async ({ page }) => {
    const backend = newBackend();
    backend.status = statusArmedFailing();
    await installStubs(page, backend);
    await openFailoverTab(page, baseUrl);

    await page.getByTestId('probe-button').click();
    const probe = page.getByTestId('probe-result');
    await expect(probe).toBeVisible();
    await expect(probe).toContainText(SECONDARY_HOST);
    await expect(probe).toContainText(SECONDARY);
    await expect(probe).toContainText('no regional custom domain'); // honesty note
    await expect(page.getByTestId('timeline')).toContainText(`Probe confirmed ${SECONDARY}`);
  });

  test('DoH verify: renders the answer when a resolver responds', async ({ page }) => {
    const backend = newBackend();
    backend.status = statusArmedHealthy();
    await installStubs(page, backend);
    await page.route('https://dns.google/**', (route) =>
      route.fulfill(jsonResponse({
        Status: 0,
        Answer: [{ name: `${FQDN}.`, type: 5, TTL: 15, data: `${PRIMARY_HOST}.` }]
      })));
    await openFailoverTab(page, baseUrl);

    await page.getByTestId('doh-verify').click();
    await expect(page.getByTestId('doh-result')).toContainText('dns.google');
    await expect(page.getByTestId('doh-result')).toContainText(PRIMARY_HOST);
    await expect(page.getByTestId('timeline')).toContainText('Browser DoH (dns.google)');
  });

  test('DoH verify: graceful message when both resolvers are blocked', async ({ page }) => {
    const backend = newBackend();
    backend.status = statusArmedHealthy();
    await installStubs(page, backend);
    await blockDoh(page);
    await openFailoverTab(page, baseUrl);

    await page.getByTestId('doh-verify').click();
    const err = page.getByTestId('doh-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText('corporate proxies commonly block DNS-over-HTTPS');
    await expect(err).toContainText('optional');
    // Server-reported answer stays on screen as the authoritative display.
    await expect(page.getByTestId('dns-answer')).toContainText(PRIMARY_HOST);
  });

  test('disarm: returns to the unarmed view and logs the transition', async ({ page }) => {
    const backend = newBackend();
    backend.status = statusArmedHealthy();
    await installStubs(page, backend);
    await openFailoverTab(page, baseUrl);
    await expect(page.getByTestId('armed-panel')).toBeVisible();

    await page.getByTestId('disarm-button').click();
    await expect(page.getByTestId('unarmed-panel')).toBeVisible({ timeout: 10_000 });
    expect(backend.disarmCalls).toBe(1);
    const timeline = page.getByTestId('timeline');
    await expect(timeline).toContainText('Disarm requested');
    await expect(timeline).toContainText('Disarmed — failover records and health checks removed');
  });
});

// ---------------------------------------------------------------------------
// Suite 3: deployed (house pattern — skips without ADMIN_BASE_URL)
// ---------------------------------------------------------------------------

test.describe('Failover demo — deployed admin', () => {
  test.skip(!ADMIN_BASE_URL, 'ADMIN_BASE_URL not set — no deployment to test against');

  test('failover tab loads live status and carries no simulation copy', async ({ page }) => {
    const statusCalls: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/admin/failover/status')) statusCalls.push(request.url());
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Failover demo' }).click();
    await expect(page.getByTestId('failover-root')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Route 53 failover/ })).toBeVisible();

    // Status poll fired; one of the two states is on screen.
    await expect.poll(() => statusCalls.length, { timeout: 20_000 }).toBeGreaterThan(0);
    await expect(
      page.getByTestId('unarmed-panel').or(page.getByTestId('armed-panel'))
    ).toBeVisible({ timeout: 20_000 });

    expect(await page.locator('body').innerText()).not.toMatch(/simulat/i);
  });
});
