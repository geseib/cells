import React, { useState, useEffect } from 'react';

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

  // Map CloudFront domains to their API endpoints
  const getApiUrl = () => {
    const hostname = window.location.hostname;
    
    // Known CloudFront to API mappings for our cells
    const apiMappings: { [key: string]: string } = {
      'dux3dlzgmx6e3.cloudfront.net': 'https://rwa731jg5h.execute-api.us-east-1.amazonaws.com/prod',  // us-east-1-az1
      'd3mvbkzb4meuxv.cloudfront.net': 'https://uqy9mzzp05.execute-api.us-east-1.amazonaws.com/prod', // us-east-1-az2
      'd3lpwt3y0g5y6t.cloudfront.net': 'https://jtp1jdfxii.execute-api.us-west-2.amazonaws.com/prod', // us-west-2-az1
      'diagecgk70yb9.cloudfront.net': 'https://83cn0vcix2.execute-api.us-west-2.amazonaws.com/prod',  // us-west-2-az2
      'cell-us-east-1-az1.sb.seibtribe.us': 'https://rwa731jg5h.execute-api.us-east-1.amazonaws.com/prod',  // us-east-1-az1 custom domain
      'cell-us-east-1-az2.sb.seibtribe.us': 'https://uqy9mzzp05.execute-api.us-east-1.amazonaws.com/prod', // us-east-1-az2 custom domain
      'cell-us-west-2-az1.sb.seibtribe.us': 'https://jtp1jdfxii.execute-api.us-west-2.amazonaws.com/prod', // us-west-2-az1 custom domain
      'cell-us-west-2-az2.sb.seibtribe.us': 'https://83cn0vcix2.execute-api.us-west-2.amazonaws.com/prod', // us-west-2-az2 custom domain
      'stop.sb.seibtribe.us': 'https://rwa731jg5h.execute-api.us-east-1.amazonaws.com/prod',  // stop failover domain (primary: us-east-1-az1)
    };

    return apiMappings[hostname] || '';
  };

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
      // Call API to track client visit
      const response = await fetch('https://lo4603bdh4.execute-api.us-east-1.amazonaws.com/prod/track-client', {
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
        // Call API to get recent clients for this cell
        const response = await fetch(`https://lo4603bdh4.execute-api.us-east-1.amazonaws.com/prod/clients/cell/${cellInfo.cellId}`);
        
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

  // Generate unique color for each cell
  const getCellColor = (cellId: string) => {
    const colors = [
      { bg: '#667eea', accent: '#764ba2', name: 'Purple Galaxy', emoji: '🌌' },
      { bg: '#f093fb', accent: '#f5576c', name: 'Pink Sunset', emoji: '🌅' },
      { bg: '#4facfe', accent: '#00f2fe', name: 'Blue Ocean', emoji: '🌊' },
      { bg: '#43e97b', accent: '#38f9d7', name: 'Green Forest', emoji: '🌲' },
      { bg: '#fa709a', accent: '#fee140', name: 'Warm Gradient', emoji: '🔥' },
      { bg: '#a8edea', accent: '#fed6e3', name: 'Soft Pastel', emoji: '🦄' }
    ];
    const hash = cellId.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    return colors[hash % colors.length];
  };

  if (loading) return (
    <div className="loading-container">
      <div className="spinner"></div>
      <div>Loading cell information...</div>
    </div>
  );
  
  if (error) return (
    <div className="error-container">
      <div className="error-icon">❌</div>
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
            {cellColor.emoji} CELL {cellInfo.cellId.toUpperCase()} {cellColor.emoji}
          </h1>
          <div className="cell-theme">{cellColor.name}</div>
          <div className="cell-location">
            📍 {cellInfo.region} • {cellInfo.availabilityZone}
          </div>
        </div>
      </div>

      <div className="content-grid">
        <div className="card">
          <h2>📊 Cell Information</h2>
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
            <h2>💗 Health Status</h2>
            <div className="health-status">
              <div className={`status-indicator ${healthInfo.status}`}>
                {healthInfo.status === 'healthy' ? '✅' : healthInfo.status === 'degraded' ? '⚠️' : '❌'} 
                {healthInfo.status.toUpperCase()}
              </div>
              <div className="health-checks">
                <div className="check-item">
                  <span className={`check-icon ${healthInfo.checks.dynamodb ? 'ok' : 'fail'}`}>
                    {healthInfo.checks.dynamodb ? '✅' : '❌'}
                  </span>
                  DynamoDB
                </div>
                <div className="check-item">
                  <span className={`check-icon ${healthInfo.checks.memory ? 'ok' : 'fail'}`}>
                    {healthInfo.checks.memory ? '✅' : '⚠️'}
                  </span>
                  Memory ({healthInfo.memoryUsage.percentage})
                </div>
                <div className="check-item">
                  <span className={`check-icon ${healthInfo.checks.cpu ? 'ok' : 'fail'}`}>
                    {healthInfo.checks.cpu ? '✅' : '❌'}
                  </span>
                  CPU
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="card">
          <h2>👥 Recent Visitors</h2>
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
          <h2>🔗 Navigation</h2>
          <div className="nav-buttons">
            <a href="https://celladmin.sb.seibtribe.us" className="nav-btn admin-btn">
              🎛️ Admin Dashboard
            </a>
            <a href="https://celladmin.sb.seibtribe.us/router.html" className="nav-btn router-btn">
              🔀 Router Page
            </a>
            <button 
              onClick={() => window.location.reload()} 
              className="nav-btn refresh-btn"
            >
              🔄 Refresh Data
            </button>
          </div>
        </div>
      </div>

      <div className="footer">
        <div className="footer-info">
          ⏰ Last updated: {new Date(cellInfo.timestamp).toLocaleString()}
        </div>
      </div>
    </div>
  );
};

export default App;