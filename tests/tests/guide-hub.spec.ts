/**
 * Guide hub (site/dist/index.html) — menu + one-section-per-view, with
 * location.hash as the router, plus the three in-browser sims that folded in
 * from the retired operations page (lessons 05 and 09).
 *
 * Needs NO env vars and NO network: the built site is served entirely via
 * page.route from site/dist. Skips cleanly only when the build is missing.
 *
 * The sims expose their internal event logs as data-event JSON attributes;
 * every sim assertion here RECOMPUTES the expected outcome independently
 * from those events / the rendered inputs and compares it with what the UI
 * shows (the sim-mechanics test bodies are ported unchanged from the old
 * operations-page suite — only the harness changed):
 *
 *  - Sim 1: a double charge happens iff the retry's attempt precedes the
 *    first charge's replication (attempt.t < charged.t + lag), or always in
 *    isolated mode; the counter must equal (charge rows - distinct orders).
 *  - Sim 2: the LIVE lamp is exactly healthy(voters) >= threshold, flipping
 *    at the threshold boundary; STORED only moves on transitions and must
 *    hold through a control-plane kill (static stability).
 *  - Sim 3: commit fires exactly on the 3rd ack (not before, not waiting
 *    for 5); a reconnecting region replays exactly the missing version
 *    range in order; convergence only completes when all five logs match.
 */
import { test, expect, Page, Route } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const SITE_DIST = path.resolve(__dirname, '../../site/dist');
const HAS_SITE_BUILD = fs.existsSync(path.join(SITE_DIST, 'index.html'));
const ORIGIN = 'http://localhost:4173';
const SHOT_DIR = process.env.GUIDE_SHOT_DIR || path.resolve(__dirname, '../test-results/guide-screens');

/**
 * Mirror of site/src/guide/registry.ts — the drift guard. A change to the
 * section order, ids, numbering, or grouping must be made HERE too, on
 * purpose. Ids are ballot keys and deep-link anchors: never change them.
 */
const REGISTRY = [
  { id: 'why-cells', num: '01', title: 'Why cells', kicker: '01 · The problem', group: 'Foundations' },
  { id: 'hash-ring', num: '02', title: 'The hash ring', kicker: '02 · The mechanism', group: 'Foundations' },
  { id: 'route-a-client', num: '03', title: 'Route a client', kicker: '03 · Determinism', group: 'Foundations' },
  { id: 'kill-a-cell', num: '04', title: 'Kill a cell', kicker: '04 · Fault isolation', group: 'Failure & scale' },
  { id: 'idempotency', num: '05', title: 'Safe retries', kicker: '05 · Safe retries', group: 'Failure & scale' },
  { id: 'scale', num: '06', title: 'Scale out', kicker: '06 · Elasticity', group: 'Failure & scale' },
  { id: 'hash-choices', num: '07', title: 'Choosing your hash', kicker: '07 · The algorithm zoo', group: 'Deeper patterns' },
  { id: 'beyond-cells', num: '08', title: 'Beyond cells', kicker: '08 · Beyond cells', group: 'Deeper patterns' },
  { id: 'consensus', num: '09', title: 'Consensus', kicker: '09 · Versioned truth', group: 'Control planes & closing' },
  { id: 'trade-offs', num: '10', title: 'Trade-offs', kicker: '10 · The fine print', group: 'Control planes & closing' },
] as const;

const GROUPS = ['Foundations', 'Failure & scale', 'Deeper patterns', 'Control planes & closing'];

const STATIC_TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.map': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain'
};

function serveSite(route: Route, urlPath: string) {
  let file = path.join(SITE_DIST, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(SITE_DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(SITE_DIST, 'index.html');
  }
  return route.fulfill({
    status: 200,
    contentType: STATIC_TYPES[path.extname(file)] || 'application/octet-stream',
    body: fs.readFileSync(file)
  });
}

/** Serve site/dist at ORIGIN and collect console/page errors for the test. */
async function openSite(page: Page, pagePath = '/index.html'): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  await page.route(`${ORIGIN}/**`, (route) =>
    serveSite(route, decodeURIComponent(new URL(route.request().url()).pathname))
  );
  await page.goto(`${ORIGIN}${pagePath}`);
  return errors;
}

/** Open the guide directly on one section view and wait for it to render. */
async function openView(page: Page, view: string): Promise<string[]> {
  const errors = await openSite(page, `/index.html#${view}`);
  await expect(page.locator(`.view-host[data-view="${view}"]`)).toBeVisible();
  await expect(page.locator(`#${view}`)).toBeVisible();
  return errors;
}

/** Navigate an already-open guide by hash (same as typing in the URL bar). */
async function gotoView(page: Page, view: string) {
  await page.evaluate((v) => {
    window.location.hash = v;
  }, view);
}

/** A control inside the (only) ACTIVE copy of a per-view element. */
const inView = (page: Page, view: string, testid: string) =>
  page.locator(`.view-host[data-view="${view}"] [data-testid=${testid}]`);

interface Ev {
  t: number;
  type: string;
  [key: string]: any;
}

const readEvents = (page: Page, testid: string): Promise<Ev[]> =>
  page.$$eval(`[data-testid="${testid}"]`, (els) =>
    els.map((e) => JSON.parse(e.getAttribute('data-event') as string))
  );

async function waitForEvent(page: Page, testid: string, match: (e: Ev) => boolean, timeout = 5000): Promise<Ev[]> {
  await expect
    .poll(async () => (await readEvents(page, testid)).some(match), { timeout })
    .toBe(true);
  return readEvents(page, testid);
}

/** Same counting rule everywhere: whitespace-split, punctuation-only tokens
 *  (em dashes, arrows) don't count as words. */
