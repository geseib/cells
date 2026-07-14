import React, { useState, useEffect } from 'react';
import { MAX_HASH, arcPath, makeCellColors, ownershipArcs, pointOnCircle } from '../ring';
import JoinCard from './JoinCard';

interface CellData {
  cellId: string;
  region: string;
  availabilityZone: string;
  weight: number;
  active: boolean;
  lastHeartbeat?: string;
}

interface HashRingData {
  distribution: Array<{
    cellId: string;
    virtualNodes: number;
    percentage: number;
  }>;
  ring: Array<{
    position: number;
    cellId: string;
    region: string;
    az: string;
  }>;
  totalVirtualNodes: number;
}

interface ClientRoute {
  clientId: string;
  targetCell: CellData;
  hashValue: number;
}

interface CellUrl {
  cellId: string;
  region: string;
  availabilityZone: string;
  directUrl: string;
  routingUrl: string;
  weight: number;
  active: boolean;
}

interface CellUrlsData {
  cellUrls: CellUrl[];
  customDomain: string;
  totalCells: number;
}

interface LiveClientRecord {
  clientId: string;
  cellId: string;
  region: string;
  az: string;
  lastSeen: string;
  hashValue: number;
}

interface CellDemoProps {
  apiUrl: string;
}

// Ring SVG geometry (wider than tall so client labels never clip)
const WIDTH = 540;
const HEIGHT = 480;
const CX = WIDTH / 2;
const CY = HEIGHT / 2;
const R_OUTER = 140;
const R_INNER = 104;
const R_DOT = 148;
const RING_LABEL_LIMIT = 10; // labels for the most recent; every live client gets a dot
const RING_DOT_LIMIT = 60;

// Client -> cell mappings displayed below always come from the backend's own
// routing decisions (the /clients response and /admin/client-route) - never
// from a client-side re-implementation of the hash, which could drift from
// real routing.

