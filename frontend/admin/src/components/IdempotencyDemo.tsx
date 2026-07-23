import React, { useCallback, useEffect, useRef, useState } from 'react';

interface IdempotencyDemoProps {
  apiUrl: string;
}

/** Powertools idempotency record as /admin/idem/status reports it (raw hashed
    id + the parsed stored receipt side by side — correction 11). */
interface IdemRecord {
  id: string | null;
  status?: string;
  expiration?: number;
  data?: any;
  orderId?: string | null;
  chargeId?: string | null;
  region?: string | null;
}

interface ChargeRow {
  id?: string;
  orderId?: string;
  amount?: number;
  chargeId?: string;
  region?: string;
  processedAt?: string;
}

interface RegionHealth {
  statusCode?: number;
  killed?: boolean;
}

interface IdemRegion {
  region: string;
  apiUrl: string;
  health: RegionHealth | string;
  shared: IdemRecord[];
  isolated: IdemRecord[];
  charges: ChargeRow[];
}

interface SharedRecordSummary {
  id: string;
  orderId: string | null;
  inRegions: string[];
  replicated: boolean;
}

interface IdemStatus {
  configured: boolean;
  regions: IdemRegion[];
  sharedRecords: SharedRecordSummary[];
}

type Outcome = 'charged' | 'deduped' | 'double-charged' | 'in-progress' | 'failed';

interface Receipt {
  orderId?: string;
  amount?: number;
  chargeId?: string;
  region?: string; // where the charge EXECUTED (the dedupe proof)
  servedBy?: string; // who answered this request
  processedAt?: string;
  mode?: string;
}

interface Attempt {
  key: number;
  at: string;
  askedRegion: string;
  orderId: string;
  amount: number;
  mode: 'shared' | 'isolated';
  outcome: Outcome;
  receipt: Receipt | null;
  detail: string | null;
}

interface TimelineEntry {
  at: string;
  text: string;
}

const TIMELINE_CAP = 50;

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache'
};

const newOrderId = () => `order-${Math.random().toString(36).slice(2, 8)}`;

/** health arrives as {statusCode, killed} from idem-admin; tolerate a plain
    "healthy"/"failing" string without changing what we assert on. */
const readHealth = (h: RegionHealth | string | undefined): { code: number | null; killed: boolean } => {
  if (h && typeof h === 'object') {
    return { code: typeof h.statusCode === 'number' ? h.statusCode : null, killed: h.killed === true };
  }
  if (h === 'healthy') return { code: 200, killed: false };
  return { code: null, killed: false };
};

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Transitions observed between two consecutive status polls. Defensive on
    purpose: a malformed payload must crash the RENDER (so the boundary shows
    a panel), never this diff (which would silently eat the evidence). */
const diffStatus = (prev: IdemStatus | null, next: IdemStatus): string[] => {
  const out: string[] = [];
  if (!next.configured) return out;
  if (!prev || !prev.configured) {
    const names = asArray<IdemRegion>(next.regions).map((r) => r?.region).filter(Boolean);
    if (names.length > 0) out.push(`Observed configured demo: ${names.join(', ')} (primary first)`);
    return out;
  }
  const prevRegions = new Map(asArray<IdemRegion>(prev.regions).map((r) => [r?.region, r]));
  for (const r of asArray<IdemRegion>(next.regions)) {
    const p = prevRegions.get(r?.region);
    if (!p) continue;
    const ph = readHealth(p.health);
    const nh = readHealth(r.health);
    if (ph.code !== nh.code && nh.code !== null) {
      out.push(
        nh.code === 200
          ? `${r.region} idem API recovered (200)`
          : `${r.region} idem API /health now returns ${nh.code}`
      );
    }
    if (ph.killed !== nh.killed) {
      out.push(nh.killed
        ? `Kill switch active on ${r.region} — payments there refuse with 503`
        : `Kill switch cleared on ${r.region}`);
    }
    const prevCharges = asArray<ChargeRow>(p.charges).length;
    const nextCharges = asArray<ChargeRow>(r.charges).length;
    if (prevCharges !== nextCharges) {
      out.push(`${r.region} charge rows: ${prevCharges} → ${nextCharges}`);
    }
  }
  const prevShared = new Map(
    asArray<SharedRecordSummary>(prev.sharedRecords).map((s) => [s?.id, s])
  );
  for (const s of asArray<SharedRecordSummary>(next.sharedRecords)) {
    const p = prevShared.get(s?.id);
    if (!p) {
      out.push(`Idempotency record${s.orderId ? ` for ${s.orderId}` : ''} appeared in the shared table`);
    } else if (!p.replicated && s.replicated) {
      out.push(`Shared record${s.orderId ? ` for ${s.orderId}` : ''} replicated to all regions`);
    }
  }
  return out;
};

