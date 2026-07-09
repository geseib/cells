import React, { useState, useEffect, useRef } from 'react';
import { MAX_HASH, arcPath, makeCellColors, ownershipArcs, pointOnCircle } from '../ring';

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
const RING_CLIENT_LIMIT = 10;

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
  const [recentClients, setRecentClients] = useState<string[]>([]);
  const [cellClients, setCellClients] = useState<Map<string, string[]>>(new Map());
  const [clientHashes, setClientHashes] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  // A client's hash never changes (it is a pure MD5 of the ID), so cache
  // backend lookups for the lifetime of the page.
  const hashCache = useRef<Map<string, number>>(new Map());

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

  // Fetch client data when cells are loaded
  useEffect(() => {
    if (cells.length > 0) {
      fetchRecentClients();

      // Set up interval to refresh client data
      const clientInterval = setInterval(() => {
        fetchRecentClients();
      }, 5000);

      return () => clearInterval(clientInterval);
    }
  }, [cells]);

  // Resolve each displayed client's real ring position (uint32 hash) from the
  // backend, so its dot sits at the exact angle the router computes.
  useEffect(() => {
    if (!apiUrl) return;
    const missing = recentClients
      .slice(0, RING_CLIENT_LIMIT)
      .filter((id) => !hashCache.current.has(id));
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map(async (id) => {
        try {
          const response = await fetch(`${apiUrl}/admin/client-route/${encodeURIComponent(id)}`);
          if (!response.ok) return;
          const data = await response.json();
          if (typeof data.hashValue === 'number') {
            hashCache.current.set(id, data.hashValue);
          }
        } catch (error) {
          console.error('Failed to fetch client hash position:', error);
        }
      })
    ).then(() => {
      if (!cancelled) setClientHashes(new Map(hashCache.current));
    });
    return () => {
      cancelled = true;
    };
  }, [recentClients, apiUrl]);

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

  const fetchRecentClients = async () => {
    try {
      // Call API to get recent clients across all cells
      const response = await fetch(`${apiUrl}/clients`);

      if (response.ok) {
        const data = await response.json();
        setCellClients(new Map(Object.entries(data.cellClients || {})));
        setRecentClients(data.recentClients || []);
      } else {
        console.error('Failed to fetch recent clients from API');
        setCellClients(new Map());
        setRecentClients([]);
      }
    } catch (error) {
      console.error('Error fetching recent clients:', error);
      setCellClients(new Map());
      setRecentClients([]);
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
      fetchRecentClients();

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
      await fetchRecentClients();
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
      await fetchRecentClients();
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

  // Backend's client -> cell decisions (from /clients)
  const clientToCell = new Map<string, string>();
  for (const [cell, ids] of cellClients.entries()) {
    for (const id of ids) clientToCell.set(id, cell);
  }

  // Clients we can place on the ring: recent, with a backend-provided hash.
  const ringClients = recentClients
    .slice(0, RING_CLIENT_LIMIT)
    .filter((id) => clientHashes.has(id))
    .map((id, i) => ({ id, hash: clientHashes.get(id)!, index: i }));

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
                {ringClients.map(({ id, hash, index }) => {
                  const frac = hash / MAX_HASH;
                  const owner = clientToCell.get(id);
                  const color = owner ? colorFor(owner) : 'var(--muted)';
                  const dot = pointOnCircle(CX, CY, R_DOT, frac);
                  // Stagger label radii so neighbouring labels don't collide
                  const labelR = 172 + (index % 2) * 24;
                  const label = pointOnCircle(CX, CY, labelR, frac);
                  const anchor = label.x > CX + 14 ? 'start' : label.x < CX - 14 ? 'end' : 'middle';
                  const dx = anchor === 'start' ? 4 : anchor === 'end' ? -4 : 0;
                  return (
                    <g key={id}>
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
                        {truncate(id)}
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
                        <td>{cellClients.get(d.cellId)?.length || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="stat-row">
                  <div className="stat">
                    <div className="value">{recentClients.length}</div>
                    <div className="label">recent clients</div>
                  </div>
                  <div className="stat">
                    <div className="value">{activeRegions}</div>
                    <div className="label">active regions</div>
                  </div>
                </div>
                <div className="client-list">
                  {recentClients.length > 0 ? (
                    recentClients.map(client => (
                      <div className="entry" key={client}>
                        <span
                          className="swatch"
                          style={{ background: clientToCell.has(client) ? colorFor(clientToCell.get(client)!) : 'var(--muted)' }}
                        />
                        <span className="client-id">{client}</span>
                        <span className="hash-chip">{clientToCell.get(client) || 'unknown'}</span>
                      </div>
                    ))
                  ) : (
                    <div className="empty-note">No recent client activity</div>
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
