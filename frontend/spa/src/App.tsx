import React, { useState, useEffect } from 'react';
import Icon from './icons';

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
  const getApiUrl = () => {
    if (window.location.hostname === 'localhost') {
      return 'http://localhost:3000/prod';
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

  // Cell identity color: the same categorical palette the hash ring, admin
  // dashboard, and intro site use, keyed off the cellId.
  const CELL_PALETTE = ['#2a78d6', '#1baf7a', '#eda100', '#4a3aa7', '#e87ba4', '#eb6834'];
  const getCellColor = (cellId: string) => {
    const hash = cellId.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    return CELL_PALETTE[hash % CELL_PALETTE.length];
  };

  if (loading) return (
    <div className="loading-container">
      <div className="spinner"></div>
      <div>Loading cell information...</div>
    </div>
  );
  
  if (error) return (
    <div className="error-container">
      <div className="error-icon"><Icon name="x-circle" size={44} /></div>
      <div>{error}</div>
    </div>
  );
  
  if (!cellInfo) return null;

  const cellColor = getCellColor(cellInfo.cellId);

  const clientId = getOrCreateClientId();

  return (
    <div className={`container cell-${cellInfo.cellId}`}>
      <div className="header">
        <div className="welcome-message">
          Welcome ClientID: {clientId}
        </div>
        <div className="cell-banner">
          <h1 className="cell-title">
            <span className="cell-badge" style={{ background: cellColor }}>
              {cellInfo.cellId.slice(cellInfo.cellId.lastIndexOf('-') + 1).toUpperCase()}
            </span>
            CELL {cellInfo.cellId.toUpperCase()}
          </h1>
          <div className="cell-location">
            <Icon name="map-pin" size={14} /> {cellInfo.region} • {cellInfo.availabilityZone}
          </div>
        </div>
      </div>

      <div className="content-grid">
        <div className="card">
          <h2><Icon name="bar-chart" size={17} /> Cell Information</h2>
          <div className="info-grid">
            <div className="info-item">
              <span className="label">Cell ID:</span>
              <span className="value highlight">{cellInfo.cellId}</span>
            </div>
            <div className="info-item">
              <span className="label">Region:</span>
              <span className="value">{cellInfo.region}</span>
            </div>
            <div className="info-item">
              <span className="label">Availability Zone:</span>
              <span className="value">{cellInfo.availabilityZone}</span>
            </div>
            <div className="info-item">
              <span className="label">Your Client ID:</span>
              <span className="value client-id">{getOrCreateClientId()}</span>
            </div>
          </div>
        </div>

        {healthInfo && (
          <div className="card">
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

        <div className="card">
          <h2><Icon name="users" size={17} /> Recent Visitors</h2>
          {recentClients.length > 0 ? (
            <div className="clients-list">
              {recentClients.map((visit, index) => (
                <div key={index} className="client-visit">
                  <div className="client-info">
                    <span className="client-id-short">{visit.clientId.substr(-8)}</span>
                    <span className="visit-time">
                      {new Date(visit.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="client-ip">{visit.sourceIp}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="no-clients">No recent visitors</div>
          )}
        </div>

        <div className="card">
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
  );
};

export default App;