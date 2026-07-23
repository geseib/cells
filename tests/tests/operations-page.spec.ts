/**
 * Operations page (site/dist/operations.html) — the three in-browser sims.
 *
 * Needs NO env vars and NO network: the built site is served entirely via
 * page.route from site/dist (same harness idea as failover-demo.spec.ts's
 * stubbed suite). Skips cleanly only when the site build output is missing.
 *
 * The sims expose their internal event logs as data-event JSON attributes;
 * every assertion here RECOMPUTES the expected outcome independently from
 * those events / the rendered inputs and compares it with what the UI shows:
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
const HAS_SITE_BUILD = fs.existsSync(path.join(SITE_DIST, 'operations.html'));
const ORIGIN = 'http://localhost:4173';
const SHOT_DIR = process.env.OPS_SHOT_DIR || path.resolve(__dirname, '../test-results/ops-screens');

const STATIC_TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.map': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain'
};

function serveSite(route: Route, urlPath: string) {
  let file = path.join(SITE_DIST, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(SITE_DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(SITE_DIST, 'operations.html');
  }
  return route.fulfill({
    status: 200,
    contentType: STATIC_TYPES[path.extname(file)] || 'application/octet-stream',
    body: fs.readFileSync(file)
  });
}

/** Serve site/dist at ORIGIN and collect console/page errors for the test. */
async function openSite(page: Page, pagePath = '/operations.html'): Promise<string[]> {
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

test.describe('Operations page', () => {
  test.skip(!HAS_SITE_BUILD, 'site/dist not built - run: cd site && npm run build');

  test('loads with nav, hero, all three sims and zero console errors', async ({ page }) => {
    const errors = await openSite(page);
    await expect(page.locator('nav.top-nav')).toContainText('Cells · Operations');
    for (const href of ['./index.html', './primer.html', './slides.html']) {
      await expect(page.locator(`nav.top-nav a[href="${href}"]`)).toBeVisible();
    }
    await expect(page.locator('#idempotency h2')).toContainText('Retry without double-charging');
    await expect(page.locator('[data-testid=idem-sim]')).toBeVisible();
    await expect(page.locator('[data-testid=quorum-sim]')).toBeVisible();
    await expect(page.locator('[data-testid=consensus-sim]')).toBeVisible();
    // Powertools is name-dropped as the production tool
    await expect(page.locator('#idempotency')).toContainText('Powertools');
    expect(errors).toEqual([]);
  });

  test('every other page links to the Operations page', async ({ page }) => {
    const errors = await openSite(page, '/index.html');
    for (const p of ['/index.html', '/primer.html', '/slides.html', '/flags.html']) {
      await page.goto(`${ORIGIN}${p}`);
      await expect
        .poll(() => page.locator('a[href="./operations.html"]').count(), {
          timeout: 10000,
          message: `Operations link missing on ${p}`,
        })
        .toBeGreaterThan(0);
    }
    expect(errors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Sim 1 — idempotency                                                 */
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
    const errors = await openSite(page);
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
    const errors = await openSite(page);
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
    const errors = await openSite(page);
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
/* Sim 2 — quorum switch                                               */
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
    const errors = await openSite(page);
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
    const errors = await openSite(page);
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
    const errors = await openSite(page);
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
/* Sim 3 — versions, not retries                                       */
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
    const errors = await openSite(page);
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
    const errors = await openSite(page);

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
    const errors = await openSite(page);
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
/* Section 04 — Paxos → Raft lineage, and the page's word budgets      */
/* ------------------------------------------------------------------ */

/** Same counting rule everywhere: whitespace-split, punctuation-only tokens
 *  (em dashes, arrows) don't count as words. */
const countWords = (texts: string[]) =>
  texts.join(' ').split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;

test.describe('Paxos → Raft section & concision budgets', () => {
  test.skip(!HAS_SITE_BUILD, 'site/dist not built - run: cd site && npm run build');

  test('renders both era cards, the adopters, and the two paper citations', async ({ page }) => {
    const errors = await openSite(page);
    await expect(page.locator('#paxos-raft h2')).toContainText('Paxos → Raft in 60 seconds');
    await expect(page.locator('nav.top-nav a[href="#paxos-raft"]')).toBeVisible();

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
    await expect(page.locator('#paxos-raft a[href*="lamport.azurewebsites.net"]')).toBeVisible();
    await expect(page.locator('#paxos-raft a[href*="raft.github.io"]')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('section ledes and total prose stay inside the concision budget', async ({ page }) => {
    const errors = await openSite(page);

    // each rewritten section lede is <= 60 words
    const ledes = await page.$$eval('[data-testid=section-lede]', (els) =>
      els.map((e) => e.textContent || '')
    );
    expect(ledes.length).toBe(3); // idempotency, quorum, consensus
    for (const lede of ledes) {
      expect(countWords([lede]), `lede over budget: "${lede.slice(0, 60)}…"`).toBeLessThanOrEqual(60);
    }
    // the hero opening holds to the same budget
    const hero = await page.locator('header.hero p.lede').innerText();
    expect(countWords([hero])).toBeLessThanOrEqual(60);

    // the lineage section is a QUICK walkthrough: <= 250 words of prose
    const paxosProse = await page.$$eval('#paxos-raft > p', (els) =>
      els.map((e) => e.textContent || '')
    );
    expect(countWords(paxosProse)).toBeLessThanOrEqual(250);

    // total page prose OUTSIDE the sim panels: section paragraphs, callouts,
    // hero lede. Pre-rewrite this measured ~980 words WITHOUT the lineage
    // section; the rewritten page fits everything, lineage included, in 800.
    const prose = await page.$$eval(
      'main section.lesson > p, main section.lesson > .callout, header.hero p.lede',
      (els) => els.map((e) => e.textContent || '')
    );
    expect(countWords(prose)).toBeLessThanOrEqual(800);
    expect(errors).toEqual([]);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`page top and lineage section screenshots in ${scheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 1280, height: 1100 });
      const errors = await openSite(page);
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      // page top: the new opening + the idempotency lede
      await page.screenshot({ path: path.join(SHOT_DIR, `page-top-${scheme}.png`) });
      await page.addStyleTag({ content: 'nav.top-nav { display: none; }' });
      await page.locator('#paxos-raft').scrollIntoViewIfNeeded();
      await page.locator('#paxos-raft').screenshot({
        path: path.join(SHOT_DIR, `paxos-raft-${scheme}.png`),
      });
      expect(errors).toEqual([]);
    });
  }
});

/* ------------------------------------------------------------------ */
/* Themes — light and dark screenshots of each sim                     */
/* ------------------------------------------------------------------ */

test.describe('Operations page - themes', () => {
  test.skip(!HAS_SITE_BUILD, 'site/dist not built - run: cd site && npm run build');

  for (const scheme of ['light', 'dark'] as const) {
    test(`renders in ${scheme} theme with zero console errors`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      const errors = await openSite(page);
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      // the sticky nav would float over element screenshots taken mid-page
      await page.addStyleTag({ content: 'nav.top-nav { display: none; }' });

      // put some life in the shots: one payment, one committed proposal
      await page.locator('[data-testid=idem-pay-A]').click();
      await waitForEvent(page, 'idem-event', (e) => e.type === 'charged');
      await page.locator('[data-testid=ops3-propose]').click();
      await expect(page.locator('[data-testid=commit-banner]')).toBeVisible({ timeout: 8000 });

      for (const [id, name] of [
        ['idem-sim', 'sim1-idempotency'],
        ['quorum-sim', 'sim2-quorum'],
        ['consensus-sim', 'sim3-consensus'],
      ] as const) {
        await page.locator(`[data-testid=${id}]`).scrollIntoViewIfNeeded();
        await page.locator(`[data-testid=${id}]`).screenshot({
          path: path.join(SHOT_DIR, `${name}-${scheme}.png`),
        });
      }
      expect(errors).toEqual([]);
    });
  }
});
