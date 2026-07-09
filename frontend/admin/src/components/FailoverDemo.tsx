import React, { useState, useEffect } from 'react';

interface FailoverDemoProps {
  apiUrl: string;
}

interface CellEndpoint {
  region: string;
  cellId: string;
  endpoint: string;
}

const FailoverDemo: React.FC<FailoverDemoProps> = ({ apiUrl }) => {
  const [isPrimary, setIsPrimary] = useState(true);
  const [resolvedIP, setResolvedIP] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [route53Records, setRoute53Records] = useState<any[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);

  const [primaryCell, setPrimaryCell] = useState<CellEndpoint>({
    region: 'primary-region',
    cellId: 'primary-cell',
    endpoint: 'https://cell-primary.example.com'
  });
  const [secondaryCell, setSecondaryCell] = useState<CellEndpoint>({
    region: 'secondary-region',
    cellId: 'secondary-cell',
    endpoint: 'https://cell-secondary.example.com'
  });

  const currentCell = isPrimary ? primaryCell : secondaryCell;

  // Load the first two registered cells from the admin API to use as the
  // primary/secondary pair in the walkthrough
  const loadCellEndpoints = async () => {
    if (!apiUrl) return;
    try {
      const response = await fetch(`${apiUrl}/admin/cell-urls`);
      const data = await response.json();
      const cells = (data.cellUrls || []).filter((c: any) => c.active);
      if (cells.length >= 2) {
        setPrimaryCell({ region: cells[0].region, cellId: cells[0].cellId, endpoint: cells[0].directUrl });
        setSecondaryCell({ region: cells[1].region, cellId: cells[1].cellId, endpoint: cells[1].directUrl });
      }
    } catch (err) {
      console.error('Failed to load cell endpoints:', err);
    }
  };

  const toggleFailover = async () => {
    setLoading(true);
    setError(null);

    try {
      // Simulation only: a real failover is driven by Route 53 health checks,
      // not a button. This just flips which endpoint the walkthrough displays.
      setIsPrimary(!isPrimary);
      await resolveDNS();
    } catch (err) {
      setError('Failed to toggle failover');
      console.error('Failover error:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchRoute53Records = async () => {
    if (!apiUrl) return;

    setRecordsLoading(true);
    try {
      const response = await fetch(`${apiUrl}/route53-info`);
      const data = await response.json();

      if (data.success) {
        setRoute53Records(data.records);
      } else {
        setError('Failed to fetch Route 53 records');
      }
    } catch (err) {
      setError('Failed to fetch Route 53 records');
      console.error('Route 53 fetch error:', err);
    } finally {
      setRecordsLoading(false);
    }
  };

  const resolveDNS = async () => {
    try {
      // Simulate DNS resolution - in reality this would query actual DNS
      const targetCell = isPrimary ? primaryCell : secondaryCell;
      setResolvedIP(targetCell.endpoint);

      // Also fetch Route 53 records
      await fetchRoute53Records();
    } catch (err) {
      setError('Failed to resolve DNS');
      console.error('DNS resolution error:', err);
    }
  };

  useEffect(() => {
    loadCellEndpoints();
    resolveDNS();
  }, [apiUrl]);

  useEffect(() => {
    resolveDNS();
  }, [isPrimary, primaryCell, secondaryCell]);

  return (
    <section className="section">
      <div className="kicker">Failover</div>
      <h2>Route 53 failover — simulated walkthrough</h2>
      <p className="lede">
        This is a <strong>simulation</strong>: the toggle only changes what this page displays; no
        DNS records are modified. In a real deployment, Route 53 health checks detect a failing
        primary endpoint and shift traffic to the secondary automatically.
      </p>

      <div className="panel">
        <div className="failover-stage">
          <div className={`connection-status ${isPrimary ? 'primary' : 'secondary'}`}>
            <div className="who">
              Client connected to{' '}
              <span className={`failover-pill ${isPrimary ? 'primary' : 'secondary'}`}>
                {isPrimary ? 'Primary' : 'Secondary'}
              </span>
            </div>
            <div className="meta">
              {currentCell.region} · {currentCell.cellId}
            </div>
            <div style={{ marginTop: '0.5rem' }}>
              <span className="hash-chip">{currentCell.endpoint}</span>
            </div>
          </div>

          <button className="primary" onClick={toggleFailover} disabled={loading}>
            {loading ? 'Switching…' : `Simulate failover to ${isPrimary ? 'secondary' : 'primary'}`}
          </button>
        </div>
      </div>

      <div className="panel dns-panel" style={{ maxWidth: 'none' }}>
        <h3>DNS resolution</h3>
        <p style={{ margin: '0 0 0.75rem', color: 'var(--ink-2)', fontSize: '0.9rem' }}>
          failover endpoint → <span className="hash-chip">{resolvedIP || 'resolving…'}</span>
        </p>
        <button onClick={resolveDNS}>Query again</button>
        {error && <p className="error-note">{error}</p>}
      </div>

      <div className="panel">
        <h3>Route 53 record sets</h3>
        <p style={{ margin: '0 0 0.5rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
          Read live from your hosted zone via the admin API.
        </p>

        {recordsLoading ? (
          <div className="empty-note">Loading Route 53 records…</div>
        ) : route53Records.length > 0 ? (
          <div>
            {route53Records.map((record, index) => (
              <div key={index} className="record-card">
                <div className="grid">
                  <div><strong>Name</strong> {record.name}</div>
                  <div><strong>Type</strong> {record.type}</div>
                  <div><strong>TTL</strong> {record.ttl || 'N/A'}</div>
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
                  {record.values.map((value: string, i: number) => (
                    <div key={i}>{value}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-note">No Route 53 records found or API URL not configured</div>
        )}
      </div>

      <div className="callout">
        <strong>Simulation only:</strong> real failover is driven by Route 53 health checks, not a
        button. Use this walkthrough to narrate what happens when a primary cell goes dark.
      </div>
    </section>
  );
};

export default FailoverDemo;
