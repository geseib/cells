/**
 * Quorum demo (admin dashboard, calculated-health-check consensus UI).
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
 * The stub backend SIMULATES failover-admin.ts's quorum contract, including
 * the server-side commit rule: storedControl flips (and a new decision-log
 * version is appended) only when a status collection observes a genuine
 * parent transition. `autoCommit` lets tests freeze that commit to show the
 * live lamp flipping while the stored lamp holds — static stability.
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

const VOTERS = 5;
const SEED_VERSION = 126;
const CHECKS_RATE = 0.0185;
const TRAFFIC_RATE = 0.0945;
const TOTAL_RATE = 0.113;
const VOTE_STATUS_URL = 'https://api.cells.example.com/vote-status/{i}';
const PARENT_ID = 'hc-parent';
const ORIGINAL_PRIMARY_HC = 'hc-fo-1';

interface LogEntry {
  version: number;
  decision: 'on' | 'off';
  healthyChildren: number;
  threshold: number;
  at: string;
}

// ---------------------------------------------------------------------------
// Stub harness
// ---------------------------------------------------------------------------

/** Mutable backend the routes read on every request — tests flip its fields. */
interface StubBackend {
  armed: boolean;
  threshold: number;
  votes: boolean[];
  broken: boolean[];
  storedOn: boolean;
  storedVersion: number;
  storedSince: string;
  decisionLog: LogEntry[]; // newest first
  wired: boolean;
  failoverArmed: boolean;
  /** false = freeze the server-side commit so live and stored can diverge. */
  autoCommit: boolean;
  /** When set, /admin/quorum/status returns this verbatim (drift tests). */
  statusOverride?: any;
  armCalls: any[];
  disarmCalls: number;
  voteCalls: any[];
  breakCalls: any[];
  wireCalls: any[];
}

const seedEntry = (threshold: number): LogEntry => ({
  version: SEED_VERSION,
  decision: 'off',
  healthyChildren: 0,
  threshold,
  at: new Date(Date.now() - 10 * 60_000).toISOString()
});

const newBackend = (): StubBackend => ({
  armed: false,
  threshold: 3,
  votes: Array(VOTERS).fill(true),
  broken: Array(VOTERS).fill(false),
  storedOn: false,
  storedVersion: SEED_VERSION,
  storedSince: new Date(Date.now() - 10 * 60_000).toISOString(),
  decisionLog: [seedEntry(3)],
  wired: false,
  failoverArmed: false,
  autoCommit: true,
  armCalls: [],
  disarmCalls: 0,
  voteCalls: [],
  breakCalls: [],
  wireCalls: []
});

/** Seed an armed backend already committed at v127 · Enabled (all votes on). */
const armCommitted = (backend: StubBackend) => {
  backend.armed = true;
  backend.storedOn = true;
  backend.storedVersion = SEED_VERSION + 1;
  backend.storedSince = new Date(Date.now() - 5 * 60_000).toISOString();
  backend.decisionLog = [
    { version: SEED_VERSION + 1, decision: 'on', healthyChildren: 5, threshold: 3, at: backend.storedSince },
    seedEntry(3)
  ];
};

const rates = () => ({
  healthChecksPerHourUsd: CHECKS_RATE,
  checkerTrafficPerHourUsd: TRAFFIC_RATE,
  ratePerHourUsd: TOTAL_RATE
});

