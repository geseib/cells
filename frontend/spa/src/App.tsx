import React, { useState, useEffect, useMemo, useRef } from 'react';
import Icon from './icons';

/* ------------------------------------------------------------------ */
/* Cell identity: which palette slot is this cell?                     */
/*                                                                     */
/* The admin dashboard and the site color cells by sorted-cellId index */
/* over the full registry (makeCellColors in frontend/admin/src/ring   */
/* .ts). A single cell's SPA can't see the registry at runtime, so     */
/* deploy-frontend.sh computes the index across ALL regions at deploy  */
/* time and bakes it in as CELL_INDEX. The hash fallback below only    */
/* exists for ad-hoc local builds — the deploy path always passes the  */
/* real index, keeping this page's color in lockstep with the admin    */
/* ring visualization.                                                 */
/* ------------------------------------------------------------------ */

const CELL_COLOR_VARS = [
  'var(--cell-1)',
  'var(--cell-2)',
  'var(--cell-3)',
  'var(--cell-4)',
  'var(--cell-5)',
  'var(--cell-6)',
  'var(--cell-7)',
  'var(--cell-8)',
];

const cellIndex: number = (() => {
  const raw = process.env.CELL_INDEX;
  if (raw !== undefined && raw !== '' && !Number.isNaN(Number(raw))) {
    return Math.max(0, Math.floor(Number(raw)));
  }
  // Fallback (local builds only): stable hash of the cellId.
  const id = process.env.CELL_ID || '';
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % CELL_COLOR_VARS.length;
})();

/** This cell's identity color as a CSS var — resolves per light/dark theme. */
const cellAccent = CELL_COLOR_VARS[cellIndex % CELL_COLOR_VARS.length];

// Expose the identity color to the stylesheet (top band, badge, section
// accents). Set at module load so even the loading/error states are tinted;
// being a var() reference it resolves per light/dark theme.
if (typeof document !== 'undefined') {
  document.documentElement.style.setProperty('--cell-accent', cellAccent);
}

/* ------------------------------------------------------------------ */
/* Ring mark: the site's hash-ring emblem, re-tinted for ONE cell.     */
/* Decorative only (the real ring math lives in backend/lib/           */
/* consistent-hash.ts) — here the point is recognition: most of the    */
/* band is this cell's color, with thin slivers of the other palette   */
/* colors standing in for "everyone else's slices of the keyspace".    */
/* ------------------------------------------------------------------ */

/** SVG path for a circular arc band (donut segment), fractions of a turn.
    Same geometry helper as site/src/sim/simulation.ts. */