let attemptSeq = 0;

const IdempotencyDemo: React.FC<IdempotencyDemoProps> = ({ apiUrl }) => {
  const [status, setStatus] = useState<IdemStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState(newOrderId);
  const [amount, setAmount] = useState('25');
  const [mode, setMode] = useState<'shared' | 'isolated'>('shared');
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState<string | null>(null); // region in flight
  const [killBusy, setKillBusy] = useState<string | null>(null);

  const statusRef = useRef<IdemStatus | null>(null);
  const attemptsRef = useRef<Attempt[]>([]);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const logEvents = useCallback((texts: string[]) => {
    if (texts.length === 0) return;
    const at = new Date().toLocaleTimeString();
    setTimeline((prev) => [...texts.map((text) => ({ at, text })), ...prev].slice(0, TIMELINE_CAP));
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!apiUrl) return;
    try {
      const response = await fetch(`${apiUrl}/admin/idem/status`, { headers: NO_CACHE_HEADERS });
      if (!response.ok) {
        if (mountedRef.current) setStatusError(`Status request failed (HTTP ${response.status})`);
        return;
      }
      const next: IdemStatus = await response.json();
      if (!mountedRef.current) return;
      logEvents(diffStatus(statusRef.current, next));
      statusRef.current = next;
      setStatus(next);
      setStatusError(null);
    } catch (err) {
      if (mountedRef.current) setStatusError('Could not reach /admin/idem/status');
      console.error('Idem status error:', err);
    }
  }, [apiUrl, logEvents]);

  // Poll status: 5s while configured (records/health move during the demo),
  // 15s while unconfigured (only waiting for deploy.sh to write IDEM_ENDPOINTS).
  useEffect(() => {
    if (!apiUrl) return undefined;
    refreshStatus();
    const ms = status?.configured ? 5000 : 15000;
    const interval = setInterval(refreshStatus, ms);
    return () => clearInterval(interval);
  }, [apiUrl, status?.configured, refreshStatus]);

  const pay = async (askedRegion: string) => {
    const amountNum = Number(amount);
    if (!orderId.trim()) {
      setActionError('orderId must not be empty.');
      return;
    }
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setActionError('Amount must be a positive number.');
      return;
    }
    setPayBusy(askedRegion);
    setActionError(null);
    logEvents([`Payment requested via ${askedRegion}: ${orderId.trim()} for $${amountNum} (${mode} mode)`]);
    try {
      const response = await fetch(`${apiUrl}/admin/idem/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ region: askedRegion, orderId: orderId.trim(), amount: amountNum, mode })
      });
      const data: any = await response.json().catch(() => ({}));
      if (!mountedRef.current) return;

      let outcome: Outcome;
      let receipt: Receipt | null = null;
      let detail: string | null = null;
      if (response.status === 409 || data.inProgress === true) {
        // The immediate-retry race: Powertools holds an INPROGRESS record for
        // this exact payload. Honest outcome — nothing was charged (yet).
        outcome = 'in-progress';
        detail = data.error || 'A payment with this exact payload is already in progress';
      } else if (!response.ok) {
        outcome = 'failed';
        detail = data.error || `Payment failed (HTTP ${response.status})`;
      } else {
        receipt = data as Receipt;
        const priorCharge = attemptsRef.current.find(
          (a) => a.orderId === orderId.trim() && a.receipt && a.receipt.chargeId
        );
        if (priorCharge && priorCharge.receipt!.chargeId === receipt.chargeId) {
          // Same chargeId as the first attempt = the stored receipt came back.
          outcome = 'deduped';
          detail = `served by ${receipt.servedBy || askedRegion}, executed by ${receipt.region || 'unknown'}`;
        } else if (priorCharge) {
          outcome = 'double-charged';
          detail = `new chargeId ${receipt.chargeId} — money moved a second time`;
        } else {
          outcome = 'charged';
          detail = null;
        }
      }
      const attempt: Attempt = {
        key: ++attemptSeq,
        at: new Date().toLocaleTimeString(),
        askedRegion,
        orderId: orderId.trim(),
        amount: amountNum,
        mode,
        outcome,
        receipt,
        detail
      };
      attemptsRef.current = [attempt, ...attemptsRef.current].slice(0, TIMELINE_CAP);
      setAttempts(attemptsRef.current);
      logEvents([
        outcome === 'charged'
          ? `Charged: ${receipt?.chargeId} executed in ${receipt?.region}`
          : outcome === 'deduped'
            ? `Deduped: ${askedRegion} returned the SAME chargeId ${receipt?.chargeId} (executed by ${receipt?.region})`
            : outcome === 'double-charged'
              ? `DOUBLE CHARGE: ${receipt?.chargeId} in ${receipt?.region} — isolated stores cannot dedupe across regions`
              : outcome === 'in-progress'
                ? `In progress (409): ${askedRegion} is still working on this exact payload`
                : `Payment via ${askedRegion} failed: ${detail}`
      ]);
      await refreshStatus();
    } catch (err) {
      if (mountedRef.current) setActionError(`Payment request via ${askedRegion} failed`);
      console.error('Pay error:', err);
    } finally {
      if (mountedRef.current) setPayBusy(null);
    }
  };

  const toggleKill = async (region: string, currentlyKilled: boolean) => {
    const enabled = !currentlyKilled;
    setKillBusy(region);
    setActionError(null);
    logEvents([
      enabled
        ? `Kill requested on ${region} — its idem API will refuse payments with 503`
        : `Revive requested on ${region}`
    ]);
    try {
      const response = await fetch(`${apiUrl}/admin/idem/chaos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ region, enabled })
      });
      if (!response.ok) {
        const data: any = await response.json().catch(() => ({}));
        setActionError(data.error || `Kill toggle failed (HTTP ${response.status})`);
      } else {
        await refreshStatus();
      }
    } catch (err) {
      setActionError('Kill toggle failed');
      console.error('Idem chaos error:', err);
    } finally {
      if (mountedRef.current) setKillBusy(null);
    }
  };

  // Requests-vs-charges: requests are what this browser sent for the current
  // orderId; charges are REAL charge rows for it across both regions' tables.
  const currentOrderId = orderId.trim();
  const requestsForOrder = attempts.filter((a) => a.orderId === currentOrderId).length;
  const regions = status?.configured ? status.regions : [];
  const chargesForOrder = status?.configured
    ? regions.reduce(
        (sum, r) => sum + asArray<ChargeRow>(r.charges).filter((c) => c.orderId === currentOrderId).length,
        0
      )
    : 0;

  const primaryRegion = regions[0];
  const secondaryRegion = regions[1];

  const outcomeLabel: Record<Outcome, string> = {
    charged: 'Charged',
    deduped: 'Deduped',
    'double-charged': 'Double-charged',
    'in-progress': 'In progress',
    failed: 'Failed'
  };

  const regionRole = (index: number) => (index === 0 ? 'primary' : 'secondary');

  return (
    <section className="section" data-testid="idem-root">
      <div className="kicker">Idempotency</div>
      <h2>Idempotency across regional failover — live</h2>
      <p className="lede">
        Pay once via the primary region, kill it, then retry the <strong>same order</strong> via the
        secondary. With the <strong>shared</strong> DynamoDB global table, Powertools returns the
        original receipt — same chargeId, no double charge. With <strong>isolated</strong>{' '}
        per-region tables the retry charges again, on purpose: that is the lesson.
      </p>

      {status === null ? (
        <div className="panel">
          <div className="empty-note">{statusError || 'Loading idempotency demo status…'}</div>
        </div>
      ) : !status.configured ? (
        <div className="panel" data-testid="idem-unconfigured">
          <h3>Not deployed yet</h3>
          <p className="hint-note" style={{ margin: 0 }}>
            The idempotency demo endpoints are not configured. deploy.sh writes the{' '}
            <span className="hash-chip">IDEM_ENDPOINTS</span> row into routing-config after the two
            regional idem stacks deploy (it needs at least 2 regions in config.json). Deploy them,
            then this tab lights up on its own — no rebuild needed.
          </p>
        </div>
      ) : (
        <>
          <div className="panel">
            <h3>Regions</h3>
            <p className="panel-note">
              Primary first — the primary region owns the shared global table. Health is fetched
              server-side by the admin API; the browser never dials a regional idem API.
            </p>
            <div className="idem-regions">
              {regions.map((r, index) => {
                const health = readHealth(r.health);
                return (
                  <div key={r.region} className="record-card idem-region-card" data-testid={`region-card-${r.region}`}>
                    <div className="grid">
                      <div>
                        <strong>Region</strong>{' '}
                        <span className={`failover-pill ${regionRole(index)}`}>{r.region}</span>
                      </div>
                      <div>
                        <strong>Role</strong> {regionRole(index)}
                      </div>
                      <div>
                        <strong>Health</strong>{' '}
                        <span
                          className={`health-chip ${health.code === 200 ? 'good' : 'bad'}`}
                          data-testid={`idem-health-${r.region}`}
                        >
                          /health {health.code ?? 'unreachable'}
                          {health.killed && <span className="chaos-badge">killed</span>}
                        </span>
                      </div>
                    </div>
                    <div className="values">{r.apiUrl}</div>
                    <button
                      className={health.killed ? 'primary' : 'danger'}
                      data-testid={`kill-toggle-${r.region}`}
                      onClick={() => toggleKill(r.region, health.killed)}
                      disabled={killBusy === r.region}
                    >
                      {killBusy === r.region
                        ? 'Working…'
                        : health.killed
                          ? `Revive ${r.region}`
                          : `Kill ${r.region}`}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel">
            <h3>Send a payment</h3>
            <div className="controls" style={{ marginBottom: 0 }}>
              <label className="select-label">
                Order
                <input
                  type="text"
                  data-testid="order-id-input"
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value)}
                  style={{ minWidth: 150 }}
                />
              </label>
              <label className="select-label">
                Amount $
                <input
                  type="text"
                  data-testid="amount-input"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  style={{ minWidth: 70 }}
                  inputMode="decimal"
                />
              </label>
              <div className="mode-toggle" data-testid="mode-toggle" role="group" aria-label="Idempotency store mode">
                <button
                  className={mode === 'shared' ? 'selected' : ''}
                  aria-pressed={mode === 'shared'}
                  data-testid="mode-shared"
                  onClick={() => setMode('shared')}
                >
                  Shared table
                </button>
                <button
                  className={mode === 'isolated' ? 'selected' : ''}
                  aria-pressed={mode === 'isolated'}
                  data-testid="mode-isolated"
                  onClick={() => setMode('isolated')}
                >
                  Isolated tables
                </button>
              </div>
              <button
                className="new-order-btn"
                data-testid="new-order-button"
                onClick={() => setOrderId(newOrderId())}
              >
                New order id
              </button>
            </div>
            <p className="hint-note">
              Powertools hashes the whole payment payload into the idempotency key — same orderId
              and amount is the same key (deduped); change the amount by a cent and it is a
              legitimately new payment.
            </p>
            <div className="controls" style={{ marginBottom: 0 }}>
              <button
                className="primary"
                data-testid="pay-button"
                onClick={() => primaryRegion && pay(primaryRegion.region)}
                disabled={payBusy !== null || !primaryRegion}
              >
                {payBusy === primaryRegion?.region
                  ? 'Paying…'
                  : `Pay via ${primaryRegion?.region || '…'}`}
              </button>
              <button
                data-testid="retry-button"
                onClick={() => secondaryRegion && pay(secondaryRegion.region)}
                disabled={payBusy !== null || !secondaryRegion}
              >
                {payBusy === secondaryRegion?.region
                  ? 'Retrying…'
                  : `Retry same order via ${secondaryRegion?.region || '…'}`}
              </button>
            </div>
            {actionError && <p className="error-note" data-testid="action-error">{actionError}</p>}

            <div className="stat-row">
              <div className="stat">
                <div className="value" data-testid="request-counter">{requestsForOrder}</div>
                <div className="label">pay requests for {currentOrderId || 'this order'}</div>
              </div>
              <div className="stat">
                <div
                  className={`value ${chargesForOrder > 1 ? 'bad' : chargesForOrder === 1 ? 'good' : ''}`}
                  data-testid="charge-counter"
                >
                  {chargesForOrder}
                </div>
                <div className="label">real charge rows across both regions</div>
              </div>
            </div>
          </div>

          {attempts.length > 0 && (
            <div className="panel">
              <h3>Requests</h3>
              <p className="panel-note">
                Newest first. A deduped retry carries the ORIGINAL chargeId — and its receipt still
                names the region that executed the charge.
              </p>
              <div data-testid="attempt-list">
                {attempts.map((a) => (
                  <div key={a.key} className="record-card idem-attempt" data-testid="outcome-card">
                    <div className="grid">
                      <div>
                        <strong>Request</strong> {a.orderId} · ${a.amount} via {a.askedRegion} ({a.mode})
                      </div>
                      <div>
                        <strong>Outcome</strong>{' '}
                        <span className={`outcome-badge outcome-${a.outcome}`} data-testid="outcome-badge">
                          {outcomeLabel[a.outcome]}
                        </span>
                      </div>
                      {a.receipt?.chargeId && (
                        <div>
                          <strong>Charge</strong>{' '}
                          <span className="hash-chip">{a.receipt.chargeId}</span>
                        </div>
                      )}
                      {a.receipt?.region && (
                        <div>
                          <strong>Executed by</strong> {a.receipt.region}
                        </div>
                      )}
                    </div>
                    {a.detail && <div className="values">{a.detail}</div>}
                    <div className="meta-note">{a.at}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="panel">
            <h3>Under the covers — idempotency records</h3>
            <p className="panel-note">
              Live scans of each region's tables. Powertools stores a HASHED key (module.function
              plus an md5 of the payload) — the raw id and the parsed stored receipt are shown side
              by side.
            </p>
            <div className="idem-records-grid">
              {regions.map((r) => (
                <div key={r.region} className="idem-records-col">
                  <h4>{r.region}</h4>
                  <table className="data" data-testid={`records-table-${r.region}`}>
                    <thead>
                      <tr>
                        <th>Store</th>
                        <th>Hashed id</th>
                        <th>Status</th>
                        <th>Expires</th>
                        <th>Order</th>
                        <th>Charge</th>
                      </tr>
                    </thead>
                    <tbody>
                      {asArray<IdemRecord>(r.shared).map((rec, i) => (
                        <tr key={`s-${rec.id || i}`}>
                          <td>shared</td>
                          <td><span className="hash-chip idem-id">{rec.id || 'N/A'}</span></td>
                          <td>{rec.status || 'N/A'}</td>
                          <td>{typeof rec.expiration === 'number' ? new Date(rec.expiration * 1000).toLocaleTimeString() : 'N/A'}</td>
                          <td>{rec.orderId || 'N/A'}</td>
                          <td>{rec.chargeId || 'N/A'}</td>
                        </tr>
                      ))}
                      {asArray<IdemRecord>(r.isolated).map((rec, i) => (
                        <tr key={`i-${rec.id || i}`}>
                          <td>isolated</td>
                          <td><span className="hash-chip idem-id">{rec.id || 'N/A'}</span></td>
                          <td>{rec.status || 'N/A'}</td>
                          <td>{typeof rec.expiration === 'number' ? new Date(rec.expiration * 1000).toLocaleTimeString() : 'N/A'}</td>
                          <td>{rec.orderId || 'N/A'}</td>
                          <td>{rec.chargeId || 'N/A'}</td>
                        </tr>
                      ))}
                      {asArray<IdemRecord>(r.shared).length + asArray<IdemRecord>(r.isolated).length === 0 && (
                        <tr>
                          <td colSpan={6} className="empty-note">No idempotency records yet</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
            <h4 style={{ marginTop: '1rem' }}>Shared-table replication</h4>
            {status.sharedRecords.length > 0 ? (
              <ul className="replication-list" data-testid="replication-list">
                {status.sharedRecords.map((s) => (
                  <li key={s.id}>
                    <span className="hash-chip idem-id">{s.id}</span>{' '}
                    {s.orderId && <span>{s.orderId}</span>}{' '}
                    {s.replicated ? (
                      <span className="replicated-badge on" data-testid="replicated-badge">
                        replicated to {s.inRegions.join(' + ')}
                      </span>
                    ) : (
                      <span className="replicated-badge pending">
                        replicating… (seen in {s.inRegions.join(', ') || 'no region yet'})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-note">No shared records yet — pay in shared mode to create one</div>
            )}
          </div>
        </>
      )}

      <div className="panel">
        <h3>Event timeline</h3>
        <p className="panel-note">
          Transitions observed by this browser between status polls, newest first.
        </p>
        {timeline.length > 0 ? (
          <ul className="timeline" data-testid="timeline">
            {timeline.map((entry, i) => (
              <li key={`${entry.at}-${i}`}>
                <span className="t">{entry.at}</span>
                <span>{entry.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-note" data-testid="timeline-empty">
            No events yet — send a payment to start.
          </div>
        )}
      </div>

      <div className="callout">
        <strong>Near-zero cost:</strong> unlike the failover and quorum demos there is nothing
        billed hourly here — two PAY_PER_REQUEST DynamoDB tables per region and a handful of
        on-demand reads and writes per click. Records expire on their own (one-hour idempotency
        window, TTL cleanup).
      </div>
      {statusError && status !== null && <p className="error-note">{statusError}</p>}
    </section>
  );
};

export default IdempotencyDemo;
