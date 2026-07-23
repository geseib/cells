import React, { useCallback, useEffect, useRef, useState } from 'react';

interface QuorumDemoProps {
  apiUrl: string;
}

interface Voter {
  i: number;
  on: boolean;
  broken: boolean;
  healthCheckId: string;
  status: string;
  healthyCount: number;
  checkersReporting: number;
}

interface ParentCheck {
  healthCheckId: string;
  threshold: number;
  healthyChildren: number;
  status: string;
  computedFrom: string;
}

interface StoredControl {
  on: boolean;
  version: number;
  since: string;
}

interface DecisionLogEntry {
  version: number;
  decision: 'on' | 'off';
  healthyChildren: number;
  threshold: number;
  at: string;
}

interface WireState {
  wired: boolean;
  failoverArmed: boolean;
  recordHealthCheckId: string | null;
  pointsAtParent: boolean;
}

interface QuorumCost {
  healthChecksPerHourUsd?: number;
  checkerTrafficPerHourUsd?: number;
  ratePerHourUsd?: number;
  armedMinutes?: number;
  accruedUsd?: number;
}

interface QuorumStatus {
  armed: boolean;
  threshold?: number;
  armedAt?: string;
  voters?: Voter[];
  parent?: ParentCheck;
  storedControl?: StoredControl;
  decisionLog?: DecisionLogEntry[];
  wire?: WireState;
  voteStatusUrl?: string;
  estimatedCost?: QuorumCost;
  whatArmingCreates?: {
    healthChecks?: string;
    checkerTraffic?: string;
    healthChecksPerHourUsd?: number;
    checkerTrafficPerHourUsd?: number;
    ratePerHourUsd?: number;
  };
}

interface TimelineEntry {
  at: string;
  text: string;
}

const TIMELINE_CAP = 50;
const VOTER_COUNT = 5;

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache'
};

const formatRate = (rate?: number) =>
  typeof rate === 'number' ? `$${rate.toFixed(4)}/hour` : '(rate unavailable)';

const decisionWord = (on: boolean) => (on ? 'Enabled' : 'Disabled');

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Transitions observed between two consecutive status polls. Defensive on
    purpose: a malformed payload must crash the RENDER (so the boundary shows
    a panel), never this diff. */
const diffStatus = (prev: QuorumStatus | null, next: QuorumStatus): string[] => {
  const out: string[] = [];
  if (!prev) {
    if (next.armed) {
      out.push(`Observed armed state: threshold ${next.threshold} of ${VOTER_COUNT} voters`);
    }
    return out;
  }
  if (!prev.armed && next.armed) {
    out.push(`Armed: ${VOTER_COUNT} voter checks + 1 CALCULATED parent (threshold ${next.threshold} of ${VOTER_COUNT})`);
  }
  if (prev.armed && !next.armed) {
    out.push('Disarmed — voter checks, calculated parent, vote items, and decision log removed');
  }
  if (prev.armed && next.armed) {
    const prevVoters = new Map(asArray<Voter>(prev.voters).map((v) => [v?.i, v]));
    for (const v of asArray<Voter>(next.voters)) {
      const p = prevVoters.get(v?.i);
      if (!p) continue;
      if (p.on !== v.on) {
        out.push(`Vote ${v.i} flipped ${v.on ? 'ON' : 'OFF'} (item ${v.on ? 'created' : 'deleted'})`);
      }
      if (p.broken !== v.broken) {
        out.push(v.broken
          ? `Voter ${v.i} marked broken — /vote-status/${v.i} now answers 500`
          : `Voter ${v.i} repaired`);
      }
      if (p.status !== v.status) {
        out.push(
          `Checker for voter ${v.i}: ${p.status} → ${v.status} ` +
          `(${v.healthyCount}/${v.checkersReporting} checkers healthy)`
        );
      }
    }
    if (prev.parent && next.parent && prev.parent.status !== next.parent.status) {
      out.push(
        `CALCULATED parent flipped ${prev.parent.status} → ${next.parent.status} ` +
        `(${next.parent.healthyChildren}/${VOTER_COUNT} healthy vs threshold ${next.parent.threshold})`
      );
    }
    if (
      prev.storedControl && next.storedControl &&
      prev.storedControl.version !== next.storedControl.version
    ) {
      out.push(
        `Committed v${next.storedControl.version}: Routing = ${decisionWord(next.storedControl.on)}`
      );
    }
    if (prev.wire && next.wire && prev.wire.wired !== next.wire.wired) {
      out.push(next.wire.wired
        ? 'PRIMARY failover record wired to the quorum parent'
        : 'PRIMARY failover record restored to its original health check');
    }
  }
  return out;
};

