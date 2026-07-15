import React, { useCallback, useEffect, useRef, useState } from 'react';

interface FailoverDemoProps {
  apiUrl: string;
}

interface CellOption {
  cellId: string;
  region: string;
  availabilityZone: string;
  apiUrl: string;
}

interface HealthCheckSummary {
  cellId: string;
  healthCheckId: string;
  checkersReporting: number;
  healthyCount: number;
  status: string;
}

interface Route53Record {
  name: string;
  type: string;
  ttl?: number;
  setIdentifier?: string;
  failover?: string;
  healthCheckId?: string;
  values: string[];
}

interface ChaosState {
  enabled: boolean;
  expiresAt?: number | string;
}

interface CellHealthSummary {
  cellId: string;
  statusCode: number;
  chaos: ChaosState | null;
}

interface DnsAnswer {
  value: string;
  matchesCellId: string | null;
  resolvedAt: string;
}

interface EstimatedCost {
  ratePerHourUsd: number;
  armedMinutes?: number;
  accruedUsd?: number;
}

interface FailoverStatus {
  armed: boolean;
  failoverFqdn?: string;
  estimatedCost?: EstimatedCost;
  primaryCellId?: string;
  secondaryCellId?: string;
  armedAt?: string;
  healthChecks?: HealthCheckSummary[];
  records?: Route53Record[];
  cellHealth?: CellHealthSummary[];
  dnsAnswer?: DnsAnswer | null;
}