const CellDemo: React.FC<CellDemoProps> = ({ apiUrl }) => {
  const [cells, setCells] = useState<CellData[]>([]);
  const [hashRing, setHashRing] = useState<HashRingData | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientRoute, setClientRoute] = useState<ClientRoute | null>(null);
  const [cellUrls, setCellUrls] = useState<CellUrlsData | null>(null);
  const [qrCodes, setQrCodes] = useState<Map<string, string>>(new Map());
  const [liveRecords, setLiveRecords] = useState<LiveClientRecord[]>([]);
  const [recordFilter, setRecordFilter] = useState(''); // SK prefix: '' | 'region#' | 'region#az#'
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (apiUrl) {
      fetchCells();
      fetchHashRing();
      fetchCellUrls();

      const interval = setInterval(() => {
        fetchCells();
      }, 10000);
      return () => clearInterval(interval);
    }
  }, [apiUrl]);

  // Live client records (everyone seen in the last hour), refreshed and
  // re-queried whenever the region/AZ filter changes.
  useEffect(() => {
    if (!apiUrl) return;
    fetchLiveRecords(recordFilter);
    const interval = setInterval(() => fetchLiveRecords(recordFilter), 10000);
    return () => clearInterval(interval);
  }, [apiUrl, recordFilter]);

  const fetchCells = async () => {
    try {
      const response = await fetch(`${apiUrl}/admin/cells`, {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      const data = await response.json();
      setCells(data.cells);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch cells:', error);
      setLoading(false);
    }
  };

  const fetchHashRing = async () => {
    try {
      const response = await fetch(`${apiUrl}/admin/hash-ring`, {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      const data = await response.json();
      // Ensure the ring is sorted by position
      if (data && data.ring) {
        data.ring.sort((a: any, b: any) => a.position - b.position);
      }
      setHashRing(data);
    } catch (error) {
      console.error('Failed to fetch hash ring:', error);
    }
  };

  const fetchLiveRecords = async (prefix: string) => {
    try {
      // Hierarchical SK query: no prefix = every client, 'us-east-1#' = one
      // region, 'us-east-1#az1#' = one cell. Records expire after an hour.
      const qs = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
      const response = await fetch(`${apiUrl}/clients/records${qs}`);
      if (response.ok) {
        const data = await response.json();
        setLiveRecords(data.records || []);
      } else {
        console.error('Failed to fetch live client records');
        setLiveRecords([]);
      }
    } catch (error) {
      console.error('Error fetching live client records:', error);
      setLiveRecords([]);
    }
  };

  const checkClientRoute = async () => {
    if (!clientId) return;
    try {
      // First refresh the hash ring to get latest cell states
      await fetchHashRing();

      const response = await fetch(`${apiUrl}/admin/client-route/${clientId}`);
      const data = await response.json();
      setClientRoute(data);

      // Save this client visit via API for the assigned cell
      if (data.targetCell) {
        try {
          await fetch(`${apiUrl}/track-client`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              clientId,
              cellId: data.targetCell.cellId,
              sourceIp: 'admin-test'
            })
          });
        } catch (error) {
          console.error('Failed to track client visit:', error);
        }
      }

      // Refresh client data to update the ring
      fetchLiveRecords(recordFilter);

    } catch (error) {
      console.error('Failed to check client route:', error);
    }
  };

  const fetchCellUrls = async () => {
    try {
      const response = await fetch(`${apiUrl}/admin/cell-urls`);
      const data = await response.json();
      setCellUrls(data);

      // Generate QR codes for each cell URL
      data.cellUrls.forEach(async (cellUrl: CellUrl) => {
        await generateQRCode(cellUrl.cellId, cellUrl.directUrl);
      });
    } catch (error) {
      console.error('Failed to fetch cell URLs:', error);
    }
  };

  const generateQRCode = async (cellId: string, url: string) => {
    try {
      const response = await fetch(`${apiUrl}/qr-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: url, size: 150 })
      });
      const data = await response.json();
      setQrCodes(prev => new Map(prev.set(cellId, data.qrCodeUrl)));
    } catch (error) {
      console.error('Failed to generate QR code:', error);
    }
  };

  const toggleCellStatus = async (cellId: string, currentStatus: boolean) => {
    try {
      await fetch(`${apiUrl}/admin/cells/${cellId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !currentStatus })
      });
      // Fetch in sequence to ensure hash ring is updated before client mappings
      await fetchCells();
      await fetchHashRing();
      await fetchCellUrls();
      // Force re-render of client list with new hash ring
      await fetchLiveRecords(recordFilter);
    } catch (error) {
      console.error('Failed to update cell:', error);
    }
  };

  const toggleRegionStatus = async (region: string, newStatus: boolean) => {
    try {
      await fetch(`${apiUrl}/admin/regions/${region}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: newStatus })
      });
      // Fetch in sequence to ensure hash ring is updated before client mappings
      await fetchCells();
      await fetchHashRing();
      await fetchCellUrls();
      // Force re-render of client list with new hash ring
      await fetchLiveRecords(recordFilter);
    } catch (error) {
      console.error('Failed to update region:', error);
    }
  };

  if (loading) return <div className="loading">Loading…</div>;

  // Stable color per cell: sorted cellId order over all registered cells, so
  // colors don't shuffle when a cell is deactivated.
  const colorFor = makeCellColors(cells.map((c) => c.cellId));

  // Ownership arcs from the REAL ring positions the backend routes with.
  const arcs = hashRing ? ownershipArcs(hashRing.ring) : [];

  // Every live client carries its backend-computed hash; dots for all (capped),
  // labels for the most recent few.
  const ringClients = liveRecords
    .slice(0, RING_DOT_LIMIT)
    .map((r, i) => ({ record: r, index: i, labeled: i < RING_LABEL_LIMIT }));

  const clientsPerCell = new Map<string, number>();
  for (const r of liveRecords) {
    clientsPerCell.set(r.cellId, (clientsPerCell.get(r.cellId) || 0) + 1);
  }

  // Filter chips built from the registered cells: all / each region / each cell
  const regionsForFilter = [...new Set(cells.map((c) => c.region))].sort();
  const filterChips: Array<{ label: string; prefix: string }> = [
    { label: 'All clients', prefix: '' },
    ...regionsForFilter.map((r) => ({ label: r, prefix: `${r}#` })),
    ...[...cells].sort((a, b) => a.cellId.localeCompare(b.cellId)).map((c) => {
      const az = c.cellId.slice(c.cellId.lastIndexOf('-') + 1);
      return { label: c.cellId, prefix: `${c.region}#${az}#` };
    }),
  ];

  const relTime = (iso: string) => {
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    return mins === 0 ? 'just now' : `${mins}m ago`;
  };

  const sortedDistribution = hashRing
    ? [...hashRing.distribution].sort((a, b) => a.cellId.localeCompare(b.cellId))
    : [];

  const activeRegions = new Set(cells.filter((c) => c.active).map((c) => c.region)).size;

  // Group cells by region
  const cellsByRegion = cells.reduce((acc, cell) => {
    if (!acc[cell.region]) {
      acc[cell.region] = [];
    }
    acc[cell.region].push(cell);
    return acc;
  }, {} as Record<string, CellData[]>);

  const truncate = (id: string, max = 12) => (id.length > max ? `${id.slice(0, max - 1)}…` : id);

  return (
    <div>
      <JoinCard apiUrl={apiUrl} />

      <section className="section">
        <div className="kicker">Cells</div>
        <h2>Cell health &amp; control</h2>
        <p className="lede">
          Every registered cell, grouped by region. Deactivating a cell removes its virtual nodes
          from the ring; its clients redistribute to the surviving cells.
        </p>
        {Object.entries(cellsByRegion).map(([region, regionCells]) => {
          const allActive = regionCells.every(cell => cell.active);
          const allInactive = regionCells.every(cell => !cell.active);

          return (
            <div key={region}>
              <div className="region-header">
                <h3>
                  {region}
                  <span className="meta">
                    {regionCells.filter(c => c.active).length}/{regionCells.length} active
                  </span>
                </h3>
                <div className="actions">
                  <button
                    onClick={() => toggleRegionStatus(region, true)}
                    disabled={allActive}
                  >
                    Activate region
                  </button>
                  <button
                    className="danger"
                    onClick={() => toggleRegionStatus(region, false)}
                    disabled={allInactive}
                  >
                    Deactivate region
                  </button>
                </div>
              </div>

              <div className="cells-grid">
                {regionCells.map(cell => (
                  <div key={cell.cellId} className={`cell-card ${cell.active ? 'active' : 'inactive'}`}>
                    <h4>
                      <span className="swatch" style={{ background: colorFor(cell.cellId) }} />
                      {cell.cellId}
                      <span className={`status-pill ${cell.active ? 'active' : 'inactive'}`}>
                        {cell.active ? 'Active' : 'Inactive'}
                      </span>
                    </h4>
                    <div className="cell-info">
                      <p><strong>Region</strong> {cell.region}</p>
                      <p><strong>AZ</strong> {cell.availabilityZone}</p>
                      <p><strong>Weight</strong> {cell.weight}</p>
                      {cell.lastHeartbeat && (
                        <p><strong>Heartbeat</strong> {new Date(cell.lastHeartbeat).toLocaleString()}</p>
                      )}
                    </div>
                    <button
                      className={cell.active ? 'danger' : 'primary'}
                      onClick={() => toggleCellStatus(cell.cellId, cell.active)}
                    >
                      {cell.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {hashRing && (
        <section className="section">
          <div className="kicker">Hash ring</div>
          <h2>Client distribution</h2>
          <p className="lede">
            The live ring, drawn from the backend's real virtual-node positions. Each recent
            client sits at its true MD5 hash position on the 2³² keyspace, so a dot always lands
            inside the arc of the cell that owns it.
          </p>
          <div className="panel">
            <div className="controls" role="group" aria-label="Filter live clients by region or cell">
              {filterChips.map((chip) => (
                <button
                  key={chip.prefix || 'all'}
                  className={recordFilter === chip.prefix ? 'selected' : ''}
                  onClick={() => setRecordFilter(chip.prefix)}
                >
                  {chip.label}
                </button>
              ))}
            </div>
            <div className="ring-layout">
              <svg
                width={WIDTH}
                height={HEIGHT}
                viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                role="img"
                aria-label="Live hash ring: cell ownership arcs with recent clients at their hash positions"
              >
                {arcs.map((arc, i) => (
                  <path
                    key={i}
                    d={arcPath(CX, CY, R_OUTER, R_INNER, arc.start, arc.end)}
                    fill={colorFor(arc.cellId)}
                    stroke="var(--surface-1)"
                    strokeWidth={hashRing.ring.length <= 64 ? 1.5 : 0}
                  />
                ))}
                {ringClients.map(({ record, index, labeled }) => {
                  const frac = record.hashValue / MAX_HASH;
                  const color = colorFor(record.cellId);
                  const dot = pointOnCircle(CX, CY, R_DOT, frac);
                  if (!labeled) {
                    return (
                      <circle
                        key={record.clientId}
                        cx={dot.x}
                        cy={dot.y}
                        r={3.5}
                        fill={color}
                        stroke="var(--surface-1)"
                        strokeWidth={1}
                        opacity={0.85}
                      >
                        <title>{record.clientId} → {record.cellId} ({relTime(record.lastSeen)})</title>
                      </circle>
                    );
                  }
                  // Stagger label radii so neighbouring labels don't collide
                  const labelR = 172 + (index % 2) * 24;
                  const label = pointOnCircle(CX, CY, labelR, frac);
                  const anchor = label.x > CX + 14 ? 'start' : label.x < CX - 14 ? 'end' : 'middle';
                  const dx = anchor === 'start' ? 4 : anchor === 'end' ? -4 : 0;
                  return (
                    <g key={record.clientId}>
                      <line
                        x1={dot.x}
                        y1={dot.y}
                        x2={label.x}
                        y2={label.y}
                        stroke={color}
                        strokeWidth={1}
                        strokeDasharray="2,3"
                      />
                      <circle
                        cx={dot.x}
                        cy={dot.y}
                        r={5}
                        fill={color}
                        stroke="var(--surface-1)"
                        strokeWidth={1.5}
                      />
                      <text
                        x={label.x + dx}
                        y={label.y + 3.5}
                        textAnchor={anchor}
                        fontSize="10.5"
                        fill="var(--ink-2)"
                      >
                        {truncate(record.clientId)}
                      </text>
                    </g>
                  );
                })}
                <text x={CX} y={CY - 8} textAnchor="middle" fill="var(--ink-2)" fontSize="13">
                  2³² keyspace
                </text>
                <text x={CX} y={CY + 12} textAnchor="middle" fill="var(--muted)" fontSize="11">
                  {hashRing.totalVirtualNodes} virtual nodes
                </text>
              </svg>
              <div className="side">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Cell</th>
                      <th>Keyspace</th>
                      <th>Clients</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDistribution.map(d => (
                      <tr key={d.cellId}>
                        <td>
                          <span className="swatch" style={{ background: colorFor(d.cellId) }} />
                          {d.cellId}
                        </td>
                        <td>{d.percentage.toFixed(1)}%</td>
                        <td>{clientsPerCell.get(d.cellId) || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="stat-row">
                  <div className="stat">
                    <div className="value">{liveRecords.length}</div>
                    <div className="label">live clients (last hour{recordFilter ? ', filtered' : ''})</div>
                  </div>
                  <div className="stat">
                    <div className="value">{activeRegions}</div>
                    <div className="label">active regions</div>
                  </div>
                </div>
                <div className="client-list">
                  {liveRecords.length > 0 ? (
                    liveRecords.slice(0, 12).map(record => (
                      <div className="entry" key={record.clientId}>
                        <span
                          className="swatch"
                          style={{ background: colorFor(record.cellId) }}
                        />
                        <span className="client-id">{record.clientId}</span>
                        <span className="meta">{relTime(record.lastSeen)}</span>
                        <span className="hash-chip">{record.cellId}</span>
                      </div>
                    ))
                  ) : (
                    <div className="empty-note">No clients in the last hour{recordFilter ? ' for this filter' : ''}</div>
                  )}
                  {liveRecords.length > 12 && (
                    <div className="empty-note">+{liveRecords.length - 12} more on the ring</div>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="callout">
            <strong>Fixed positions, moving boundaries:</strong> a client's hash position never
            changes — only arc boundaries move when cells are added or removed. Every position and
            mapping shown here comes from the backend's own MD5 routing, not a re-implementation.
          </div>
        </section>
      )}

      <section className="section">
        <div className="kicker">Routing</div>
        <h2>Client routing test</h2>
        <p className="lede">
          Ask the routing API where a client ID lands. The lookup is recorded, so the client also
          appears on the ring above.
        </p>
        <div className="panel">
          <div className="controls">
            <input
              type="text"
              placeholder="Enter a client ID"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && checkClientRoute()}
              aria-label="Client ID to route"
            />
            <button className="primary" onClick={checkClientRoute}>Check route</button>
          </div>
          {clientRoute && clientRoute.targetCell && (
            <div className="stat-row">
              <div className="stat">
                <div className="value" style={{ fontSize: '1.05rem' }}>
                  <span className="hash-chip">
                    md5("{clientRoute.clientId}") → {clientRoute.hashValue.toLocaleString()}
                  </span>
                </div>
                <div className="label">position on the 2³² ring</div>
              </div>
              <div className="stat">
                <div className="value" style={{ fontSize: '1.2rem' }}>
                  <span className="swatch" style={{ background: colorFor(clientRoute.targetCell.cellId) }} />
                  {clientRoute.targetCell.cellId}
                </div>
                <div className="label">
                  {clientRoute.targetCell.region} · {clientRoute.targetCell.availabilityZone}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {cellUrls && cellUrls.cellUrls.length > 0 && (
        <section className="section">
          <div className="kicker">Access</div>
          <h2>Cell endpoints</h2>
          <p className="lede">
            Direct and routed URLs for every cell{cellUrls.customDomain ? ` under ${cellUrls.customDomain}` : ''}.
            Scan a QR code to open a cell's page on your phone.
          </p>
          <div className="urls-grid">
            {cellUrls.cellUrls.map(cellUrl => (
              <div key={cellUrl.cellId} className="url-card">
                <div>
                  <h4>
                    <span className="swatch" style={{ background: colorFor(cellUrl.cellId) }} />
                    {cellUrl.cellId}
                    <span className={`status-pill ${cellUrl.active ? 'active' : 'inactive'}`}>
                      {cellUrl.active ? 'Active' : 'Inactive'}
                    </span>
                  </h4>
                  <div className="meta">
                    {cellUrl.region} · {cellUrl.availabilityZone} · weight {cellUrl.weight}
                  </div>
                  <div className="link-label">Direct</div>
                  <a href={cellUrl.directUrl} target="_blank" rel="noopener noreferrer">
                    {cellUrl.directUrl}
                  </a>
                  <div className="link-label">Via router</div>
                  <a href={cellUrl.routingUrl} target="_blank" rel="noopener noreferrer">
                    {cellUrl.routingUrl}
                  </a>
                </div>
                {qrCodes.get(cellUrl.cellId) && (
                  <img
                    className="qr-image"
                    src={qrCodes.get(cellUrl.cellId)}
                    alt={`QR code for ${cellUrl.cellId}`}
                  />
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default CellDemo;