const countWords = (texts: string[]) =>
  texts.join(' ').split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;

/* ------------------------------------------------------------------ */
/* Hub shell — menu, cards, groups, kicker drift guard                 */
/* ------------------------------------------------------------------ */

test.describe('Guide hub - shell', () => {
  test.skip(!HAS_SITE_BUILD, 'site/dist not built - run: cd site && npm run build');

  test('menu shows hero, four groups, and all ten cards in registry order', async ({ page }) => {
    const errors = await openSite(page);
    await expect(page.locator('header.hero h1')).toContainText('Cell-Based Architecture');

    // ten cards, in the registry order
    const cards = page.locator('[data-testid=menu-card]');
    await expect(cards).toHaveCount(10);
    const ids = await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-section')));
    expect(ids).toEqual(REGISTRY.map((s) => s.id));

    // four labeled groups, each holding its own sections
    const groups = page.locator('[data-testid=menu-group]');
    await expect(groups).toHaveCount(4);
    const groupNames = await groups.evaluateAll((els) => els.map((e) => e.getAttribute('data-group')));
    expect(groupNames).toEqual(GROUPS);
    for (const s of REGISTRY) {
      await expect(
        page.locator(`[data-testid=menu-group][data-group="${s.group}"] [data-testid=menu-card][data-section=${s.id}]`)
      ).toBeVisible();
    }

    // every card shows its number and title
    for (const s of REGISTRY) {
      const card = page.locator(`[data-testid=menu-card][data-section=${s.id}]`);
      await expect(card).toContainText(s.num);
      await expect(card).toContainText(s.title);
    }

    // start-here affordances point at lesson 01
    await expect(page.locator('[data-testid=start-pill]')).toHaveAttribute('href', '#why-cells');
    await expect(page.locator('[data-testid=menu-card][data-section=why-cells] .start-here')).toBeVisible();

    // the simplified top nav: Menu yes, Operations gone
    await expect(page.locator('nav.top-nav a[href="#menu"]').first()).toBeVisible();
    await expect(page.locator('nav.top-nav a[href="./operations.html"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('every view renders its section with the registry kicker (numbering drift guard)', async ({ page }) => {
    const errors = await openSite(page);
    for (const s of REGISTRY) {
      await gotoView(page, s.id);
      await expect(page.locator(`#${s.id}`)).toBeVisible();
      await expect(page.locator(`#${s.id} > .kicker`).first()).toHaveText(s.kicker);
      // position indicator in the top nav
      await expect(page.locator('[data-testid=nav-current]')).toHaveText(`${s.num} · ${s.title}`);
      // hero is a menu-only affordance
      await expect(page.locator('header.hero')).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Walking the order                                                   */
/* ------------------------------------------------------------------ */

test.describe('Guide hub - walking the order', () => {
  test.skip(!HAS_SITE_BUILD, 'site/dist not built - run: cd site && npm run build');

  test('bottom nav walks 01→10 forward; first view has no prev; last loops to menu', async ({ page }) => {
    const errors = await openSite(page);
    await page.locator('[data-testid=menu-card][data-section=why-cells]').click();
    await expect(page.locator('#why-cells')).toBeVisible();

    // the first view leaves the prev slot empty
    await expect(inView(page, 'why-cells', 'nav-prev')).toHaveCount(0);

    for (let i = 0; i < REGISTRY.length - 1; i++) {
      const here = REGISTRY[i];
      const next = REGISTRY[i + 1];
      await expect(page.locator('[data-testid=nav-current]')).toHaveText(`${here.num} · ${here.title}`);
      const nextLink = inView(page, here.id, 'nav-next');
      await expect(nextLink).toHaveAttribute('href', `#${next.id}`);
      await nextLink.click();
      await expect(page.locator(`#${next.id}`)).toBeVisible();
    }

    // last view: next loops back to the menu
    const last = REGISTRY[REGISTRY.length - 1];
    await expect(page.locator('[data-testid=nav-current]')).toHaveText(`${last.num} · ${last.title}`);
    const loop = inView(page, last.id, 'nav-next');
    await expect(loop).toHaveAttribute('href', '#menu');
    await expect(loop).toContainText('Back to menu');
    await loop.click();
    await expect(page.locator('[data-testid=menu-card]').first()).toBeVisible();
    await expect(page.locator('header.hero')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('prev and Menu work from the middle of the walk', async ({ page }) => {
    const errors = await openView(page, 'idempotency');
    const prev = inView(page, 'idempotency', 'nav-prev');
    await expect(prev).toHaveAttribute('href', '#kill-a-cell');
    await prev.click();
    await expect(page.locator('#kill-a-cell')).toBeVisible();
    await expect(page.locator('[data-testid=nav-current]')).toHaveText('04 · Kill a cell');

    await inView(page, 'kill-a-cell', 'nav-menu').click();
    await expect(page.locator('header.hero')).toBeVisible();
    await expect(page.locator('[data-testid=nav-current]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('browser back/forward retrace the walk', async ({ page }) => {
    const errors = await openSite(page);
    await page.locator('[data-testid=menu-card][data-section=why-cells]').click();
    await expect(page.locator('#why-cells')).toBeVisible();
    await inView(page, 'why-cells', 'nav-next').click();
    await expect(page.locator('#hash-ring')).toBeVisible();

    await page.goBack();
    await expect(page.locator('#why-cells')).toBeVisible();
    await expect(page.locator('[data-testid=nav-current]')).toHaveText('01 · Why cells');
    await page.goBack();
    await expect(page.locator('header.hero')).toBeVisible();
    await page.goForward();
    await expect(page.locator('#why-cells')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Deep links & aliases                                                */
/* ------------------------------------------------------------------ */

test.describe('Guide hub - deep links & aliases', () => {
  test.skip(!HAS_SITE_BUILD, 'site/dist not built - run: cd site && npm run build');

  test('direct hashes open the matching view', async ({ page }) => {
    const errors = await openView(page, 'beyond-cells');
    await expect(page.locator('#beyond-cells > .kicker').first()).toHaveText('08 · Beyond cells');
    await gotoView(page, 'consensus');
    await expect(page.locator('#consensus')).toBeVisible();
    await expect(page.locator('[data-testid=quorum-sim]')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('legacy and inner anchors resolve through aliases and scroll to the target', async ({ page }) => {
    const cases: Array<{ anchor: string; view: string }> = [
      { anchor: 'sidequest-registry', view: 'route-a-client' },
      { anchor: 'quorum', view: 'consensus' },
      { anchor: 'paxos-raft', view: 'consensus' },
      { anchor: 'reading', view: 'consensus' },
    ];
    for (const c of cases) {
      const errors = await openSite(page, `/index.html#${c.anchor}`);
      await expect(page.locator(`.view-host[data-view="${c.view}"]`)).toBeVisible();
      await expect(page.locator(`#${c.anchor}`)).toBeInViewport();
      expect(errors).toEqual([]);
      await page.unroute(`${ORIGIN}/**`);
    }
  });

  test('cross-section prose anchors switch views with zero caller changes', async ({ page }) => {
    // 07's churn table links back to 04 (zoo content now always visible, no expander)
    const errors = await openView(page, 'hash-choices');
    await page.locator('#hash-choices a[href="#kill-a-cell"]').first().click();
    await expect(page.locator('#kill-a-cell')).toBeVisible();
    await expect(page.locator('[data-testid=nav-current]')).toHaveText('04 · Kill a cell');
    // 09 links back to 05 (the "bug 05 fixed" line)
    await gotoView(page, 'consensus');
    await page.locator('#consensus a[href="#idempotency"]').first().click();
    await expect(page.locator('#idempotency')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('unknown or flag-style hashes fall back to the menu, never crash', async ({ page }) => {
    for (const bad of ['#no-such-section', '#vote=on']) {
      const errors = await openSite(page, `/index.html${bad}`);
      await expect(page.locator('[data-testid=menu-card]')).toHaveCount(10);
      await expect(page.locator('header.hero')).toBeVisible();
      expect(errors).toEqual([]);
      await page.unroute(`${ORIGIN}/**`);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Retired /operations.html — the redirect stub                        */
/* ------------------------------------------------------------------ */

test.describe('Retired operations page redirects', () => {
  test.skip(!HAS_SITE_BUILD, 'site/dist not built - run: cd site && npm run build');

  test('bare /operations.html lands on the menu', async ({ page }) => {
    await openSite(page, '/operations.html');
    await expect.poll(() => page.url()).toBe(`${ORIGIN}/#menu`);
    await expect(page.locator('[data-testid=menu-card]')).toHaveCount(10);
  });

  test('old fragments map onto the matching guide views', async ({ page }) => {
    const cases: Array<{ frag: string; target: string; view: string }> = [
      { frag: 'idempotency', target: 'idempotency', view: 'idempotency' },
      { frag: 'quorum', target: 'consensus', view: 'consensus' },
      { frag: 'consensus', target: 'consensus', view: 'consensus' },
      { frag: 'paxos-raft', target: 'consensus', view: 'consensus' },
      { frag: 'reading', target: 'consensus', view: 'consensus' },
    ];
    for (const c of cases) {
      await openSite(page, `/operations.html#${c.frag}`);
      await expect.poll(() => page.url()).toBe(`${ORIGIN}/#${c.target}`);
      await expect(page.locator(`.view-host[data-view="${c.view}"]`)).toBeVisible();
      await page.unroute(`${ORIGIN}/**`);
    }
  });

  test('the stub is a noindex redirect and NO page links to operations.html anymore', async ({ page }) => {
    const stub = fs.readFileSync(path.join(SITE_DIST, 'operations.html'), 'utf8');
    expect(stub).toContain('noindex');
    expect(stub).toContain('canonical');
    expect(stub).toContain('http-equiv="refresh"');
    expect(stub).not.toMatch(/<script[^>]+src=/); // no bundle — pure stub

    const errors = await openSite(page, '/index.html');
    for (const p of ['/index.html', '/primer.html', '/slides.html', '/flags.html']) {
      await page.goto(`${ORIGIN}${p}`);
      await expect(page.locator('nav.top-nav, .deck-toolbar').first()).toBeVisible();
      await expect(page.locator('a[href*="operations.html"]')).toHaveCount(0);
    }
    // the deck's toolbar link retargeted into the guide
    await page.goto(`${ORIGIN}/slides.html`);
    await expect(page.locator('.deck-toolbar a[href="./index.html#consensus"]')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* State preservation — mounted but hidden                             */
/* ------------------------------------------------------------------ */

test.describe('Guide hub - state preservation', () => {
  test.skip(!HAS_SITE_BUILD, 'site/dist not built - run: cd site && npm run build');

  test('sim state survives a menu roundtrip', async ({ page }) => {
    const errors = await openView(page, 'idempotency');
    await page.locator('[data-testid=idem-lag]').fill('2000');
    await expect(page.locator('[data-testid=idem-lag-value]')).toHaveText('2000ms');
    await page.locator('[data-testid=idem-pay-A]').click();
    await waitForEvent(page, 'idem-event', (e) => e.type === 'charged' && e.region === 'A');
    await expect(page.locator('[data-testid=charge-row]')).toHaveCount(1);

    // to the menu: the view hides but stays mounted...
    await inView(page, 'idempotency', 'nav-menu').click();
    await expect(page.locator('header.hero')).toBeVisible();
    await expect(page.locator('.view-host[data-view="idempotency"]')).toBeHidden();
    expect(await page.locator('.view-host[data-view="idempotency"]').getAttribute('aria-hidden')).toBe('true');

    // ...and back: slider, charge row, and event log all survived
    await page.locator('[data-testid=menu-card][data-section=idempotency]').click();
    await expect(page.locator('#idempotency')).toBeVisible();
    await expect(page.locator('[data-testid=idem-lag]')).toHaveValue('2000');
    await expect(page.locator('[data-testid=charge-row]')).toHaveCount(1);
    expect((await readEvents(page, 'idem-event')).some((e) => e.type === 'charged')).toBe(true);
    expect(errors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Sim 1 — idempotency (bodies ported unchanged from the ops suite)    */
/* ------------------------------------------------------------------ */

test.describe('Sim 1 - idempotency across failover', () => {
  test.skip(!HAS_SITE_BUILD, 'site/dist not built - run: cd site && npm run build');

  /** Recompute the double-charge count exactly as the sim claims to: from the money table. */
  async function recountCharges(page: Page) {
    const rows = await page.$$eval('[data-testid=charge-row]', (els) =>
      els.map((e) => ({
        order: e.getAttribute('data-order'),
        region: e.getAttribute('data-region'),
        chargeId: e.getAttribute('data-charge-id'),
      }))
    );
    const orders = new Set(rows.map((r) => r.order));
    return { rows, expectedDoubles: rows.length - orders.size };
  }

  test('a retry that beats the replication lag genuinely writes a second charge row', async ({ page }) => {
    const errors = await openView(page, 'idempotency');
    await page.locator('[data-testid=idem-lag]').fill('2000');
    await expect(page.locator('[data-testid=idem-lag-value]')).toHaveText('2000ms');

    await page.locator('[data-testid=idem-pay-A]').click();
    await waitForEvent(page, 'idem-event', (e) => e.type === 'charged' && e.region === 'A');
    await page.locator('[data-testid=idem-kill-A]').click();
    await page.locator('[data-testid=idem-pay-B]').click();
    const events = await waitForEvent(page, 'idem-event', (e) => e.type === 'charged' && e.region === 'B');

    // Independent recomputation from the event log:
    const chargedA = events.find((e) => e.type === 'charged' && e.region === 'A')!;
    const attemptB = events.find((e) => e.type === 'pay-attempt' && e.region === 'B')!;
    const chargedB = events.find((e) => e.type === 'charged' && e.region === 'B')!;
    expect(attemptB.lagMs).toBe(2000);
    // the premise of this scenario must have held: retry landed inside the window
    expect(attemptB.t).toBeLessThan(chargedA.t + attemptB.lagMs);
    // ... therefore the sim MUST have written a second row (never scripted)
    expect(chargedB.duplicate).toBe(true);

    const { rows, expectedDoubles } = await recountCharges(page);
    expect(rows.length).toBe(2);
    expect(expectedDoubles).toBe(1);
    expect(new Set(rows.map((r) => r.chargeId)).size).toBe(2);
    expect(rows.map((r) => r.region).sort()).toEqual(['us-east-1', 'us-west-2']);
    await expect(page.locator('[data-testid=double-charge-count]')).toHaveText(String(expectedDoubles));
    expect(errors).toEqual([]);
  });

  test('a retry after the lag window is deduped: stored receipt, same chargeId, no new row', async ({ page }) => {
    const errors = await openView(page, 'idempotency');
    await page.locator('[data-testid=idem-lag]').fill('500');

    await page.locator('[data-testid=idem-pay-A]').click();
    await waitForEvent(page, 'idem-event', (e) => e.type === 'charged' && e.region === 'A');
    await page.locator('[data-testid=idem-kill-A]').click();
    await page.waitForTimeout(1100); // comfortably past the 500ms window
    await page.locator('[data-testid=idem-pay-B]').click();
    const events = await waitForEvent(page, 'idem-event', (e) => e.type === 'deduped' && e.region === 'B');

    const chargedA = events.find((e) => e.type === 'charged' && e.region === 'A')!;
    const attemptB = events.find((e) => e.type === 'pay-attempt' && e.region === 'B')!;
    const deduped = events.find((e) => e.type === 'deduped')!;
    // premise: the record HAD replicated by the time of the retry
    expect(attemptB.t).toBeGreaterThanOrEqual(chargedA.t + attemptB.lagMs);
    // dedupe proof: the stored receipt is region A's, with region A's chargeId
    expect(deduped.chargeId).toBe(chargedA.chargeId);
    expect(deduped.receiptRegion).toBe('us-east-1');

    const { rows, expectedDoubles } = await recountCharges(page);
    expect(rows.length).toBe(1);
    expect(expectedDoubles).toBe(0);
    await expect(page.locator('[data-testid=double-charge-count]')).toHaveText('0');
    await expect(page.locator('[data-testid=dedupe-count]')).toHaveText('1');
    await expect(page.locator('[data-testid=idem-response]')).toHaveAttribute('data-kind', 'deduped');
    expect(errors).toEqual([]);
  });

  test('isolated tables double-charge no matter how long the retry waits', async ({ page }) => {
    const errors = await openView(page, 'idempotency');
    await page.locator('[data-testid=idem-mode-isolated]').click();
    await expect(page.locator('[data-testid=idem-sim]')).toHaveAttribute('data-mode', 'isolated');

    await page.locator('[data-testid=idem-pay-A]').click();
    await waitForEvent(page, 'idem-event', (e) => e.type === 'charged' && e.region === 'A');
    await page.waitForTimeout(900); // waiting cannot help: there is no replication
    await page.locator('[data-testid=idem-kill-A]').click();
    await page.locator('[data-testid=idem-pay-B]').click();
    const events = await waitForEvent(page, 'idem-event', (e) => e.type === 'charged' && e.region === 'B');

    expect(events.find((e) => e.type === 'pay-attempt' && e.region === 'B')!.mode).toBe('isolated');
    expect(events.find((e) => e.type === 'charged' && e.region === 'B')!.duplicate).toBe(true);
    const { rows, expectedDoubles } = await recountCharges(page);
    expect(rows.length).toBe(2);
    expect(expectedDoubles).toBe(1);
    await expect(page.locator('[data-testid=double-charge-count]')).toHaveText('1');
    // both records exist, one per regional table
    const stores = await page.$$eval('[data-testid=idem-record]', (els) => els.map((e) => e.getAttribute('data-store')));
    expect(stores.sort()).toEqual(['A', 'B']);
    expect(errors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Sim 2 — quorum switch (bodies ported unchanged)                     */
/* ------------------------------------------------------------------ */

test.describe('Sim 2 - quorum switch', () => {
  test.skip(!HAS_SITE_BUILD, 'site/dist not built - run: cd site && npm run build');

  /** Recompute healthy voters from the rendered voter states. */
  async function recomputeHealthy(page: Page) {
    const voters = await page.$$eval('[data-testid=voter]', (els) =>
      els.map((e) => ({
        on: e.getAttribute('data-on') === 'true',
        broken: e.getAttribute('data-broken') === 'true',
        code: Number(e.getAttribute('data-code')),
      }))
    );
    // a checker only counts a voter healthy when it observes 200
    for (const v of voters) {
      expect(v.code).toBe(v.broken ? 500 : v.on ? 200 : 503);
    }
    return voters.filter((v) => v.code === 200).length;
  }

  async function expectLamps(page: Page, healthy: number, threshold: number) {
    await expect(page.locator('[data-testid=quorum-sim]')).toHaveAttribute('data-healthy', String(healthy));
    expect(await recomputeHealthy(page)).toBe(healthy);
    await expect(page.locator('[data-testid=live-lamp]')).toHaveAttribute(
      'data-state',
      healthy >= threshold ? 'on' : 'off'
    );
  }

  test('LIVE lamp is exactly healthy >= threshold and flips at the boundary', async ({ page }) => {
    const errors = await openView(page, 'consensus');
    await expectLamps(page, 5, 3);
    await expect(page.locator('[data-testid=stored-lamp]')).toHaveAttribute('data-on', 'true');

    // healthy 5 -> 4 -> 3: still exactly AT threshold, lamp must stay on
    await page.locator('[data-testid=vote-1]').click();
    await expectLamps(page, 4, 3);
    await page.locator('[data-testid=vote-2]').click();
    await expectLamps(page, 3, 3);
    await expect(page.locator('[data-testid=stored-lamp]')).toHaveAttribute('data-on', 'true');

    // healthy 2 < 3: live flips, stored follows on the next evaluator tick
    await page.locator('[data-testid=vote-3]').click();
    await expectLamps(page, 2, 3);
    await expect(page.locator('[data-testid=stored-lamp]')).toHaveAttribute('data-on', 'false', { timeout: 2000 });
    const flip = (await readEvents(page, 'quorum-event')).find((e) => e.type === 'stored-flip' && e.to === false)!;
    expect(flip.healthy).toBe(2);
    expect(flip.threshold).toBe(3);

    // back over the line: exactly one more transition
    await page.locator('[data-testid=vote-3]').click();
    await expectLamps(page, 3, 3);
    await expect(page.locator('[data-testid=stored-lamp]')).toHaveAttribute('data-on', 'true', { timeout: 2000 });
    const flips = (await readEvents(page, 'quorum-event')).filter((e) => e.type === 'stored-flip');
    expect(flips.length).toBe(2);
    expect(errors).toEqual([]);
  });

  test('threshold slider moves the boundary; broken voter observes 500 regardless of its vote', async ({ page }) => {
    const errors = await openView(page, 'consensus');
    await page.locator('[data-testid=vote-5]').click(); // healthy 4
    await expectLamps(page, 4, 3);

    await page.locator('[data-testid=quorum-threshold]').fill('5');
    await expect(page.locator('[data-testid=quorum-sim]')).toHaveAttribute('data-threshold', '5');
    await expectLamps(page, 4, 5); // 4 < 5: off
    await page.locator('[data-testid=quorum-threshold]').fill('4');
    await expectLamps(page, 4, 4); // 4 >= 4: on again — the boundary is exact

    // break voter 1 (its vote is still ON): checkers must observe 500
    await page.locator('[data-testid=break-1]').click();
    const v1 = page.locator('[data-testid=voter][data-index="1"]');
    await expect(v1).toHaveAttribute('data-code', '500');
    await expect(v1).toHaveAttribute('data-on', 'true');
    await expectLamps(page, 3, 4);
    // turning its vote off changes nothing a checker can see
    await page.locator('[data-testid=vote-1]').click();
    await expect(v1).toHaveAttribute('data-code', '500');
    await expectLamps(page, 3, 4);
    expect(errors).toEqual([]);
  });

  test('STORED lamp keeps serving through a control-plane kill (static stability)', async ({ page }) => {
    const errors = await openView(page, 'consensus');
    await expect(page.locator('[data-testid=stored-lamp]')).toHaveAttribute('data-on', 'true');

    await page.locator('[data-testid=quorum-kill-cp]').click();
    await expect(page.locator('[data-testid=quorum-sim]')).toHaveAttribute('data-cp', 'dead');
    await expect(page.locator('[data-testid=live-lamp]')).toHaveAttribute('data-state', 'down');
    await expect(page.locator('[data-testid=vote-1]')).toBeDisabled(); // voting greys out
    await expect(page.locator('[data-testid=quorum-threshold]')).toBeDisabled();

    // the WORLD keeps failing while nobody evaluates: break 3 of 5
    for (const i of [1, 2, 3]) await page.locator(`[data-testid=break-${i}]`).click();
    await expect(page.locator('[data-testid=quorum-sim]')).toHaveAttribute('data-healthy', '2');
    expect(await recomputeHealthy(page)).toBe(2);

    // several evaluator tick-periods pass: STORED must not move, and no
    // stored-flip may be written while the control plane is dead
    await page.waitForTimeout(1600);
    await expect(page.locator('[data-testid=stored-lamp]')).toHaveAttribute('data-on', 'true');
    const during = await readEvents(page, 'quorum-event');
    const killIdx = during.findIndex((e) => e.type === 'cp-killed');
    expect(killIdx).toBeGreaterThanOrEqual(0);
    expect(during.slice(killIdx).filter((e) => e.type === 'stored-flip')).toEqual([]);

    // restore: evaluation resumes and catches up with exactly one transition
    await page.locator('[data-testid=quorum-kill-cp]').click();
    await expect(page.locator('[data-testid=stored-lamp]')).toHaveAttribute('data-on', 'false', { timeout: 2000 });
    const after = await readEvents(page, 'quorum-event');
    const restoreIdx = after.findIndex((e) => e.type === 'cp-restored');
    const flipsAfter = after.slice(restoreIdx).filter((e) => e.type === 'stored-flip');
    expect(flipsAfter.length).toBe(1);
    expect(flipsAfter[0].healthy).toBe(2);
    expect(errors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Sim 3 — versions, not retries (bodies ported unchanged)             */
/* ------------------------------------------------------------------ */

test.describe('Sim 3 - versions, not retries', () => {
  test.skip(!HAS_SITE_BUILD, 'site/dist not built - run: cd site && npm run build');

  const tip = (page: Page, region: string) =>
    page.locator(`[data-testid=region-card][data-region=${region}]`).getAttribute('data-tip');

  const notebookText = (page: Page, region: string) =>
    page.$$eval(`[data-testid=notebook-${region}] [data-testid=nb-entry]`, (els) =>
      els.map((e) => `${e.getAttribute('data-version')}:${e.getAttribute('data-decision')}`)
    );

  async function proposeAndSettle(page: Page) {
    await page.locator('[data-testid=ops3-propose]').click();
    await expect(page.locator('[data-testid=consensus-sim]')).toHaveAttribute('data-busy', 'true');
    await expect(page.locator('[data-testid=consensus-sim]')).toHaveAttribute('data-busy', 'false', { timeout: 10000 });
  }

  test('commit fires exactly on the 3rd ack — before the stragglers even resolve', async ({ page }) => {
    const errors = await openView(page, 'consensus');
    // seed: all five ledgers end at v126 · Disabled
    for (const r of ['virginia', 'ohio', 'oregon', 'dublin', 'tokyo']) {
      expect(await tip(page, r)).toBe('126');
    }
    await expect(page.locator('[data-testid=committed-lamp]')).toHaveAttribute('data-version', '126');
    await expect(page.locator('[data-testid=tolerance-math]')).toContainText('majority = 3');
    await expect(page.locator('[data-testid=tolerance-math]')).toContainText('tolerates 2');

    await page.locator('[data-testid=ops3-propose]').click();
    await expect(page.locator('[data-testid=commit-banner]')).toBeVisible({ timeout: 5000 });

    // The lamp flips the moment the banner shows — while Dublin and Tokyo
    // are still unresolved (their verdicts land ~2s later).
    await expect(page.locator('[data-testid=committed-lamp]')).toHaveAttribute('data-version', '127');
    await expect(page.locator('[data-testid=committed-lamp]')).toHaveAttribute('data-decision', 'Enabled');
    expect(await tip(page, 'dublin')).toBe('126');
    expect(await tip(page, 'tokyo')).toBe('126');
    // consensus decided; convergence has NOT happened
    await expect(page.locator('[data-testid=convergence]')).toHaveAttribute('data-converged', 'false');

    // Event-order proof, from the sim's own log:
    await waitForEvent(page, 'ops3-event', (e) => e.type === 'settled' && e.version === 127, 8000);
    const events = await readEvents(page, 'ops3-event');
    const commitIdx = events.findIndex((e) => e.type === 'commit');
    expect(commitIdx).toBeGreaterThan(0);
    const commit = events[commitIdx];
    const before = events.slice(0, commitIdx);
    const acksBefore = before.filter((e) => e.type === 'ack');
    // exactly 3 acks before the commit: not 2 (never early), not 4 or 5 (never waits)
    expect(acksBefore.length).toBe(3);
    expect(acksBefore.map((e) => e.ackCount)).toEqual([1, 2, 3]);
    expect(commit.ackCount).toBe(3);
    expect(commit.onAck).toBe(acksBefore[2].region);
    expect(commit.laggards.sort()).toEqual(['dublin', 'tokyo']);
    // no straggler verdict had landed yet when the decision committed
    expect(before.filter((e) => e.type === 'lost' || e.type === 'unreachable')).toEqual([]);
    // ... and they do land, afterwards
    expect(events.some((e) => e.type === 'lost' && e.region === 'dublin')).toBe(true);
    expect(events.some((e) => e.type === 'unreachable' && e.region === 'tokyo')).toBe(true);
    expect(errors).toEqual([]);
  });

  test('multi-miss catch-up: offline region replays the exact missing versions, in order; convergence only when all five match', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' }); // sims honor it: same order, 10x pace
    const errors = await openView(page, 'consensus');

    // Flip the switch 5 times while Tokyo is offline (Dublin drops them too):
    // v127..v131 all commit on the Virginia/Ohio/Oregon majority.
    for (let i = 0; i < 5; i++) await proposeAndSettle(page);
    await expect(page.locator('[data-testid=committed-lamp]')).toHaveAttribute('data-version', '131');
    expect(await tip(page, 'tokyo')).toBe('126');
    expect(await tip(page, 'virginia')).toBe('131');
    await expect(page.locator('[data-testid=convergence]')).toHaveAttribute('data-converged', 'false');

    // Tokyo reconnects: nobody re-presses anything — history replicates.
    await page.locator('[data-testid=set-online-tokyo]').click();
    await waitForEvent(page, 'ops3-event', (e) => e.type === 'caught-up' && e.region === 'tokyo', 8000);
    const events = await readEvents(page, 'ops3-event');
    // the speech-bubble exchange happened, with the real numbers
    const ask = events.find((e) => e.type === 'ask' && e.region === 'tokyo')!;
    const tell = events.find((e) => e.type === 'tell' && e.region === 'tokyo')!;
    const have = events.find((e) => e.type === 'have' && e.region === 'tokyo')!;
    expect(ask).toBeTruthy();
    expect(tell.latest).toBe(131);
    expect(have.local).toBe(126);
    expect(events.indexOf(ask)).toBeLessThan(events.indexOf(tell));
    expect(events.indexOf(tell)).toBeLessThan(events.indexOf(have));
    // the replay is EXACTLY the missing range, ascending — no gaps, no repeats
    const replayed = events.filter((e) => e.type === 'replay' && e.region === 'tokyo').map((e) => e.version);
    expect(replayed).toEqual([127, 128, 129, 130, 131]);
    // no second press: exactly the 5 original proposals exist
    expect(events.filter((e) => e.type === 'propose').length).toBe(5);
    expect(await tip(page, 'tokyo')).toBe('131');
    expect(await notebookText(page, 'tokyo')).toEqual(await notebookText(page, 'virginia'));

    // Dublin is still behind: converged must remain false...
    await expect(page.locator('[data-testid=convergence]')).toHaveAttribute('data-converged', 'false');
    const dublinReplayedYet = events.filter((e) => e.type === 'replay' && e.region === 'dublin');
    expect(dublinReplayedYet).toEqual([]);

    // ...until Dublin also reconnects and replays ITS missing range.
    await page.locator('[data-testid=set-online-dublin]').click();
    await waitForEvent(page, 'ops3-event', (e) => e.type === 'caught-up' && e.region === 'dublin', 8000);
    const after = await readEvents(page, 'ops3-event');
    expect(after.filter((e) => e.type === 'replay' && e.region === 'dublin').map((e) => e.version)).toEqual([
      127, 128, 129, 130, 131,
    ]);
    await expect(page.locator('[data-testid=convergence]')).toHaveAttribute('data-converged', 'true');
    expect(after.some((e) => e.type === 'converged')).toBe(true);
    // all five ledgers are now literally identical
    const virginia = await notebookText(page, 'virginia');
    expect(virginia[virginia.length - 1]).toBe('131:Enabled');
    for (const r of ['ohio', 'oregon', 'dublin', 'tokyo']) {
      expect(await notebookText(page, r)).toEqual(virginia);
    }
    expect(errors).toEqual([]);
  });

  test('with 3 of 5 unavailable the system refuses to decide (no majority, no commit)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = await openView(page, 'consensus');
    await page.locator('[data-testid=set-offline-ohio]').click(); // now only Virginia + Oregon can ack

    await page.locator('[data-testid=ops3-propose]').click();
    await expect(page.locator('[data-testid=no-quorum-banner]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('[data-testid=no-quorum-banner]')).toHaveAttribute('data-ack-count', '2');
    const events = await readEvents(page, 'ops3-event');
    expect(events.filter((e) => e.type === 'ack').length).toBe(2);
    expect(events.some((e) => e.type === 'commit')).toBe(false);
    const nq = events.find((e) => e.type === 'no-quorum')!;
    expect(nq.ackCount).toBe(2);
    // nothing was decided: the lamp still serves v126, and the stored copies were withdrawn
    await expect(page.locator('[data-testid=committed-lamp]')).toHaveAttribute('data-version', '126');
    expect(await tip(page, 'virginia')).toBe('126');
    expect(errors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Lineage (Paxos → Raft) and the concision budgets                    */
/* ------------------------------------------------------------------ */

test.describe('Consensus lineage & word budgets', () => {
  test.skip(!HAS_SITE_BUILD, 'site/dist not built - run: cd site && npm run build');

  test('renders both era cards, the adopters, and the two paper citations', async ({ page }) => {
    const errors = await openView(page, 'consensus');
    await expect(page.locator('#consensus h3#paxos-raft')).toContainText('Paxos → Raft in 60 seconds');

    const paxos = page.locator('[data-testid=evo-paxos]');
    await expect(paxos).toBeVisible();
    await expect(paxos).toContainText('Paxos');
    await expect(paxos).toContainText('1998'); // written 1989, published 1998
    await expect(paxos).toContainText('prepare/promise');
    await expect(paxos).toContainText('build it yourself'); // log/leader/membership left as exercises

    const raft = page.locator('[data-testid=evo-raft]');
    await expect(raft).toBeVisible();
    await expect(raft).toContainText('Raft');
    await expect(raft).toContainText('2014');
    await expect(raft).toContainText('AppendEntries');
    // Raft's card carries the house notebook — the log is built in
    expect(await raft.locator('[data-testid=nb-entry]').count()).toBeGreaterThan(0);

    const today = page.locator('[data-testid=evo-today]');
    for (const adopter of ['etcd', 'Consul', 'CockroachDB']) {
      await expect(today).toContainText(adopter);
    }
    await expect(today).toContainText('ARC'); // Paxos family, still shipping

    // citation links for both papers, house link idiom
    await expect(page.locator('#consensus a[href*="lamport.azurewebsites.net"]')).toBeVisible();
    await expect(page.locator('#consensus a[href*="raft.github.io"]')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('ledes, lineage, the consensus view, and menu blurbs stay inside the concision budgets', async ({ page }) => {
    const errors = await openView(page, 'idempotency');
    await gotoView(page, 'consensus');
    await expect(page.locator('#consensus')).toBeVisible();

    // each rewritten section lede is <= 60 words (one in 05, two in 09)
    const ledes = await page.$$eval('[data-testid=section-lede]', (els) =>
      els.map((e) => e.textContent || '')
    );
    expect(ledes.length).toBe(3);
    for (const lede of ledes) {
      expect(countWords([lede]), `lede over budget: "${lede.slice(0, 60)}…"`).toBeLessThanOrEqual(60);
    }

    // the lineage walkthrough stays QUICK: <= 250 words of prose
    const lineage = await page.$$eval('[data-testid=lineage-prose]', (els) =>
      els.map((e) => e.textContent || '')
    );
    expect(lineage.length).toBe(3);
    expect(countWords(lineage)).toBeLessThanOrEqual(250);

    // the whole re-stitched consensus view reads in one sitting: <= 650
    // words of prose outside the sim panels and the reading list
    const consensusProse = await page.$$eval(
      '#consensus > p:not(.try-live), #consensus > .callout',
      (els) => els.map((e) => e.textContent || '')
    );
    expect(countWords(consensusProse)).toBeLessThanOrEqual(650);

    // menu blurbs are card copy, not essays: <= 30 words each
    await gotoView(page, 'menu');
    const blurbs = await page.$$eval('.menu-card-blurb', (els) => els.map((e) => e.textContent || ''));
    expect(blurbs.length).toBe(10);
    for (const blurb of blurbs) {
      expect(countWords([blurb]), `blurb over budget: "${blurb.slice(0, 60)}…"`).toBeLessThanOrEqual(30);
    }

    // the hero opening holds to the lede budget too
    const hero = await page.locator('header.hero p.lede').innerText();
    expect(countWords([hero])).toBeLessThanOrEqual(60);
    expect(errors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Vote overlay on the hub                                             */
/* ------------------------------------------------------------------ */

test.describe('Guide hub - vote overlay', () => {
  test.skip(!HAS_SITE_BUILD, 'site/dist not built - run: cd site && npm run build');

  test('?vote=on shows boxes in visited views and the ballot exports all 10 ids', async ({ page }) => {
    const errors = await openSite(page, '/index.html?vote=on');
    await page.locator('button.nav-vote').click();

    // visit two views: each mounted view gets its vote box
    await gotoView(page, 'why-cells');
    await expect(page.locator('#why-cells .vote-box')).toBeVisible();
    await gotoView(page, 'hash-ring');
    await expect(page.locator('#hash-ring .vote-box')).toBeVisible();

    // progress reads out of the FULL registry (n of 10), not just the DOM
    await page.locator('#hash-ring .vote-box').getByRole('button', { name: 'Agree', exact: true }).click();
    await expect(page.locator('.vote-dock')).toContainText('1 of 10');

    // the exported ballot carries every section id — unvoted entries inert
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.vote-dock button', { hasText: 'Download JSON' }).click(),
    ]);
    const ballot = JSON.parse(fs.readFileSync((await download.path()) as string, 'utf8'));
    expect(ballot.format).toBe('vote-overlay/1');
    expect(Object.keys(ballot.pages.guide.sections).sort()).toEqual(
      REGISTRY.map((s) => s.id).slice().sort()
    );
    expect(ballot.pages.guide.sections['hash-ring'].choice).toBe('agree');
    expect(ballot.pages.guide.sections['trade-offs'].choice).toBeUndefined();
    expect(errors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Themes — light and dark screenshots of menu + the new views         */
/* ------------------------------------------------------------------ */

test.describe('Guide hub - themes', () => {
  test.skip(!HAS_SITE_BUILD, 'site/dist not built - run: cd site && npm run build');

  for (const scheme of ['light', 'dark'] as const) {
    test(`menu, idempotency and consensus views render in ${scheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 1280, height: 1100 });
      const errors = await openSite(page);
      fs.mkdirSync(SHOT_DIR, { recursive: true });

      // the menu view — the hub's new front door
      await page.screenshot({ path: path.join(SHOT_DIR, `menu-${scheme}.png`), fullPage: true });

      // walk in via the card, put some life in the sim, shoot the view
      await page.locator('[data-testid=menu-card][data-section=idempotency]').click();
      await page.locator('[data-testid=idem-pay-A]').click();
      await waitForEvent(page, 'idem-event', (e) => e.type === 'charged');
      await page.screenshot({ path: path.join(SHOT_DIR, `idempotency-${scheme}.png`) });

      // bottom nav → menu → consensus card; commit one proposal for the shot
      await page.locator('.view-host[data-view="idempotency"] [data-testid=nav-menu]').click();
      await page.locator('[data-testid=menu-card][data-section=consensus]').click();
      await page.locator('[data-testid=ops3-propose]').click();
      await expect(page.locator('[data-testid=commit-banner]')).toBeVisible({ timeout: 8000 });
      await page.screenshot({ path: path.join(SHOT_DIR, `consensus-${scheme}.png`) });
      expect(errors).toEqual([]);
    });
  }
});
