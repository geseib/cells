import React, { useEffect, useMemo, useRef, useState } from 'react';
import MD5 from 'crypto-js/md5';
import Icon from '../ui/icons';
import { EventLog, SimEvent } from './shared';

/**
 * Sim 1 — Idempotency across a regional failover.
 *
 * Two regions process payments against an idempotency store. In "shared"
 * mode the store is one global table whose records become visible in the
 * OTHER region only after the replication lag elapses; in "isolated" mode
 * each region keeps its own table and never sees the other's records.
 *
 * Nothing here is scripted: every outcome (charged / double-charged /
 * deduped / 409 in-progress) falls out of the store operations and their
 * timestamps. The double-charge counter is DERIVED from the charge rows —
 * a retry that lands inside the lag window genuinely writes a second row.
 */

type RegionId = 'A' | 'B';

const REGION = {
  A: { name: 'Virginia', code: 'us-east-1' },
  B: { name: 'Oregon', code: 'us-west-2' },
} as const;

const ORDER_ID = 'ORD-1042';
const AMOUNT = 125;
const PROC_MS = 400; // time the handler spends "talking to the card network"
const TTL_MS = 3600_000; // Powertools' default idempotency-record expiry: 1h

interface Receipt {
  orderId: string;
  amount: number;
  chargeId: string;
  region: string;
  processedAt: string;
}

interface IdemRecord {
  key: string; // md5 of the whole payment payload — Powertools style
  payload: { orderId: string; amount: number };
  origin: RegionId;
  store: 'shared' | RegionId;
  createdAt: number; // sim ms of the INPROGRESS write
  completedAt: number | null; // sim ms of the COMPLETED write
  replLag: number; // lag captured at write time
  receipt: Receipt | null;
  expiresAt: string; // wall clock, display only
}

interface Charge {
  chargeId: string;
  orderId: string;
  amount: number;
  region: RegionId;
  at: number;
}

interface ClientResponse {
  region: RegionId;
  kind: 'charged' | 'deduped' | 'inprogress' | 'down';
  receipt: Receipt | null;
}

interface Sim {
  mode: 'shared' | 'isolated';
  alive: Record<RegionId, boolean>;
  records: IdemRecord[];
  charges: Charge[];
  events: SimEvent[];
  processing: Record<RegionId, boolean>;
  response: ClientResponse | null;
  chargeSeq: number;
}

const freshSim = (mode: Sim['mode']): Sim => ({
  mode,
  alive: { A: true, B: true },
  records: [],
  charges: [],
  events: [],
  processing: { A: false, B: false },
  response: null,
  chargeSeq: 0,
});

/**
 * What `region` sees in the store at sim time `t`. Local writes are visible
 * immediately; a shared record written in the other region is visible only
 * once its write is `replLag` old — and the COMPLETED update replicates on
 * its own clock, so a remote reader can see INPROGRESS after the origin has
 * already finished.
 */
function visibleStatus(rec: IdemRecord, region: RegionId, t: number): 'COMPLETED' | 'INPROGRESS' | null {
  if (rec.store !== 'shared' && rec.store !== region) return null;
  const lag = rec.store === 'shared' && rec.origin !== region ? rec.replLag : 0;
  if (rec.completedAt !== null && t >= rec.completedAt + lag) return 'COMPLETED';
  if (t >= rec.createdAt + lag) return 'INPROGRESS';
  return null;
}

const payloadKey = (orderId: string, amount: number) =>
  MD5(JSON.stringify({ orderId, amount })).toString();