interface ProbeResult {
  armed?: boolean;
  fqdn?: string;
  cnameTarget?: string;
  winningCellId?: string;
  cellInfo?: { cellId?: string; region?: string } | null;
  note?: string;
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

const stripDot = (v: string) => v.replace(/\.$/, '');

const formatRate = (rate?: number) =>
  typeof rate === 'number' ? `$${rate.toFixed(4)}/hour` : '(rate unavailable)';

/** Transitions observed between two consecutive status polls. */
const diffStatus = (prev: FailoverStatus | null, next: FailoverStatus): string[] => {
  const out: string[] = [];
  if (!prev) {
    if (next.armed) {
      out.push(`Observed armed state: ${next.primaryCellId} primary, ${next.secondaryCellId} secondary`);
    }
    return out;
  }
  if (!prev.armed && next.armed) {
    out.push(`Armed: ${next.primaryCellId} primary, ${next.secondaryCellId} secondary`);
  }
  if (prev.armed && !next.armed) {
    out.push('Disarmed — failover records and health checks removed');
  }
  if (next.armed && prev.armed) {
    const prevChecks = new Map((prev.healthChecks || []).map((h) => [h.cellId, h]));
    for (const h of next.healthChecks || []) {
      const p = prevChecks.get(h.cellId);
      if (p && p.status !== h.status) {
        out.push(
          `Health check for ${h.cellId}: ${p.status} → ${h.status} ` +
          `(${h.healthyCount}/${h.checkersReporting} checkers healthy)`
        );
      }
    }
    const prevHealth = new Map((prev.cellHealth || []).map((c) => [c.cellId, c]));
    for (const c of next.cellHealth || []) {
      const p = prevHealth.get(c.cellId);
      if (!p) continue;
      if (p.statusCode !== c.statusCode) {
        out.push(
          c.statusCode === 200
            ? `${c.cellId} /health recovered (200)`
            : `${c.cellId} /health now returns ${c.statusCode}`
        );
      }
      const prevChaos = !!(p.chaos && p.chaos.enabled);
      const nextChaos = !!(c.chaos && c.chaos.enabled);
      if (prevChaos !== nextChaos) {
        out.push(nextChaos ? `Chaos enabled on ${c.cellId}` : `Chaos cleared on ${c.cellId}`);
      }
    }
    const prevAnswer = prev.dnsAnswer && prev.dnsAnswer.matchesCellId;
    const nextAnswer = next.dnsAnswer && next.dnsAnswer.matchesCellId;
    if (prevAnswer && nextAnswer && prevAnswer !== nextAnswer) {
      out.push(`DNS answer flipped to ${nextAnswer} (${next.dnsAnswer!.value})`);
    }
  }
  return out;
};

const FailoverDemo: React.FC<FailoverDemoProps> = ({ apiUrl }) => {
  const [status, setStatus] = useState<FailoverStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [cells, setCells] = useState<CellOption[]>([]);
  const [primarySel, setPrimarySel] = useState('');
  const [secondarySel, setSecondarySel] = useState('');
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [armBusy, setArmBusy] = useState(false);
  const [disarmBusy, setDisarmBusy] = useState(false);
  const [chaosBusy, setChaosBusy] = useState(false);
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [dohBusy, setDohBusy] = useState(false);
  const [dohResult, setDohResult] = useState<{ resolver: string; value: string } | null>(null);
  const [dohError, setDohError] = useState<string | null>(null);

  const statusRef = useRef<FailoverStatus | null>(null);
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
      const response = await fetch(`${apiUrl}/admin/failover/status`, { headers: NO_CACHE_HEADERS });
      if (!response.ok) {
        if (mountedRef.current) setStatusError(`Status request failed (HTTP ${response.status})`);
        return;
      }
      const next: FailoverStatus = await response.json();
      if (!mountedRef.current) return;
      logEvents(diffStatus(statusRef.current, next));
      statusRef.current = next;
      setStatus(next);
      setStatusError(null);
    } catch (err) {
      if (mountedRef.current) setStatusError('Could not reach /admin/failover/status');
      console.error('Failover status error:', err);
    }
  }, [apiUrl, logEvents]);

  const fetchCells = useCallback(async () => {
    if (!apiUrl) return;
    try {
      const response = await fetch(`${apiUrl}/admin/cell-urls`, { headers: NO_CACHE_HEADERS });
      const data = await response.json();
      if (!mountedRef.current) return;
      const rows: CellOption[] = (data.cellUrls || [])
        .filter((c: any) => c.active)
        .map((c: any) => ({
          cellId: c.cellId,
          region: c.region,
          availabilityZone: c.availabilityZone,
          apiUrl: c.apiUrl || ''
        }));
      setCells(rows);
    } catch (err) {
      console.error('Failed to load cells:', err);
    }
  }, [apiUrl]);

  // Poll status: 5s while armed, 15s while unarmed. Cell list refreshes on the
  // unarmed cadence so a cell's apiUrl appears as soon as its heartbeat lands.
  useEffect(() => {
    if (!apiUrl) return undefined;
    refreshStatus();
    fetchCells();
    const ms = status?.armed ? 5000 : 15000;
    const interval = setInterval(() => {
      refreshStatus();
      if (!statusRef.current || !statusRef.current.armed) fetchCells();
    }, ms);
    return () => clearInterval(interval);
  }, [apiUrl, status?.armed, refreshStatus, fetchCells]);

  // Default the pair pickers to the first two armable cells.
  useEffect(() => {
    const armable = cells.filter((c) => c.apiUrl);
    if (!primarySel && armable[0]) setPrimarySel(armable[0].cellId);
    if (!secondarySel && armable[1]) setSecondarySel(armable[1].cellId);
  }, [cells, primarySel, secondarySel]);

  const arm = async () => {
    if (!primarySel || !secondarySel || primarySel === secondarySel) {
      setActionError('Pick two different cells for the primary/secondary pair.');
      return;
    }
    setArmBusy(true);
    setActionError(null);
    logEvents([`Arm requested: ${primarySel} primary, ${secondarySel} secondary`]);
    try {
      const response = await fetch(`${apiUrl}/admin/failover/arm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryCellId: primarySel, secondaryCellId: secondarySel })
      });
      const data = await response.json().catch(() => ({} as any));
      if (!response.ok) {
        const msg = [data.error || data.message || `Arm failed (HTTP ${response.status})`, data.hint]
          .filter(Boolean)
          .join(' — ');
        setActionError(msg);
        logEvents([`Arm rejected: ${msg}`]);
      } else {
        await refreshStatus();
      }
    } catch (err) {
      setActionError('Arm request failed');
      console.error('Arm error:', err);
    } finally {
      if (mountedRef.current) setArmBusy(false);
    }
  };

  const disarm = async () => {
    setDisarmBusy(true);
    setActionError(null);
    logEvents(['Disarm requested']);
    try {
      const response = await fetch(`${apiUrl}/admin/failover/disarm`, { method: 'POST' });
      if (!response.ok) {
        setActionError(`Disarm failed (HTTP ${response.status})`);
      } else {
        setProbeResult(null);
        setDohResult(null);
        setDohError(null);
        await refreshStatus();
      }
    } catch (err) {
      setActionError('Disarm request failed');
      console.error('Disarm error:', err);
    } finally {
      if (mountedRef.current) setDisarmBusy(false);
    }
  };

  const primaryHealth = status?.armed
    ? (status.cellHealth || []).find((c) => c.cellId === status.primaryCellId)
    : undefined;
  const primaryChaosOn = !!(primaryHealth && primaryHealth.chaos && primaryHealth.chaos.enabled);

  const toggleChaos = async () => {
    if (!status?.armed || !status.primaryCellId) return;
    const enabled = !primaryChaosOn;
    setChaosBusy(true);
    setActionError(null);
    logEvents([
      enabled
        ? `Chaos requested on ${status.primaryCellId} — its /health will start returning 503`
        : `Heal requested on ${status.primaryCellId}`
    ]);
    try {
      const response = await fetch(`${apiUrl}/admin/failover/chaos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cellId: status.primaryCellId, enabled })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({} as any));
        setActionError(data.error || data.message || `Chaos toggle failed (HTTP ${response.status})`);
      } else {
        await refreshStatus();
      }
    } catch (err) {
      setActionError('Chaos toggle failed');
      console.error('Chaos error:', err);
    } finally {
      if (mountedRef.current) setChaosBusy(false);
    }
  };

  const runProbe = async () => {
    setProbeBusy(true);
    setProbeError(null);
    try {
      const response = await fetch(`${apiUrl}/admin/failover/probe`, { headers: NO_CACHE_HEADERS });
      const data: ProbeResult = await response.json();
      if (!mountedRef.current) return;
      setProbeResult(data);
      if (data.winningCellId) {
        logEvents([`Probe confirmed ${data.winningCellId} via ${data.cnameTarget || 'CNAME target'}`]);
      }
    } catch (err) {
      if (mountedRef.current) setProbeError('Probe request failed');
      console.error('Probe error:', err);
    } finally {
      if (mountedRef.current) setProbeBusy(false);
    }
  };

  // Optional browser-side verification via public DNS-over-HTTPS resolvers.
  // The server-reported answer above is authoritative; this only shows the
  // same flip from the viewer's own network, and it degrades gracefully when
  // a corporate proxy blocks the resolvers.
  const verifyDoh = async () => {
    const fqdn = status?.failoverFqdn;
    if (!fqdn) return;
    setDohBusy(true);
    setDohResult(null);
    setDohError(null);
    const resolvers: Array<{ name: string; url: string; headers?: Record<string, string> }> = [
      { name: 'dns.google', url: `https://dns.google/resolve?name=${encodeURIComponent(fqdn)}&type=CNAME` },
      {
        name: 'cloudflare-dns.com',
        url: `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(fqdn)}&type=CNAME`,
        headers: { accept: 'application/dns-json' }
      }
    ];
    for (const resolver of resolvers) {
      try {
        const response = await fetch(resolver.url, { headers: resolver.headers });
        if (!response.ok) continue;
        const data = await response.json();
        const answers: any[] = data.Answer || [];
        const answer = answers.find((a) => a.type === 5) || answers[0];
        if (answer && answer.data) {
          if (mountedRef.current) {
            const value = stripDot(String(answer.data));
            setDohResult({ resolver: resolver.name, value });
            logEvents([`Browser DoH (${resolver.name}) answered ${value}`]);
            setDohBusy(false);
          }
          return;
        }
      } catch (err) {
        // fall through to the next resolver
      }
    }
    if (mountedRef.current) {
      setDohError(
        'Neither dns.google nor cloudflare-dns.com is reachable from this browser — corporate ' +
        'proxies commonly block DNS-over-HTTPS resolvers. This check is optional; the ' +
        'server-reported answer above is authoritative.'
      );
      setDohBusy(false);
    }
  };

  const rate = status?.estimatedCost?.ratePerHourUsd;
  const accruedUsd = (() => {
    if (!status?.armed) return null;
    if (status.armedAt && typeof rate === 'number') {
      const hours = Math.max(0, Date.now() - Date.parse(status.armedAt)) / 3600000;
      return hours * rate;
    }
    return status.estimatedCost?.accruedUsd ?? null;
  })();

  const roleOf = (cellId?: string | null): 'primary' | 'secondary' | null => {
    if (!cellId || !status?.armed) return null;
    if (cellId === status.primaryCellId) return 'primary';
    if (cellId === status.secondaryCellId) return 'secondary';
    return null;
  };

  // Map a raw CNAME answer (from DoH) back to a cell via the live record sets.
  const cellForAnswer = (value: string): string | null => {
    for (const record of status?.records || []) {
      if ((record.values || []).some((v) => stripDot(v) === stripDot(value))) {
        const role = record.failover === 'PRIMARY' ? status?.primaryCellId : status?.secondaryCellId;
        return role || null;
      }
    }
    return null;
  };

  const orderedHealth = status?.armed
    ? [...(status.cellHealth || [])].sort((a) => (a.cellId === status.primaryCellId ? -1 : 1))
    : [];
  const orderedChecks = status?.armed
    ? [...(status.healthChecks || [])].sort((a) => (a.cellId === status.primaryCellId ? -1 : 1))
    : [];

  const armableCells = cells.filter((c) => c.apiUrl);
  const pendingCells = cells.filter((c) => !c.apiUrl);
  const dnsAnswer = status?.armed ? status.dnsAnswer : null;
  const dnsRole = roleOf(dnsAnswer?.matchesCellId);

  return (
    <section className="section" data-testid="failover-root">
      <div className="kicker">Failover</div>
      <h2>Route 53 failover — live</h2>
      <p className="lede">
        Arming creates <strong>real</strong> Route 53 health checks and failover CNAME records in
        your hosted zone. Break the primary cell's /health on demand and watch the checkers notice,
        the DNS answer flip to the secondary, and recovery flip it back.
      </p>

      {status === null ? (
        <div className="panel">
          <div className="empty-note">
            {statusError || 'Loading failover status…'}
          </div>
        </div>
      ) : !status.armed ? (
        <>
          <div className="panel" data-testid="unarmed-panel">
            <h3>What arming creates</h3>
            <ul className="arm-explainer">
              <li>
                <strong>2 Route 53 health checks</strong> against each cell's own /health — fast
                pacing: checks every ~10 seconds, 2 consecutive failures to flip.
              </li>
              <li>
                <strong>2 failover CNAME records</strong> at{' '}
                <span className="hash-chip">{status.failoverFqdn || 'failover.{domain}'}</span>{' '}
                (TTL 15s) — PRIMARY and SECONDARY, each tied to its health check.
              </li>
              <li>
                <strong>Billed hourly while armed:</strong> about {formatRate(rate)} for the pair
                (health checks with HTTPS + fast interval are paid features). Disarm when you are
                done — it deletes everything it created.
              </li>
            </ul>
          </div>

          <div className="panel">
            <div className="failover-stage">
              <div className="controls" style={{ marginBottom: 0 }}>
                <label className="select-label">
                  Primary
                  <select
                    data-testid="primary-select"
                    value={primarySel}
                    onChange={(e) => setPrimarySel(e.target.value)}
                  >
                    <option value="">Select a cell</option>
                    {cells.map((c) => (
                      <option key={c.cellId} value={c.cellId} disabled={!c.apiUrl}>
                        {c.cellId}{c.apiUrl ? '' : ' (no API URL yet)'}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="select-label">
                  Secondary
                  <select
                    data-testid="secondary-select"
                    value={secondarySel}
                    onChange={(e) => setSecondarySel(e.target.value)}
                  >
                    <option value="">Select a cell</option>
                    {cells.map((c) => (
                      <option key={c.cellId} value={c.cellId} disabled={!c.apiUrl}>
                        {c.cellId}{c.apiUrl ? '' : ' (no API URL yet)'}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="primary"
                  data-testid="arm-button"
                  onClick={arm}
                  disabled={armBusy || armableCells.length < 2}
                >
                  {armBusy ? 'Arming…' : 'Arm failover'}
                </button>
              </div>
              {pendingCells.length > 0 && (
                <p className="hint-note" data-testid="apiurl-hint">
                  {pendingCells.map((c) => c.cellId).join(', ')}{' '}
                  {pendingCells.length === 1 ? 'has' : 'have'} no API URL yet — the registration
                  heartbeat publishes it within 5 minutes; wait for the next heartbeat.
                </p>
              )}
              {armableCells.length < 2 && (
                <p className="hint-note">
                  Arming needs two active cells with a registered API URL.
                </p>
              )}
              {actionError && <p className="error-note" data-testid="action-error">{actionError}</p>}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="panel" data-testid="armed-panel">
            <div className="failover-stage">
              <div className="connection-status primary">
                <div className="who">
                  Failover armed:{' '}
                  <span className="failover-pill primary">{status.primaryCellId}</span>
                  {' → '}
                  <span className="failover-pill secondary">{status.secondaryCellId}</span>
                </div>
                <div className="meta">
                  Armed {status.armedAt ? new Date(status.armedAt).toLocaleString() : ''}
                </div>
                <div className="cost-line" data-testid="cost-line">
                  Accruing {formatRate(rate)}
                  {accruedUsd !== null && <> · ≈ ${accruedUsd.toFixed(4)} so far</>}
                  {' '}— disarm when done.
                </div>
              </div>

              <div className="controls" style={{ marginBottom: 0 }}>
                <button
                  className={primaryChaosOn ? 'primary' : 'danger'}
                  data-testid="chaos-toggle"
                  onClick={toggleChaos}
                  disabled={chaosBusy}
                >
                  {chaosBusy
                    ? 'Working…'
                    : primaryChaosOn
                      ? `Heal ${status.primaryCellId}'s /health`
                      : `Break ${status.primaryCellId}'s /health`}
                </button>
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
            <h3>Cell health (fetched server-side each poll)</h3>
            <div className="controls" style={{ marginBottom: 0 }}>
              {orderedHealth.map((c) => (
                <span
                  key={c.cellId}
                  className={`health-chip ${c.statusCode === 200 ? 'good' : 'bad'}`}
                  data-testid={`health-chip-${c.cellId}`}
                >
                  {c.cellId} · /health {c.statusCode}
                  {c.chaos && c.chaos.enabled && <span className="chaos-badge">chaos</span>}
                </span>
              ))}
            </div>
          </div>

          <div className="panel">
            <h3>Route 53 health checks</h3>
            <p className="panel-note">
              Independent checkers around the world hit each cell's /health every ~10 seconds; two
              consecutive failures flip the check.
            </p>
            <div className="checker-grid">
              {orderedChecks.map((h) => (
                <div key={h.cellId} className="record-card" data-testid={`checker-card-${h.cellId}`}>
                  <div className="grid">
                    <div>
                      <strong>Cell</strong>{' '}
                      <span className={`failover-pill ${roleOf(h.cellId) || 'primary'}`}>
                        {h.cellId}
                      </span>
                    </div>
                    <div>
                      <strong>Checkers healthy</strong>{' '}
                      {h.healthyCount}/{h.checkersReporting}
                    </div>
                    <div>
                      <strong>Status</strong>{' '}
                      <span className={`status-pill ${h.status === 'healthy' ? 'active' : 'inactive'}`}>
                        {h.status}
                      </span>
                    </div>
                  </div>
                  <div className="values">{h.healthCheckId}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <h3>Route 53 record sets</h3>
            <p className="panel-note">
              Read live from your hosted zone — the two failover CNAMEs arming created.
            </p>
            {(status.records || []).length > 0 ? (
              <div data-testid="record-cards">
                {(status.records || []).map((record, index) => (
                  <div key={index} className="record-card">
                    <div className="grid">
                      <div><strong>Name</strong> {record.name}</div>
                      <div><strong>Type</strong> {record.type}</div>
                      <div><strong>TTL</strong> {record.ttl ?? 'N/A'}</div>
                      <div><strong>Set ID</strong> {record.setIdentifier || 'N/A'}</div>
                      <div>
                        <strong>Failover</strong>{' '}
                        <span className={`failover-pill ${record.failover === 'PRIMARY' ? 'primary' : 'secondary'}`}>
                          {record.failover || 'N/A'}
                        </span>
                      </div>
                      <div><strong>Health check</strong> {record.healthCheckId || 'N/A'}</div>
                    </div>
                    <div className="values">
                      {record.values.map((value, i) => (
                        <div key={i}>{value}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-note">No failover records reported yet</div>
            )}
          </div>

          <div className="panel dns-panel" style={{ maxWidth: 'none' }}>
            <h3>DNS answer</h3>
            <p className="panel-note">
              Resolved server-side against the authoritative Route 53 resolver on every poll.
            </p>
            {dnsAnswer ? (
              <p style={{ margin: '0 0 0.75rem' }} data-testid="dns-answer">
                <span className="hash-chip">{status.failoverFqdn}</span>
                {' → '}
                <span className="hash-chip">{dnsAnswer.value}</span>{' '}
                {dnsRole && (
                  <span className={`failover-pill ${dnsRole}`} data-testid="dns-pill">
                    {dnsRole === 'primary' ? 'Primary' : 'Secondary'}
                  </span>
                )}{' '}
                <span className="meta-note">
                  resolved {new Date(dnsAnswer.resolvedAt).toLocaleTimeString()}
                </span>
              </p>
            ) : (
              <p className="empty-note" data-testid="dns-answer">No DNS answer reported yet</p>
            )}
            <div className="controls" style={{ marginBottom: 0 }}>
              <button data-testid="doh-verify" onClick={verifyDoh} disabled={dohBusy}>
                {dohBusy ? 'Resolving…' : 'Verify from this browser (DoH, optional)'}
              </button>
              <button data-testid="probe-button" onClick={runProbe} disabled={probeBusy}>
                {probeBusy ? 'Probing…' : 'Probe from server'}
              </button>
            </div>
            {dohResult && (
              <p style={{ margin: '0.75rem 0 0' }} data-testid="doh-result">
                {dohResult.resolver} → <span className="hash-chip">{dohResult.value}</span>{' '}
                {roleOf(cellForAnswer(dohResult.value)) && (
                  <span className={`failover-pill ${roleOf(cellForAnswer(dohResult.value))}`}>
                    {cellForAnswer(dohResult.value)}
                  </span>
                )}
              </p>
            )}
            {dohError && (
              <p className="hint-note" style={{ marginBottom: 0 }} data-testid="doh-error">
                {dohError}
              </p>
            )}
            {probeError && <p className="error-note" data-testid="probe-error">{probeError}</p>}
            {probeResult && (
              <div className="record-card" data-testid="probe-result">
                <div className="grid">
                  <div><strong>CNAME target</strong> {probeResult.cnameTarget || 'N/A'}</div>
                  <div>
                    <strong>Winning cell</strong>{' '}
                    {probeResult.winningCellId ? (
                      <span className={`failover-pill ${roleOf(probeResult.winningCellId) || 'primary'}`}>
                        {probeResult.winningCellId}
                      </span>
                    ) : 'N/A'}
                  </div>
                  {probeResult.cellInfo && probeResult.cellInfo.region && (
                    <div><strong>Region</strong> {probeResult.cellInfo.region}</div>
                  )}
                </div>
                {probeResult.note && <div className="values">{probeResult.note}</div>}
              </div>
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
            No events yet — arm the failover pair to start.
          </div>
        )}
      </div>

      <div className="callout">
        <strong>Real resources while armed:</strong> the health checks and CNAMEs above live in
        your AWS account and bill hourly — always disarm after the demo (disarm sweeps everything
        it created). The server probe fetches the CNAME target directly because
        failover.{'{domain}'} has no certificate of its own; the DoH button is an optional
        second witness from your own network.
      </div>
      {statusError && status !== null && <p className="error-note">{statusError}</p>}
    </section>
  );
};

// A render crash in this tab must degrade to an error panel, not unmount the
// whole dashboard mid-presentation (the failover demo talks to live AWS state,
// so an unexpected payload shape is survivable, a black screen is not).
interface BoundaryState {
  error: Error | null;
}

class FailoverDemoBoundary extends React.Component<FailoverDemoProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <section className="section">
          <div className="kicker">Failover</div>
          <h2>Route 53 failover — live</h2>
          <div className="panel">
            <p className="error-note">
              The failover panel hit a rendering error: {this.state.error.message}
            </p>
            <p style={{ color: 'var(--ink-2)', fontSize: '0.9rem' }}>
              Any armed health checks and DNS records are still real — use the button below to
              reload the panel, or disarm from the API if it persists.
            </p>
            <button className="primary" onClick={() => this.setState({ error: null })}>
              Reload panel
            </button>
          </div>
        </section>
      );
    }
    return <FailoverDemo {...this.props} />;
  }
}

export default FailoverDemoBoundary;