const QuorumDemo: React.FC<QuorumDemoProps> = ({ apiUrl }) => {
  const [status, setStatus] = useState<QuorumStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [thresholdSel, setThresholdSel] = useState('3');
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [armBusy, setArmBusy] = useState(false);
  const [disarmBusy, setDisarmBusy] = useState(false);
  const [voterBusy, setVoterBusy] = useState<number | null>(null);
  const [wireBusy, setWireBusy] = useState(false);

  const statusRef = useRef<QuorumStatus | null>(null);
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
      const response = await fetch(`${apiUrl}/admin/quorum/status`, { headers: NO_CACHE_HEADERS });
      if (!response.ok) {
        if (mountedRef.current) setStatusError(`Status request failed (HTTP ${response.status})`);
        return;
      }
      const next: QuorumStatus = await response.json();
      if (!mountedRef.current) return;
      logEvents(diffStatus(statusRef.current, next));
      statusRef.current = next;
      setStatus(next);
      setStatusError(null);
    } catch (err) {
      if (mountedRef.current) setStatusError('Could not reach /admin/quorum/status');
      console.error('Quorum status error:', err);
    }
  }, [apiUrl, logEvents]);

  // Poll status: 5s while armed (checker observations move every ~10s),
  // 15s while unarmed (the status route is deliberately cheap at rest).
  useEffect(() => {
    if (!apiUrl) return undefined;
    refreshStatus();
    const ms = status?.armed ? 5000 : 15000;
    const interval = setInterval(refreshStatus, ms);
    return () => clearInterval(interval);
  }, [apiUrl, status?.armed, refreshStatus]);

  const post = async (path: string, body?: Record<string, unknown>) => {
    const response = await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || data.message || `Request failed (HTTP ${response.status})`);
    }
    return data;
  };

  const arm = async () => {
    const threshold = Number(thresholdSel);
    setArmBusy(true);
    setActionError(null);
    logEvents([`Arm requested: threshold ${threshold} of ${VOTER_COUNT}`]);
    try {
      await post('/admin/quorum/arm', { threshold });
      await refreshStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Arm request failed';
      setActionError(msg);
      logEvents([`Arm rejected: ${msg}`]);
    } finally {
      if (mountedRef.current) setArmBusy(false);
    }
  };

  const disarm = async () => {
    setDisarmBusy(true);
    setActionError(null);
    logEvents(['Disarm requested']);
    try {
      await post('/admin/quorum/disarm');
      await refreshStatus();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Disarm request failed');
    } finally {
      if (mountedRef.current) setDisarmBusy(false);
    }
  };

  const flipVote = async (voter: Voter) => {
    setVoterBusy(voter.i);
    setActionError(null);
    logEvents([`Vote ${voter.i} ${voter.on ? 'OFF' : 'ON'} requested`]);
    try {
      await post('/admin/quorum/vote', { i: voter.i, on: !voter.on });
      await refreshStatus();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Vote toggle failed');
    } finally {
      if (mountedRef.current) setVoterBusy(null);
    }
  };

  const flipBroken = async (voter: Voter) => {
    setVoterBusy(voter.i);
    setActionError(null);
    logEvents([
      voter.broken
        ? `Repair of voter ${voter.i} requested`
        : `Break of voter ${voter.i} requested — its /vote-status will answer 500`
    ]);
    try {
      await post('/admin/quorum/break-voter', { i: voter.i, broken: !voter.broken });
      await refreshStatus();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Break toggle failed');
    } finally {
      if (mountedRef.current) setVoterBusy(null);
    }
  };

  const toggleWire = async (wired: boolean) => {
    setWireBusy(true);
    setActionError(null);
    logEvents([wired ? 'Unwire requested' : 'Wire-to-DNS requested']);
    try {
      await post('/admin/quorum/wire', { on: !wired });
      await refreshStatus();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Wire toggle failed');
    } finally {
      if (mountedRef.current) setWireBusy(false);
    }
  };

  const cost = status?.estimatedCost;
  const creates = status?.whatArmingCreates;

  const renderVoterCard = (voter: Voter) => (
    <div
      key={voter.i}
      className={`voter-card voter-slot-${voter.i} ${voter.broken ? 'broken' : voter.on ? 'on' : 'off'}`}
      data-testid={`voter-card-${voter.i}`}
    >
      <div className="voter-head">
        <span className="voter-name">Voter {voter.i}</span>
        <span className={`status-pill ${voter.status === 'healthy' ? 'active' : 'inactive'}`}>
          {voter.status}
        </span>
      </div>
      <div className="voter-controls">
        <button
          className={voter.on ? 'primary' : ''}
          data-testid={`voter-switch-${voter.i}`}
          aria-pressed={voter.on}
          onClick={() => flipVote(voter)}
          disabled={voterBusy === voter.i}
        >
          {voter.on ? 'Vote ON' : 'Vote OFF'}
        </button>
        <button
          className={voter.broken ? 'danger' : ''}
          data-testid={`voter-broken-${voter.i}`}
          aria-pressed={voter.broken}
          onClick={() => flipBroken(voter)}
          disabled={voterBusy === voter.i}
        >
          {voter.broken ? 'Broken (500)' : 'Break'}
        </button>
      </div>
      <div className="voter-checker">
        {voter.healthyCount}/{voter.checkersReporting} checkers healthy
      </div>
      <div className="voter-checkid">{voter.healthCheckId}</div>
    </div>
  );

  return (
    <section className="section" data-testid="quorum-root">
      <div className="kicker">Quorum</div>
      <h2>Quorum by calculated health check — live</h2>
      <p className="lede">
        Five Route 53 health checks each observe one <strong>vote flag</strong> (an item in
        DynamoDB, served by a public /vote-status route), and a <strong>CALCULATED</strong> parent
        check with a health threshold over those five children IS the consensus evaluator. The
        committed decision is a <strong>versioned log</strong>, not a retried command — the same
        idea Amazon Route 53 ARC is built on.
      </p>

      {status === null ? (
        <div className="panel">
          <div className="empty-note">{statusError || 'Loading quorum status…'}</div>
        </div>
      ) : !status.armed ? (
        <>
          <div className="panel" data-testid="quorum-unarmed-panel">
            <h3>What arming creates</h3>
            <ul className="arm-explainer">
              <li>
                <strong>5 HTTPS health checks</strong> —{' '}
                {creates?.healthChecks ||
                  '5 checkers against /vote-status/{i} (10s interval) + 1 CALCULATED parent'}
              </li>
              <li>
                <strong>Checker traffic is the bigger cost:</strong>{' '}
                {creates?.checkerTraffic || '~27,000 checker requests/hour against the routing API while armed'}
              </li>
              <li>
                <strong>Billed hourly while armed, two components:</strong> health checks{' '}
                {formatRate(creates?.healthChecksPerHourUsd)} + checker traffic{' '}
                {formatRate(creates?.checkerTrafficPerHourUsd)} ≈{' '}
                <strong>{formatRate(creates?.ratePerHourUsd)}</strong> total. Disarm when you are
                done — it deletes everything it created.
              </li>
            </ul>
          </div>
          <div className="panel">
            <div className="controls" style={{ marginBottom: 0 }}>
              <label className="select-label">
                Threshold
                <select
                  data-testid="threshold-select"
                  value={thresholdSel}
                  onChange={(e) => setThresholdSel(e.target.value)}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={String(n)}>
                      {n} of {VOTER_COUNT}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary" data-testid="arm-button" onClick={arm} disabled={armBusy}>
                {armBusy ? 'Arming…' : 'Arm quorum'}
              </button>
              <button
                className="danger"
                data-testid="disarm-button"
                onClick={disarm}
                disabled={disarmBusy}
              >
                {disarmBusy ? 'Disarming…' : 'Disarm (idempotent sweep)'}
              </button>
            </div>
            {actionError && <p className="error-note" data-testid="action-error">{actionError}</p>}
          </div>
        </>
      ) : (
        <>
          <div className="panel" data-testid="quorum-armed-panel">
            <div className="failover-stage">
              <div className="connection-status primary">
                <div className="who">
                  Quorum armed: threshold{' '}
                  <span className="failover-pill primary">{status.threshold} of {VOTER_COUNT}</span>
                </div>
                <div className="meta">
                  Armed {status.armedAt ? new Date(status.armedAt).toLocaleString() : ''}
                </div>
                <div className="cost-line" data-testid="cost-line">
                  Accruing {formatRate(cost?.ratePerHourUsd)} (checks{' '}
                  {formatRate(cost?.healthChecksPerHourUsd)} + checker traffic{' '}
                  {formatRate(cost?.checkerTrafficPerHourUsd)})
                  {typeof cost?.accruedUsd === 'number' && <> · ≈ ${cost.accruedUsd.toFixed(4)} so far</>}
                  {' '}— disarm when done.
                </div>
              </div>
              <div className="controls" style={{ marginBottom: 0 }}>
                <button
                  className="danger"
                  data-testid="disarm-button"
                  onClick={disarm}
                  disabled={disarmBusy}
                >
                  {disarmBusy ? 'Disarming…' : 'Disarm'}
                </button>
              </div>
              {actionError && <p className="error-note" data-testid="action-error">{actionError}</p>}
            </div>
          </div>

          <div className="panel">
            <h3>Voters around the calculated parent</h3>
            <p className="panel-note">
              Each vote is a real DynamoDB item; each switch flips it and the checkers around the
              world observe /vote-status answering 200 or 503. Break simulates a faulty voter
              (500 regardless of its vote).
            </p>
            <div className="quorum-ring">
              {(status.voters || []).map(renderVoterCard)}
              <div
                className={`parent-lamp-slot lamp-block ${status.parent?.status === 'healthy' ? 'on' : 'off'}`}
                data-testid="parent-lamp"
              >
                <div className="lamp" aria-hidden="true" />
                <div className="lamp-label">CALCULATED parent</div>
                <div className="lamp-state">{status.parent?.status || 'unknown'}</div>
                <div className="voter-checkid">{status.parent?.healthCheckId}</div>
              </div>
            </div>

            <div className="quorum-meter" data-testid="quorum-meter">
              <div className="meter-track">
                {Array.from({ length: VOTER_COUNT }, (_, idx) => (
                  <div
                    key={idx}
                    className={`meter-seg ${idx < (status.parent?.healthyChildren ?? 0) ? 'filled' : ''}`}
                  />
                ))}
                <div
                  className="meter-threshold"
                  style={{ left: `${((status.threshold ?? 3) / VOTER_COUNT) * 100}%` }}
                  aria-hidden="true"
                />
              </div>
              <div className="meter-caption">
                {status.parent?.healthyChildren ?? 0}/{VOTER_COUNT} children healthy · threshold{' '}
                {status.threshold} — parent is {status.parent?.status || 'unknown'}
              </div>
            </div>
          </div>

          <div className="panel">
            <h3>Live vs stored — the ARC lesson</h3>
            <div className="lamp-pair">
              <div
                className={`lamp-block ${status.parent?.status === 'healthy' ? 'on' : 'off'}`}
                data-testid="live-lamp"
              >
                <div className="lamp" aria-hidden="true" />
                <div className="lamp-label">LIVE (computed)</div>
                <div className="lamp-state">{status.parent?.status || 'unknown'}</div>
                <div className="lamp-note">{status.parent?.computedFrom}</div>
              </div>
              <div
                className={`lamp-block ${status.storedControl?.on ? 'on' : 'off'}`}
                data-testid="stored-lamp"
              >
                <div className="lamp" aria-hidden="true" />
                <div className="lamp-label">STORED control</div>
                <div className="lamp-state">
                  v{status.storedControl?.version} · {decisionWord(!!status.storedControl?.on)} · since{' '}
                  {status.storedControl?.since
                    ? new Date(status.storedControl.since).toLocaleTimeString()
                    : 'N/A'}
                </div>
              </div>
            </div>
            <p className="hint-note" data-testid="arc-lesson">
              The live lamp recomputes on every look; the stored lamp holds the last committed
              decision until a genuine transition commits a new version — that is static stability.
            </p>
          </div>

          <div className="panel">
            <h3>Decision log — versions, not retries</h3>
            <p className="panel-note">
              Every committed decision appends a new version — an ordered notebook of history, the
              same framing as the Operations page. Nothing is ever rewritten or retried.
            </p>
            {(status.decisionLog || []).length > 0 ? (
              <ol className="notebook" data-testid="decision-log">
                {(status.decisionLog || []).map((entry) => (
                  <li key={entry.version} className={`notebook-row ${entry.decision === 'on' ? 'on' : 'off'}`}>
                    <span className="notebook-version">v{entry.version}</span>
                    <span className="notebook-decision">
                      Routing = {decisionWord(entry.decision === 'on')}
                    </span>
                    <span className="notebook-meta">
                      {entry.healthyChildren}/{VOTER_COUNT} healthy · threshold {entry.threshold} ·{' '}
                      {new Date(entry.at).toLocaleTimeString()}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="empty-note">No committed decisions yet</div>
            )}
          </div>

          <div className="panel">
            <h3>Wire to DNS (optional)</h3>
            {status.wire?.failoverArmed ? (
              <>
                <p className="panel-note">
                  Points the PRIMARY failover record's HealthCheckId at the quorum parent, so the
                  committed quorum decision drives real DNS failover.
                </p>
                <div className="controls" style={{ marginBottom: 0 }}>
                  <button
                    className={status.wire.wired ? 'danger' : 'primary'}
                    data-testid="wire-toggle"
                    onClick={() => toggleWire(!!status.wire?.wired)}
                    disabled={wireBusy}
                  >
                    {wireBusy
                      ? 'Working…'
                      : status.wire.wired
                        ? 'Unwire (restore original health check)'
                        : 'Wire PRIMARY record to the quorum parent'}
                  </button>
                </div>
                <p className="hint-note" data-testid="wire-truth">
                  PRIMARY record health check (read from the record itself):{' '}
                  <span className="hash-chip">{status.wire.recordHealthCheckId || 'none'}</span>{' '}
                  {status.wire.pointsAtParent
                    ? '— currently points at the quorum parent'
                    : '— does not point at the quorum parent'}
                </p>
              </>
            ) : (
              <p className="hint-note" style={{ margin: 0 }} data-testid="wire-unavailable">
                Wiring needs the failover demo armed first — it swaps the PRIMARY
                failover record's health check for the quorum parent.
              </p>
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
            No events yet — arm the quorum to start.
          </div>
        )}
      </div>

      <div className="callout">
        <strong>Real resources while armed:</strong> the five voter checks, the calculated parent,
        and the checker traffic against your routing API all bill hourly — always disarm after the
        demo (disarm restores any wired record, deletes the parent first, then the children, then
        sweeps by tag prefix).
      </div>
      {statusError && status !== null && <p className="error-note">{statusError}</p>}
    </section>
  );
};

export default QuorumDemo;