const IdempotencySim: React.FC = () => {
  const [sim, setSim] = useState<Sim>(() => freshSim('shared'));
  const [lag, setLag] = useState(1200);
  // Sim clock: ms since mount/reset. Kept in a ref so handlers read it fresh.
  const startRef = useRef(performance.now());
  const timersRef = useRef<number[]>([]);
  const now = () => Math.round(performance.now() - startRef.current);

  // Re-render every 200ms while replication is pending so the "what each
  // region sees" line and the replication bar track the sim clock.
  const [, setTick] = useState(0);
  const pendingReplication = sim.records.some(
    (r) => r.store === 'shared' && r.replLag > 0 && (r.completedAt === null || now() < r.completedAt + r.replLag)
  );
  useEffect(() => {
    if (!pendingReplication && !sim.processing.A && !sim.processing.B) return undefined;
    const id = window.setInterval(() => setTick((x) => x + 1), 200);
    return () => window.clearInterval(id);
  }, [pendingReplication, sim.processing.A, sim.processing.B]);

  useEffect(() => () => timersRef.current.forEach((id) => window.clearTimeout(id)), []);

  const reset = (mode: Sim['mode']) => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
    startRef.current = performance.now();
    setSim(freshSim(mode));
  };

  const completePayment = (region: RegionId, key: string) => {
    const t = now();
    setSim((s) => {
      const rec = s.records.find((r) => r.key === key && r.origin === region && r.completedAt === null);
      if (!rec) return s;
      if (!s.alive[region]) {
        return {
          ...s,
          processing: { ...s.processing, [region]: false },
          events: [
            ...s.events,
            {
              t,
              type: 'processing-lost',
              region,
              label: `${REGION[region].name} died mid-flight — the record stays INPROGRESS until its expiry`,
              tone: 'bad',
            },
          ],
        };
      }
      const chargeSeq = s.chargeSeq + 1;
      const chargeId = `ch_${String(chargeSeq).padStart(3, '0')}${region === 'A' ? 'e' : 'w'}`;
      const charge: Charge = { chargeId, orderId: rec.payload.orderId, amount: rec.payload.amount, region, at: t };
      const receipt: Receipt = {
        orderId: rec.payload.orderId,
        amount: rec.payload.amount,
        chargeId,
        region: REGION[region].code,
        processedAt: `t+${(t / 1000).toFixed(2)}s`,
      };
      const charges = [...s.charges, charge];
      const rowsForOrder = charges.filter((c) => c.orderId === rec.payload.orderId).length;
      const duplicate = rowsForOrder > 1;
      return {
        ...s,
        charges,
        chargeSeq,
        processing: { ...s.processing, [region]: false },
        records: s.records.map((r) => (r === rec ? { ...r, completedAt: t, receipt } : r)),
        response: { region, kind: 'charged', receipt },
        events: [
          ...s.events,
          {
            t,
            type: 'charged',
            region,
            chargeId,
            orderId: rec.payload.orderId,
            duplicate,
            label: duplicate
              ? `${REGION[region].name} charged $${AMOUNT} — wrote charge row ${chargeId} — row #${rowsForOrder} for ${rec.payload.orderId}: DOUBLE CHARGE`
              : `${REGION[region].name} charged $${AMOUNT} — wrote charge row ${chargeId} — record now COMPLETED`,
            tone: duplicate ? 'bad' : 'good',
          },
        ],
      };
    });
  };

  const pay = (region: RegionId) => {
    const t = now();
    const key = payloadKey(ORDER_ID, AMOUNT);
    setSim((s) => {
      const attempt: SimEvent = {
        t,
        type: 'pay-attempt',
        region,
        orderId: ORDER_ID,
        mode: s.mode,
        lagMs: s.mode === 'shared' ? lag : null,
        label: `client sends POST /pay {${ORDER_ID}, $${AMOUNT}} to ${REGION[region].name}`,
        tone: 'info',
      };
      if (!s.alive[region]) {
        return {
          ...s,
          response: { region, kind: 'down', receipt: null },
          events: [
            ...s.events,
            attempt,
            { t, type: 'request-failed', region, label: `${REGION[region].name} is DOWN — connection refused`, tone: 'bad' },
          ],
        };
      }
      // The handler's conditional-put view: the record wins if ANY copy with
      // this key is visible here (COMPLETED beats INPROGRESS). A copy still
      // in replication flight is invisible — that IS the double-charge hole.
      const rec =
        s.records.find((r) => r.key === key && visibleStatus(r, region, t) === 'COMPLETED') ??
        s.records.find((r) => r.key === key && visibleStatus(r, region, t) === 'INPROGRESS');
      const seen = rec ? visibleStatus(rec, region, t) : null;
      if (rec && seen === 'COMPLETED') {
        return {
          ...s,
          response: { region, kind: 'deduped', receipt: rec.receipt },
          events: [
            ...s.events,
            attempt,
            {
              t,
              type: 'deduped',
              region,
              chargeId: rec.receipt?.chargeId,
              receiptRegion: rec.receipt?.region,
              label: `${REGION[region].name} found a COMPLETED record for this key — returned the STORED receipt (${rec.receipt?.chargeId}, processed in ${rec.receipt?.region}). No new charge.`,
              tone: 'good',
            },
          ],
        };
      }
      if (rec && seen === 'INPROGRESS') {
        return {
          ...s,
          response: { region, kind: 'inprogress', receipt: null },
          events: [
            ...s.events,
            attempt,
            {
              t,
              type: 'rejected-inprogress',
              region,
              label: `${REGION[region].name} sees the record INPROGRESS — 409 IdempotencyAlreadyInProgressError, retry later`,
              tone: 'warn',
            },
          ],
        };
      }
      // No visible record: write INPROGRESS and start processing — the only
      // path that can create a charge row.
      const newRec: IdemRecord = {
        key,
        payload: { orderId: ORDER_ID, amount: AMOUNT },
        origin: region,
        store: s.mode === 'shared' ? 'shared' : region,
        createdAt: t,
        completedAt: null,
        replLag: s.mode === 'shared' ? lag : 0,
        receipt: null,
        expiresAt: new Date(Date.now() + TTL_MS).toLocaleTimeString(),
      };
      const id = window.setTimeout(() => completePayment(region, key), PROC_MS);
      timersRef.current.push(id);
      return {
        ...s,
        records: [...s.records, newRec],
        processing: { ...s.processing, [region]: true },
        events: [
          ...s.events,
          attempt,
          {
            t,
            type: 'inprogress-written',
            region,
            key,
            lagMs: newRec.replLag,
            store: newRec.store,
            label:
              s.mode === 'shared'
                ? `${REGION[region].name} saw no record → wrote INPROGRESS to the global table (visible in ${REGION[region === 'A' ? 'B' : 'A'].name} after ${lag}ms) → charging…`
                : `${REGION[region].name} saw no record in ITS OWN table → wrote INPROGRESS locally → charging…`,
            tone: 'info',
          },
        ],
      };
    });
  };

  const toggleKill = (region: RegionId) => {
    const t = now();
    setSim((s) => {
      const alive = !s.alive[region];
      return {
        ...s,
        alive: { ...s.alive, [region]: alive },
        events: [
          ...s.events,
          {
            t,
            type: alive ? 'region-restored' : 'region-killed',
            region,
            label: alive ? `${REGION[region].name} restored` : `${REGION[region].name} KILLED — mid-failover, the client will retry elsewhere`,
            tone: alive ? 'good' : 'bad',
          },
        ],
      };
    });
  };

  // ---- derived, never scripted -------------------------------------------
  const byOrder = new Map<string, number>();
  sim.charges.forEach((c) => byOrder.set(c.orderId, (byOrder.get(c.orderId) ?? 0) + 1));
  const doubleCharges = [...byOrder.values()].reduce((acc, n) => acc + Math.max(0, n - 1), 0);
  const dedupes = sim.events.filter((e) => e.type === 'deduped').length;

  const t = now();
  const regionView = (region: RegionId): string => {
    const key = payloadKey(ORDER_ID, AMOUNT);
    const recs = sim.records.filter((r) => r.key === key);
    if (recs.length === 0) return 'sees no record';
    if (recs.some((r) => visibleStatus(r, region, t) === 'COMPLETED')) return 'sees COMPLETED';
    if (recs.some((r) => visibleStatus(r, region, t) === 'INPROGRESS')) return 'sees INPROGRESS';
    const inFlight = recs.find((r) => r.store === 'shared' && r.origin !== region);
    if (inFlight) {
      const last = inFlight.completedAt ?? inFlight.createdAt;
      const lagLeft = last + inFlight.replLag - t;
      return `sees no record yet — replicating (${Math.max(0, Math.ceil(lagLeft / 100) / 10)}s left)`;
    }
    return 'sees no record (isolated table)';
  };

  const replBar = (region: RegionId) => {
    if (sim.mode !== 'shared') return null;
    const rec = sim.records.find((r) => r.origin !== region && r.store === 'shared');
    if (!rec || rec.replLag === 0) return null;
    const last = rec.completedAt ?? rec.createdAt;
    const pct = Math.min(100, Math.round(((t - last) / rec.replLag) * 100));
    if (pct >= 100) return <div className="ops-repl done">replica in sync</div>;
    return (
      <div className="ops-repl">
        <span className="ops-repl-label">replicating here…</span>
        <span className="ops-repl-track"><span className="ops-repl-fill" style={{ width: `${pct}%` }} /></span>
      </div>
    );
  };

  const modeSwitch = (mode: Sim['mode'], label: string, testid: string) => (
    <button className={sim.mode === mode ? 'selected' : ''} data-testid={testid} onClick={() => reset(mode)}>
      {label}
    </button>
  );

  return (
    <div className="panel" data-testid="idem-sim" data-mode={sim.mode}>
      <div className="controls">
        {modeSwitch('shared', 'Shared global table', 'idem-mode-shared')}
        {modeSwitch('isolated', 'Isolated per-region tables', 'idem-mode-isolated')}
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: '1 1 220px' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>replication lag</span>
          <input
            type="range"
            min={0}
            max={2000}
            step={100}
            value={lag}
            disabled={sim.mode !== 'shared'}
            onChange={(e) => setLag(Number(e.target.value))}
            style={{ flex: 1 }}
            data-testid="idem-lag"
            aria-label="Replication lag in milliseconds"
          />
          <span style={{ fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums', color: 'var(--ink-2)' }} data-testid="idem-lag-value">
            {sim.mode === 'shared' ? `${lag}ms` : 'n/a'}
          </span>
        </label>
        <button onClick={() => reset(sim.mode)} data-testid="idem-reset">
          <Icon name="refresh" />Reset
        </button>
      </div>

      <div className="ops-region-grid">
        {(['A', 'B'] as RegionId[]).map((r) => (
          <div
            key={r}
            className={`ops-region-card${sim.alive[r] ? '' : ' down'}${sim.processing[r] ? ' busy' : ''}`}
            data-testid={`idem-region-${r}`}
            data-alive={sim.alive[r]}
          >
            <div className="ops-region-head">
              <span className="ops-region-name">{REGION[r].name}</span>
              <span className="ops-region-code">{REGION[r].code}</span>
              <span className={`ops-pill${sim.alive[r] ? ' ok' : ' bad'}`}>
                {sim.alive[r] ? (sim.processing[r] ? 'processing…' : 'healthy') : 'DOWN'}
              </span>
            </div>
            <div className="ops-region-view" data-testid={`idem-view-${r}`}>{regionView(r)}</div>
            {replBar(r)}
            <div className="ops-region-actions">
              <button
                className="primary"
                onClick={() => pay(r)}
                disabled={sim.processing[r]}
                data-testid={`idem-pay-${r}`}
              >
                <Icon name="bolt" />{r === 'A' ? `Pay $${AMOUNT}` : 'Retry the payment'}
              </button>
              {sim.alive[r] ? (
                <button className="danger" onClick={() => toggleKill(r)} data-testid={`idem-kill-${r}`}>
                  <Icon name="skull" />Kill {REGION[r].name}
                </button>
              ) : (
                <button onClick={() => toggleKill(r)} data-testid={`idem-kill-${r}`}>
                  Restore {REGION[r].name}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {sim.response && (
        <div className={`ops-response ${sim.response.kind}`} data-testid="idem-response" data-kind={sim.response.kind}>
          {sim.response.kind === 'charged' && (
            <>the client got a receipt from {REGION[sim.response.region].name}: <code>{JSON.stringify(sim.response.receipt)}</code></>
          )}
          {sim.response.kind === 'deduped' && (
            <>
              the client got the <strong>stored</strong> receipt back — note{' '}
              <code>"region": "{sim.response.receipt?.region}"</code>: {REGION[sim.response.region].name} answered, but the
              money moved exactly once. Same <code>{sim.response.receipt?.chargeId}</code>, no new row.
            </>
          )}
          {sim.response.kind === 'inprogress' && (
            <>409 — another attempt holds the INPROGRESS lock for this key; safe to retry after it finishes or expires.</>
          )}
          {sim.response.kind === 'down' && <>connection refused — {REGION[sim.response.region].name} is down. Retry against the other region.</>}
        </div>
      )}

      <div className="stat-row">
        <div className="stat">
          <div className={`value ${doubleCharges > 0 ? 'bad' : 'good'}`} data-testid="double-charge-count">
            {doubleCharges}
          </div>
          <div className="label">double charges — derived from the charge rows, never scripted</div>
        </div>
        <div className="stat">
          <div className="value" data-testid="charge-count">{sim.charges.length}</div>
          <div className="label">charge rows written (the money table)</div>
        </div>
        <div className="stat">
          <div className={`value ${dedupes > 0 ? 'good' : ''}`} data-testid="dedupe-count">{dedupes}</div>
          <div className="label">retries answered from the stored receipt</div>
        </div>
      </div>

      <div className="viz-flex" style={{ alignItems: 'flex-start', marginTop: '1rem' }}>
        <div style={{ flex: '1 1 320px' }}>
          <div className="mini-title">
            The idempotency record{sim.mode === 'shared' ? ' (global table)' : 's (one table per region)'} — what
            Powertools actually stores
          </div>
          <div className="table-scroll">
            <table className="data" style={{ minWidth: 420 }}>
              <thead>
                <tr><th>id (hashed)</th><th>status</th><th>expiry</th><th>data</th></tr>
              </thead>
              <tbody>
                {sim.records.length === 0 && (
                  <tr><td colSpan={4} style={{ color: 'var(--muted)' }}>— empty —</td></tr>
                )}
                {sim.records.map((rec, ri) => (
                  <tr key={`${rec.store}-${rec.key}-${ri}`} data-testid="idem-record"
                    data-status={rec.completedAt !== null ? 'COMPLETED' : 'INPROGRESS'} data-store={rec.store}>
                    <td title={rec.key} style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem' }}>
                      {rec.store === 'shared' ? '' : `[${REGION[rec.store as RegionId].name}] `}#{rec.key.slice(0, 10)}…
                    </td>
                    <td>
                      <span className={`ops-pill ${rec.completedAt !== null ? 'ok' : 'warn'}`}>
                        {rec.completedAt !== null ? 'COMPLETED' : 'INPROGRESS'}
                      </span>
                    </td>
                    <td>{rec.expiresAt}</td>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>
                      {rec.receipt ? `{${rec.receipt.chargeId}, ${rec.receipt.region}}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sim.mode === 'shared' && new Set(sim.records.map((r) => r.key)).size < sim.records.length && (
            <p className="ops-conflict-note">
              two writers raced the replication window and both put this key — the global table converges them
              last-writer-wins, but both charges already happened. Convergence is not idempotency.
            </p>
          )}
        </div>
        <div style={{ flex: '1 1 320px' }}>
          <div className="mini-title">The charges table — where the money actually moves</div>
          <div className="table-scroll">
            <table className="data" style={{ minWidth: 380 }}>
              <thead>
                <tr><th>t</th><th>charge</th><th>order</th><th>amount</th><th>region</th></tr>
              </thead>
              <tbody>
                {sim.charges.length === 0 && (
                  <tr><td colSpan={5} style={{ color: 'var(--muted)' }}>— no money moved yet —</td></tr>
                )}
                {sim.charges.map((c, i) => {
                  const dup = sim.charges.filter((x) => x.orderId === c.orderId).indexOf(c) > 0;
                  return (
                    <tr key={c.chargeId} data-testid="charge-row" data-order={c.orderId}
                      data-region={REGION[c.region].code} data-charge-id={c.chargeId}
                      className={dup ? 'ops-dup-row' : undefined}>
                      <td>{(c.at / 1000).toFixed(2)}s</td>
                      <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem' }}>{c.chargeId}</td>
                      <td>{c.orderId}{dup && <span className="ops-pill bad" style={{ marginLeft: 6 }}>duplicate</span>}</td>
                      <td>${c.amount.toFixed(2)}</td>
                      <td>{REGION[c.region].code}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <EventLog events={sim.events} testid="idem-event" />
      <p className="panel-hint">
        The record is exactly what{' '}
        <a href="https://docs.powertools.aws.dev/lambda/python/latest/utilities/idempotency/" target="_blank" rel="noopener noreferrer">
          Powertools
        </a>{' '}
        keeps in DynamoDB: the id is an md5 of the whole payload (change the amount and it's a different
        payment), <code>INPROGRESS</code> is the lock, <code>COMPLETED</code> stores the response to replay, and
        the expiry bounds how long "same request" means. Shrink the lag and the double-charge window shrinks
        with it; isolate the tables and no amount of waiting saves you.
      </p>
    </div>
  );
};

export default IdempotencySim;