function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startFrac: number,
  endFrac: number
): string {
  const startAngle = startFrac * 2 * Math.PI - Math.PI / 2;
  const endAngle = endFrac * 2 * Math.PI - Math.PI / 2;
  const large = endFrac - startFrac > 0.5 ? 1 : 0;
  const x1 = cx + rOuter * Math.cos(startAngle);
  const y1 = cy + rOuter * Math.sin(startAngle);
  const x2 = cx + rOuter * Math.cos(endAngle);
  const y2 = cy + rOuter * Math.sin(endAngle);
  const x3 = cx + rInner * Math.cos(endAngle);
  const y3 = cy + rInner * Math.sin(endAngle);
  const x4 = cx + rInner * Math.cos(startAngle);
  const y4 = cy + rInner * Math.sin(startAngle);
  return [
    `M ${x1} ${y1}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ');
}

/** Tiny deterministic PRNG so every build of the same cell draws the same ring. */
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RingSegment {
  start: number;
  end: number;
  color: string;
}

/** Dominant-color ring: wide arcs of this cell's color, interleaved with
    thin accents drawn from the rest of the palette. Seeded by the cell
    index, so different cells differ in both hue and arc pattern. */
function ringSegments(index: number): RingSegment[] {
  const rand = mulberry32(index * 7919 + 13);
  const dominant = CELL_COLOR_VARS[index % CELL_COLOR_VARS.length];
  const others = CELL_COLOR_VARS.filter((_, i) => i !== index % CELL_COLOR_VARS.length);
  const segments: RingSegment[] = [];
  let pos = 0;
  while (pos < 1) {
    const wide = Math.min(1, pos + 0.055 + rand() * 0.095);
    segments.push({ start: pos, end: wide, color: dominant });
    pos = wide;
    if (pos < 1 && rand() < 0.72) {
      const thin = Math.min(1, pos + 0.011 + rand() * 0.02);
      segments.push({
        start: pos,
        end: thin,
        color: others[Math.floor(rand() * others.length)],
      });
      pos = thin;
    }
  }
  return segments;
}

const RingMark: React.FC<{ size: number; band: number; className?: string }> = ({
  size,
  band,
  className,
}) => {
  const segments = useMemo(() => ringSegments(cellIndex), []);
  const c = size / 2;
  return (
    <svg
      className={className ? `ring-mark ${className}` : 'ring-mark'}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
    >
      {segments.map((seg, i) => (
        <path key={i} d={arcPath(c, c, c - 1, c - 1 - band, seg.start, seg.end)} fill={seg.color} />
      ))}
    </svg>
  );
};

/* ------------------------------------------------------------------ */
/* Demo banner                                                         */
/* ------------------------------------------------------------------ */

/** Slim sticky banner: brand on the left (this cell's mini ring mark), a
    dropdown menu of demo destinations on the right. Sticky (not fixed) so
    it pushes the hero down instead of covering it. Closes on outside click
    and Escape. */
const DemoBanner: React.FC = () => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const adminUrl = process.env.ADMIN_URL || '';
  const introUrl = process.env.INTRO_URL || '';

  // Brand = home link. Same edge detection as getApiUrl: when this page is
  // served under its own /{cellId}/ path prefix (single-hostname edge
  // distribution), the edge root "/" is the router/home page. Otherwise the
  // admin dashboard is "home". If neither applies (ad-hoc build with no
  // ADMIN_URL), the brand stays a plain span.
  const cellId = process.env.CELL_ID || '';
  const onEdge =
    cellId !== '' && window.location.pathname.startsWith(`/${cellId}/`);
  const homeHref = onEdge ? '/' : adminUrl;
  const brandContent = (
    <>
      <RingMark size={18} band={5.5} className="banner-ring" />
      Cell Demo
      {cellId ? <span className="banner-cell mono">· {cellId}</span> : null}
    </>
  );

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="demo-banner">
      {homeHref ? (
        <a className="banner-brand" href={homeHref} aria-label="Back to home">
          {brandContent}
        </a>
      ) : (
        <span className="banner-brand">{brandContent}</span>
      )}
      <div className="banner-menu" ref={menuRef}>
        <button
          className="banner-menu-btn"
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="menu" size={15} /> Menu
        </button>
        {open && (
          <div className="banner-dropdown" role="menu">
            {introUrl && (
              <a role="menuitem" href={introUrl} target="_blank" rel="noopener noreferrer">
                Interactive guide
              </a>
            )}
            {introUrl && (
              <a role="menuitem" href={`${introUrl}/primer.html`} target="_blank" rel="noopener noreferrer">
                Primer
              </a>
            )}
            {introUrl && (
              <a role="menuitem" href={`${introUrl}/slides.html`} target="_blank" rel="noopener noreferrer">
                Slides
              </a>
            )}
            {adminUrl && <a role="menuitem" href={adminUrl}>Admin dashboard</a>}
            {adminUrl && <a role="menuitem" href={`${adminUrl}/router.html`}>Router page</a>}
          </div>
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Data shapes (unchanged — see backend/lambda handlers)               */
/* ------------------------------------------------------------------ */

interface CellInfo {
  cellId: string;
  region: string;
  availabilityZone: string;
  cloudfrontUrl: string;
  timestamp: string;
  requestId: string;
  sourceIp: string;
  userAgent: string;
  stats?: {
    requestCount: number;
    lastHealthCheck: string;
    uptime: string;
  };
}

interface HealthInfo {
  cellId: string;
  status: string;
  lastCheck: string;
  checks: {
    dynamodb: boolean;
    memory: boolean;
    cpu: boolean;
  };
  memoryUsage: {
    heapUsed: string;
    heapTotal: string;
    percentage: string;
  };
}

interface ClientVisit {
  clientId: string;
  timestamp: string;
  sourceIp: string;
}

const App: React.FC = () => {
  const [cellInfo, setCellInfo] = useState<CellInfo | null>(null);
  const [healthInfo, setHealthInfo] = useState<HealthInfo | null>(null);
  const [recentClients, setRecentClients] = useState<ClientVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // CELL_API_URL and ADMIN_URL are injected at build time by webpack DefinePlugin;
  // deploy-frontend.sh builds the SPA once per cell with that cell's API endpoint.
  // Edge mode: when this page is served under its own /{cellId}/ path prefix
  // (single-hostname edge distribution), the cell's API is reachable at the
  // relative /{cellId}/api on the same host - still this cell's OWN API, just
  // via the edge, so fault isolation is unchanged.
  const getApiUrl = () => {
    if (window.location.hostname === 'localhost') {
      return 'http://localhost:3000/prod';
    }
    const cellId = process.env.CELL_ID || '';
    if (cellId && window.location.pathname.startsWith(`/${cellId}/`)) {
      return `/${cellId}/api`;
    }
    return process.env.CELL_API_URL || '';
  };

  const adminUrl = process.env.ADMIN_URL || '';
  const introUrl = process.env.INTRO_URL || '';

  useEffect(() => {
    fetchCellInfo();
    fetchHealthInfo();
    const interval = setInterval(() => {
      fetchHealthInfo();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    loadRecentClients();
  }, [cellInfo]);

  const fetchCellInfo = async () => {
    try {
      const apiBase = window.location.hostname === 'localhost'
        ? 'http://localhost:3000/prod'
        : getApiUrl();
      const response = await fetch(`${apiBase}/info`, {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      if (!response.ok) throw new Error('Failed to fetch cell info');
      const data = await response.json();
      setCellInfo(data);

      // Track this visit
      await trackClientVisit(data);
      setLoading(false);
    } catch (err) {
      setError('Failed to load cell information');
      setLoading(false);
    }
  };

  const fetchHealthInfo = async () => {
    try {
      const apiBase = window.location.hostname === 'localhost'
        ? 'http://localhost:3000/prod'
        : getApiUrl();
      const response = await fetch(`${apiBase}/health`, {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });

      // Handle 503 as valid degraded state, not an error
      if (response.ok || response.status === 503) {
        const data = await response.json();
        setHealthInfo(data);
      } else {
        throw new Error('Failed to fetch health info');
      }
    } catch (err) {
      console.error('Health check failed:', err);
    }
  };

  const trackClientVisit = async (cellData: CellInfo) => {
    const clientId = getOrCreateClientId();

    try {
      // Track the visit against this cell's own API — cells must not depend on
      // another cell or region at runtime (fault isolation is the whole point)
      const response = await fetch(`${getApiUrl()}/track-client`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId,
          cellId: cellData.cellId,
          sourceIp: cellData.sourceIp
        })
      });

      if (response.ok) {
        console.log('Client visit tracked successfully');
        // Refresh recent clients after tracking
        await loadRecentClients();
      } else {
        console.error('Failed to track client visit');
      }
    } catch (error) {
      console.error('Error tracking client visit:', error);
    }
  };

  const loadRecentClients = async () => {
    if (cellInfo) {
      try {
        // Recent clients come from this cell's own API as well
        const response = await fetch(`${getApiUrl()}/clients/cell/${cellInfo.cellId}`);

        if (response.ok) {
          const data = await response.json();
          // Convert API response to match existing interface
          const visits = data.clients.map((client: any) => ({
            clientId: client.clientId,
            timestamp: client.lastConnectTime,
            sourceIp: client.ip
          }));
          setRecentClients(visits);
        } else {
          console.error('Failed to load recent clients');
          setRecentClients([]);
        }
      } catch (error) {
        console.error('Error loading recent clients:', error);
        setRecentClients([]);
      }
    }
  };

  const getOrCreateClientId = () => {
    // First check URL parameter (from router)
    const urlParams = new URLSearchParams(window.location.search);
    const urlClientId = urlParams.get('clientId');

    if (urlClientId) {
      // Use the client ID from URL and store it for future use
      localStorage.setItem('cellClientId', urlClientId);
      return urlClientId;
    }

    // Fallback to localStorage or generate new one
    let clientId = localStorage.getItem('cellClientId');
    if (!clientId) {
      clientId = 'client-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('cellClientId', clientId);
    }
    return clientId;
  };

  if (loading) return (
    <>
      <DemoBanner />
      <div className="loading-container">
        <div className="spinner"></div>
        <div>Loading cell information...</div>
      </div>
    </>
  );

  if (error) return (
    <>
      <DemoBanner />
      <div className="error-container">
        <div className="error-icon"><Icon name="x-circle" size={44} /></div>
        <div>{error}</div>
      </div>
    </>
  );

  if (!cellInfo) return null;

  const clientId = getOrCreateClientId();
  const azShort = cellInfo.cellId.slice(cellInfo.cellId.lastIndexOf('-') + 1).toUpperCase();

  return (
    <>
    <DemoBanner />
    <div className="wrap">
      <header className="hero">
        <RingMark size={116} band={11} className="hero-ring" />
        <div className="kicker">You&rsquo;ve landed in a cell</div>
        <h1 className="cell-title">
          <span className="cell-badge">{azShort}</span>
          <span className="mono">{cellInfo.cellId}</span>
        </h1>
        <p className="cell-location">
          <Icon name="map-pin" size={14} /> {cellInfo.region} · {cellInfo.availabilityZone}
        </p>
        <p className="welcome-message">
          Welcome, <span className="hash-chip">{clientId}</span>
        </p>
      </header>

      <div className="content-grid">
        <div className="panel card">
          <h2><Icon name="bar-chart" size={17} /> Cell Information</h2>
          <div className="info-grid">
            <div className="info-item">
              <span className="label">Cell ID</span>
              <span className="value highlight mono">{cellInfo.cellId}</span>
            </div>
            <div className="info-item">
              <span className="label">Region</span>
              <span className="value">{cellInfo.region}</span>
            </div>
            <div className="info-item">
              <span className="label">Availability Zone</span>
              <span className="value">{cellInfo.availabilityZone}</span>
            </div>
            <div className="info-item">
              <span className="label">Your Client ID</span>
              <span className="value client-id mono">{getOrCreateClientId()}</span>
            </div>
          </div>
        </div>

        {healthInfo && (
          <div className="panel card">
            <h2><Icon name="heart-pulse" size={17} /> Health Status</h2>
            <div className="health-status">
              <div className={`status-indicator ${healthInfo.status}`}>
                <Icon
                  name={healthInfo.status === 'healthy' ? 'check-circle' : healthInfo.status === 'degraded' ? 'alert-triangle' : 'x-circle'}
                  size={16}
                  strokeWidth={2}
                />
                {healthInfo.status.toUpperCase()}
              </div>
              <div className="health-checks">
                <div className="check-item">
                  <span className={`check-icon ${healthInfo.checks.dynamodb ? 'ok' : 'fail'}`}>
                    <Icon name={healthInfo.checks.dynamodb ? 'check-circle' : 'x-circle'} size={15} strokeWidth={2} />
                  </span>
                  DynamoDB
                </div>
                <div className="check-item">
                  <span className={`check-icon ${healthInfo.checks.memory ? 'ok' : 'fail'}`}>
                    <Icon name={healthInfo.checks.memory ? 'check-circle' : 'alert-triangle'} size={15} strokeWidth={2} />
                  </span>
                  Memory ({healthInfo.memoryUsage.percentage})
                </div>
                <div className="check-item">
                  <span className={`check-icon ${healthInfo.checks.cpu ? 'ok' : 'fail'}`}>
                    <Icon name={healthInfo.checks.cpu ? 'check-circle' : 'x-circle'} size={15} strokeWidth={2} />
                  </span>
                  CPU
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="panel card">
          <h2><Icon name="users" size={17} /> Recent Visitors</h2>
          {recentClients.length > 0 ? (
            <div className="clients-list">
              {recentClients.map((visit, index) => (
                <div key={index} className="client-visit">
                  <div className="client-info">
                    <span className="client-id-short mono">{visit.clientId.substr(-8)}</span>
                    <span className="visit-time">
                      {new Date(visit.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="client-ip mono">{visit.sourceIp}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="no-clients">No recent visitors</div>
          )}
        </div>

        <div className="panel card">
          <h2><Icon name="link" size={17} /> Navigation</h2>
          <div className="nav-buttons">
            {adminUrl && (
              <a href={adminUrl} className="nav-btn admin-btn">
                <Icon name="sliders" size={15} /> Admin Dashboard
              </a>
            )}
            {adminUrl && (
              <a href={`${adminUrl}/router.html`} className="nav-btn router-btn">
                <Icon name="shuffle" size={15} /> Router Page
              </a>
            )}
            {introUrl && (
              <a href={introUrl} className="nav-btn" target="_blank" rel="noopener noreferrer">
                <Icon name="book-open" size={15} /> How Cells Work
              </a>
            )}
            <button
              onClick={() => window.location.reload()}
              className="nav-btn refresh-btn"
            >
              <Icon name="refresh" size={15} /> Refresh Data
            </button>
          </div>
        </div>
      </div>

      <div className="footer">
        <div className="footer-info">
          <Icon name="clock" size={13} /> Last updated: {new Date(cellInfo.timestamp).toLocaleString()}
        </div>
      </div>
    </div>
    </>
  );
};

export default App;