/** Mirrors handleQuorumStatus: computed parent + transition-only commits. */
const buildStatus = (backend: StubBackend) => {
  if (!backend.armed) {
    return {
      armed: false,
      whatArmingCreates: {
        healthChecks: `${VOTERS} × HTTPS checkers against /vote-status/{i} (10s interval, 1-failure threshold) + 1 CALCULATED parent (healthy children >= threshold)`,
        checkerTraffic: '~27,000 checker requests/hour against the routing API while armed',
        ...rates()
      }
    };
  }
  const voters = Array.from({ length: VOTERS }, (_, idx) => {
    const healthy = backend.votes[idx] && !backend.broken[idx];
    return {
      i: idx + 1,
      on: backend.votes[idx],
      broken: backend.broken[idx],
      healthCheckId: `hc-v${idx + 1}`,
      status: healthy ? 'healthy' : 'unhealthy',
      healthyCount: healthy ? 16 : 0,
      checkersReporting: 16
    };
  });
  const healthyChildren = voters.filter((v) => v.status === 'healthy').length;
  const parentOn = healthyChildren >= backend.threshold;

  if (backend.autoCommit && parentOn !== backend.storedOn) {
    const version = backend.storedVersion + 1;
    const at = new Date().toISOString();
    backend.decisionLog = [
      { version, decision: parentOn ? 'on' : 'off', healthyChildren, threshold: backend.threshold, at },
      ...backend.decisionLog
    ].slice(0, 20);
    backend.storedOn = parentOn;
    backend.storedVersion = version;
    backend.storedSince = at;
  }

  return {
    armed: true,
    threshold: backend.threshold,
    armedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
    voters,
    parent: {
      healthCheckId: PARENT_ID,
      threshold: backend.threshold,
      healthyChildren,
      status: parentOn ? 'healthy' : 'unhealthy',
      computedFrom: "count(healthy children) >= threshold, computed from the child checks' checker observations — Route 53 does not expose GetHealthCheckStatus for CALCULATED health checks"
    },
    storedControl: { on: backend.storedOn, version: backend.storedVersion, since: backend.storedSince },
    decisionLog: backend.decisionLog,
    wire: {
      wired: backend.wired,
      failoverArmed: backend.failoverArmed,
      recordHealthCheckId: backend.failoverArmed ? (backend.wired ? PARENT_ID : ORIGINAL_PRIMARY_HC) : null,
      pointsAtParent: backend.failoverArmed && backend.wired
    },
    voteStatusUrl: VOTE_STATUS_URL,
    estimatedCost: { ...rates(), armedMinutes: 12, accruedUsd: 0.0226 }
  };
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

  if (apiPath === '/admin/quorum/status') {
    return route.fulfill(jsonResponse(backend.statusOverride ?? buildStatus(backend)));
  }
  if (apiPath === '/admin/quorum/arm' && method === 'POST') {
    const body = route.request().postDataJSON();
    backend.armCalls.push(body);
    backend.armed = true;
    backend.threshold = body?.threshold ?? 3;
    backend.votes = Array(VOTERS).fill(true);
    backend.broken = Array(VOTERS).fill(false);
    backend.storedOn = false;
    backend.storedVersion = SEED_VERSION;
    backend.storedSince = new Date().toISOString();
    backend.decisionLog = [seedEntry(backend.threshold)];
    backend.wired = false;
    return route.fulfill(jsonResponse({
      success: true, armed: true, threshold: backend.threshold,
      voterHealthCheckIds: ['hc-v1', 'hc-v2', 'hc-v3', 'hc-v4', 'hc-v5'],
      parentHealthCheckId: PARENT_ID, voteStatusUrl: VOTE_STATUS_URL,
      armedAt: backend.storedSince,
      storedControl: { on: false, version: SEED_VERSION, since: backend.storedSince },
      estimatedCost: rates()
    }));
  }
  if (apiPath === '/admin/quorum/disarm' && method === 'POST') {
    backend.disarmCalls += 1;
    backend.armed = false;
    backend.wired = false;
    return route.fulfill(jsonResponse({ success: true, armed: false, healthChecksDeleted: 6 }));
  }
  if (apiPath === '/admin/quorum/vote' && method === 'POST') {
    const body = route.request().postDataJSON();
    backend.voteCalls.push(body);
    backend.votes[body.i - 1] = body.on;
    return route.fulfill(jsonResponse({ success: true, i: body.i, on: body.on }));
  }
  if (apiPath === '/admin/quorum/break-voter' && method === 'POST') {
    const body = route.request().postDataJSON();
    backend.breakCalls.push(body);
    backend.broken[body.i - 1] = body.broken;
    return route.fulfill(jsonResponse({ success: true, i: body.i, broken: body.broken }));
  }
  if (apiPath === '/admin/quorum/wire' && method === 'POST') {
    const body = route.request().postDataJSON();
    backend.wireCalls.push(body);
    backend.wired = body.on;
    return route.fulfill(jsonResponse({
      success: true, wired: backend.wired,
      recordHealthCheckId: backend.wired ? PARENT_ID : ORIGINAL_PRIMARY_HC
    }));
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

async function openQuorumTab(page: Page, baseUrl: string) {
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Quorum' }).click();
  await expect(page.getByTestId('quorum-root')).toBeVisible();
}

// ---------------------------------------------------------------------------
// Suite 1: fully stubbed — runs without any deployment env vars
// ---------------------------------------------------------------------------

test.describe('Quorum demo — stubbed admin build', () => {
  test.skip(!HAS_ADMIN_BUILD,
    'frontend/admin/dist not built — run `cd frontend/admin && npm run build` first');
  // One engine is enough for a fully-stubbed UI suite, and firefox/webkit may
  // not be installed where only PW_CHROMIUM_PATH is provisioned.
  test.skip(({ browserName }) => browserName !== 'chromium', 'stubbed suite runs on chromium only');

  // Every request is fulfilled by page.route — nothing listens on this origin.
  const baseUrl = APP_ORIGIN;

  test('unarmed: explainer with BOTH honest cost components, threshold picker, arm', async ({ page }) => {
    const backend = newBackend();
    await installStubs(page, backend);
    await openQuorumTab(page, baseUrl);

    const panel = page.getByTestId('quorum-unarmed-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('5 HTTPS health checks');
    await expect(panel).toContainText('CALCULATED parent');
    await expect(panel).toContainText('~27,000 checker requests/hour');
    // Two components displayed honestly, plus the total.
    await expect(panel).toContainText('$0.0185/hour');
    await expect(panel).toContainText('$0.0945/hour');
    await expect(panel).toContainText('$0.1130/hour');

    await expect(page.getByTestId('threshold-select')).toHaveValue('3');
    await expect(page.getByTestId('arm-button')).toBeEnabled();
    // Disarm is always visible — it is an idempotent sweep.
    await expect(page.getByTestId('disarm-button')).toBeVisible();
  });

  test('arm flow: POST body, voter ring, meter, lamps, seeded v126 notebook', async ({ page }) => {
    const backend = newBackend();
    backend.autoCommit = false; // hold the commit so the fresh arm shows v126
    await installStubs(page, backend);
    await openQuorumTab(page, baseUrl);

    await page.getByTestId('threshold-select').selectOption('3');
    await page.getByTestId('arm-button').click();

    await expect(page.getByTestId('quorum-armed-panel')).toBeVisible({ timeout: 10_000 });
    expect(backend.armCalls).toEqual([{ threshold: 3 }]);

    // 5 voter switches + break toggles around the calculated parent lamp.
    for (let i = 1; i <= VOTERS; i++) {
      await expect(page.getByTestId(`voter-card-${i}`)).toBeVisible();
      await expect(page.getByTestId(`voter-switch-${i}`)).toHaveText('Vote ON');
      await expect(page.getByTestId(`voter-broken-${i}`)).toHaveText('Break');
      await expect(page.getByTestId(`voter-card-${i}`)).toContainText('16/16 checkers healthy');
      await expect(page.getByTestId(`voter-card-${i}`)).toContainText(`hc-v${i}`);
    }
    await expect(page.getByTestId('parent-lamp')).toContainText('CALCULATED parent');
    await expect(page.getByTestId('parent-lamp')).toContainText(PARENT_ID);

    // Meter: 5/5 healthy against threshold 3.
    await expect(page.getByTestId('quorum-meter')).toContainText('5/5 children healthy');
    await expect(page.getByTestId('quorum-meter')).toContainText('threshold 3');
    await expect(page.getByTestId('quorum-meter').locator('.meter-seg.filled')).toHaveCount(5);

    // Live recomputes (healthy), stored still holds the seeded v126 decision.
    await expect(page.getByTestId('live-lamp')).toContainText('healthy');
    await expect(page.getByTestId('live-lamp')).toContainText('GetHealthCheckStatus'); // computedFrom label
    await expect(page.getByTestId('stored-lamp')).toContainText('v126 · Disabled · since');

    // Decision log renders as the ordered notebook, seeded at v126.
    const log = page.getByTestId('decision-log');
    await expect(log).toContainText('v126');
    await expect(log).toContainText('Routing = Disabled');

    await expect(page.getByTestId('timeline')).toContainText('Armed: 5 voter checks');
  });

  test('crossing the threshold: meter fills, lamps flip, notebook commits v126 → v127', async ({ page }) => {
    const backend = newBackend();
    backend.armed = true;
    backend.votes = [true, true, false, false, false]; // 2 healthy < threshold 3
    await installStubs(page, backend);
    await openQuorumTab(page, baseUrl);

    await expect(page.getByTestId('quorum-meter')).toContainText('2/5 children healthy');
    await expect(page.getByTestId('quorum-meter').locator('.meter-seg.filled')).toHaveCount(2);
    await expect(page.getByTestId('live-lamp')).toContainText('unhealthy');
    await expect(page.getByTestId('stored-lamp')).toContainText('v126 · Disabled');

    // Flip voter 3 ON — 3/5 crosses the threshold, and the status poll
    // commits the decision as a NEW version, never rewriting v126.
    await page.getByTestId('voter-switch-3').click();
    await expect.poll(() => backend.voteCalls.length).toBe(1);
    expect(backend.voteCalls[0]).toEqual({ i: 3, on: true });

    await expect(page.getByTestId('quorum-meter')).toContainText('3/5 children healthy', { timeout: 10_000 });
    await expect(page.getByTestId('quorum-meter').locator('.meter-seg.filled')).toHaveCount(3);
    await expect(page.getByTestId('live-lamp')).toContainText('healthy');
    await expect(page.getByTestId('stored-lamp')).toContainText('v127 · Enabled · since');

    // Notebook: newest first — v127 above v126, both preserved.
    const rows = page.getByTestId('decision-log').locator('.notebook-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('v127');
    await expect(rows.nth(0)).toContainText('Routing = Enabled');
    await expect(rows.nth(1)).toContainText('v126');
    await expect(rows.nth(1)).toContainText('Routing = Disabled');

    const timeline = page.getByTestId('timeline');
    await expect(timeline).toContainText('Vote 3 flipped ON');
    await expect(timeline).toContainText('CALCULATED parent flipped unhealthy → healthy');
    await expect(timeline).toContainText('Committed v127: Routing = Enabled');
  });

  test('break-voter: 500 fault flag, checker card flips, timeline entry', async ({ page }) => {
    const backend = newBackend();
    armCommitted(backend);
    await installStubs(page, backend);
    await openQuorumTab(page, baseUrl);

    await page.getByTestId('voter-broken-4').click();
    await expect.poll(() => backend.breakCalls.length).toBe(1);
    expect(backend.breakCalls[0]).toEqual({ i: 4, broken: true });

    const card = page.getByTestId('voter-card-4');
    await expect(page.getByTestId('voter-broken-4')).toHaveText('Broken (500)', { timeout: 10_000 });
    await expect(card).toContainText('unhealthy');
    await expect(card).toContainText('0/16 checkers healthy');
    // Vote is a SEPARATE flag: still ON while broken.
    await expect(page.getByTestId('voter-switch-4')).toHaveText('Vote ON');

    const timeline = page.getByTestId('timeline');
    await expect(timeline).toContainText('Voter 4 marked broken');
    await expect(timeline).toContainText('Checker for voter 4: healthy → unhealthy');
  });

  test('static stability: stored lamp HOLDS v127 while live flips, then commits v128', async ({ page }) => {
    const backend = newBackend();
    armCommitted(backend); // v127 · Enabled, all five votes on
    backend.autoCommit = false; // freeze the server-side commit
    await installStubs(page, backend);
    await openQuorumTab(page, baseUrl);

    await expect(page.getByTestId('stored-lamp')).toContainText('v127 · Enabled');

    // Drop below the threshold: 5 → 2 healthy.
    await page.getByTestId('voter-switch-1').click();
    await expect(page.getByTestId('voter-switch-1')).toHaveText('Vote OFF', { timeout: 10_000 });
    await page.getByTestId('voter-switch-2').click();
    await expect(page.getByTestId('voter-switch-2')).toHaveText('Vote OFF', { timeout: 10_000 });
    await page.getByTestId('voter-switch-3').click();

    // LIVE recomputes to unhealthy; STORED still serves the last committed
    // decision — that divergence is the ARC static-stability lesson.
    await expect(page.getByTestId('live-lamp')).toContainText('unhealthy', { timeout: 10_000 });
    await expect(page.getByTestId('quorum-meter')).toContainText('2/5 children healthy');
    await expect(page.getByTestId('stored-lamp')).toContainText('v127 · Enabled');
    await expect(page.getByTestId('decision-log').locator('.notebook-row').nth(0)).toContainText('v127');
    await expect(page.getByTestId('quorum-root')).toContainText('static stability');

    // Unfreeze: the next status collection commits the flip as v128.
    backend.autoCommit = true;
    await expect(page.getByTestId('stored-lamp')).toContainText('v128 · Disabled', { timeout: 15_000 });
    const rows = page.getByTestId('decision-log').locator('.notebook-row');
    await expect(rows.nth(0)).toContainText('v128');
    await expect(rows.nth(0)).toContainText('Routing = Disabled');
    await expect(rows.nth(1)).toContainText('v127');
    await expect(page.getByTestId('timeline')).toContainText('Committed v128: Routing = Disabled');
  });

  test('wire: hidden unless the failover demo is armed', async ({ page }) => {
    const backend = newBackend();
    armCommitted(backend);
    backend.failoverArmed = false;
    await installStubs(page, backend);
    await openQuorumTab(page, baseUrl);

    await expect(page.getByTestId('quorum-armed-panel')).toBeVisible();
    await expect(page.getByTestId('wire-toggle')).toHaveCount(0);
    await expect(page.getByTestId('wire-unavailable')).toContainText('failover demo armed first');
  });

  test('wire: toggle POSTs, record truth shows pointsAtParent, unwire restores', async ({ page }) => {
    const backend = newBackend();
    armCommitted(backend);
    backend.failoverArmed = true;
    await installStubs(page, backend);
    await openQuorumTab(page, baseUrl);

    // Unwired truth: the record still carries the original failover check.
    const truth = page.getByTestId('wire-truth');
    await expect(truth).toContainText(ORIGINAL_PRIMARY_HC);
    await expect(truth).toContainText('does not point at the quorum parent');

    await page.getByTestId('wire-toggle').click();
    await expect.poll(() => backend.wireCalls.length).toBe(1);
    expect(backend.wireCalls[0]).toEqual({ on: true });

    // Wired truth is read from the RECORD: HealthCheckId = the parent.
    await expect(truth).toContainText(PARENT_ID, { timeout: 10_000 });
    await expect(truth).toContainText('currently points at the quorum parent');
    await expect(page.getByTestId('wire-toggle')).toContainText('Unwire');
    await expect(page.getByTestId('timeline')).toContainText('PRIMARY failover record wired to the quorum parent');

    await page.getByTestId('wire-toggle').click();
    await expect.poll(() => backend.wireCalls.length).toBe(2);
    expect(backend.wireCalls[1]).toEqual({ on: false });
    await expect(truth).toContainText('does not point at the quorum parent', { timeout: 10_000 });
    await expect(page.getByTestId('timeline')).toContainText('restored to its original health check');
  });

  test('armed cost line carries both components and the accrued figure', async ({ page }) => {
    const backend = newBackend();
    armCommitted(backend);
    await installStubs(page, backend);
    await openQuorumTab(page, baseUrl);

    const cost = page.getByTestId('cost-line');
    await expect(cost).toContainText('$0.1130/hour');
    await expect(cost).toContainText('$0.0185/hour');
    await expect(cost).toContainText('$0.0945/hour');
    await expect(cost).toContainText('$0.0226 so far');
    await expect(cost).toContainText('disarm when done');
  });

  test('disarm: returns to the unarmed view and logs the teardown', async ({ page }) => {
    const backend = newBackend();
    armCommitted(backend);
    await installStubs(page, backend);
    await openQuorumTab(page, baseUrl);
    await expect(page.getByTestId('quorum-armed-panel')).toBeVisible();

    await page.getByTestId('disarm-button').click();
    await expect(page.getByTestId('quorum-unarmed-panel')).toBeVisible({ timeout: 10_000 });
    expect(backend.disarmCalls).toBe(1);
    const timeline = page.getByTestId('timeline');
    await expect(timeline).toContainText('Disarm requested');
    await expect(timeline).toContainText('Disarmed — voter checks, calculated parent, vote items, and decision log removed');
  });

  test('contract drift guard: voters as a keyed object degrades to the boundary panel', async ({ page }) => {
    const backend = newBackend();
    // The arrays-not-keyed-objects contract, violated on purpose (the exact
    // pre-e066853 shape regression): must surface the DemoBoundary error
    // panel, NOT a blank page.
    const armedStatus = (armCommitted(backend), buildStatus(backend)) as any;
    armedStatus.voters = {
      '1': { i: 1, on: true, broken: false, healthCheckId: 'hc-v1', status: 'healthy', healthyCount: 16, checkersReporting: 16 }
    };
    backend.statusOverride = armedStatus;
    await installStubs(page, backend);
    await page.goto(baseUrl);
    await page.getByRole('button', { name: 'Quorum' }).click();

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

test.describe('Quorum demo — deployed admin', () => {
  test.skip(!ADMIN_BASE_URL, 'ADMIN_BASE_URL not set — no deployment to test against');

  test('quorum tab loads live status', async ({ page }) => {
    const statusCalls: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/admin/quorum/status')) statusCalls.push(request.url());
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Quorum' }).click();
    await expect(page.getByTestId('quorum-root')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Quorum by calculated health check/ })).toBeVisible();

    // Status poll fired; one of the two states is on screen.
    await expect.poll(() => statusCalls.length, { timeout: 20_000 }).toBeGreaterThan(0);
    await expect(
      page.getByTestId('quorum-unarmed-panel').or(page.getByTestId('quorum-armed-panel'))
    ).toBeVisible({ timeout: 20_000 });
  });
});
