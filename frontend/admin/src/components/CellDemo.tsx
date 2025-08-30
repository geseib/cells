import React, { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

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

interface PieDataItem {
  name: string;
  value: number;
  startDegrees: number;
  endDegrees: number;
}

interface CellDemoProps {
  apiUrl: string;
}

const COLORS = ['#5e72e4', '#2dce89', '#11cdef', '#f5365c', '#8965e0', '#f3a4b5'];

// Hash function to simulate consistent hashing like the backend
const hashClientId = (clientId: string): number => {
  let hash = 0;
  for (let i = 0; i < clientId.length; i++) {
    const char = clientId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
};

// Calculate client position as virtual node number
const getClientNodePosition = (clientId: string, totalVirtualNodes: number): number => {
  const hash = hashClientId(clientId);
  return hash % totalVirtualNodes;
};

// Find which cell a client belongs to using consistent hashing
const findClientCell = (clientId: string, hashRing: HashRingData | null): string | null => {
  if (!hashRing || !hashRing.ring || hashRing.ring.length === 0) return null;
  
  const nodePosition = getClientNodePosition(clientId, hashRing.totalVirtualNodes);
  
  // Sort the ring by position to ensure proper lookup
  const sortedRing = [...hashRing.ring].sort((a, b) => a.position - b.position);
  
  // Find the next virtual node clockwise from the client's position
  let targetNode = sortedRing.find(node => node.position >= nodePosition);
  if (!targetNode) {
    // Wrap around to the first node
    targetNode = sortedRing[0];
  }
  
  return targetNode?.cellId || null;
};

const CellDemo: React.FC<CellDemoProps> = ({ apiUrl }) => {
  const [cells, setCells] = useState<CellData[]>([]);
  const [hashRing, setHashRing] = useState<HashRingData | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientRoute, setClientRoute] = useState<ClientRoute | null>(null);
  const [cellUrls, setCellUrls] = useState<CellUrlsData | null>(null);
  const [qrCodes, setQrCodes] = useState<Map<string, string>>(new Map());
  const [recentClients, setRecentClients] = useState<string[]>([]);
  const [cellClients, setCellClients] = useState<Map<string, string[]>>(new Map());
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
      
      // Refresh client data to update pie chart
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

  if (loading) return <div className="loading">Loading...</div>;

  // Create pie chart data with degree ranges
  const pieData: PieDataItem[] = hashRing?.distribution
    .sort((a, b) => a.cellId.localeCompare(b.cellId))
    .map((d, index, arr) => {
      // Calculate the start angle for this cell
      let startDegrees = 90; // Start at right (Recharts default)
      for (let i = 0; i < index; i++) {
        startDegrees += (arr[i].percentage / 100) * 360;
      }
      const endDegrees = startDegrees + (d.percentage / 100) * 360;
      
      return {
        name: d.cellId,
        value: d.percentage,
        startDegrees: startDegrees % 360,
        endDegrees: endDegrees % 360
      };
    }) || [];
  
  // Build a map of cell degree ranges for easy lookup
  const cellDegreeRanges = new Map(
    pieData.map(d => [d.name, { start: d.startDegrees, end: d.endDegrees }])
  );

  // Group cells by region
  const cellsByRegion = cells.reduce((acc, cell) => {
    if (!acc[cell.region]) {
      acc[cell.region] = [];
    }
    acc[cell.region].push(cell);
    return acc;
  }, {} as Record<string, CellData[]>);

  return (
    <div>
      <section className="section">
        <h2>Active Cells</h2>
        {Object.entries(cellsByRegion).map(([region, regionCells]) => {
          const allActive = regionCells.every(cell => cell.active);
          const allInactive = regionCells.every(cell => !cell.active);
          
          return (
            <div key={region} style={{ marginBottom: '2rem' }}>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between',
                marginBottom: '1rem',
                padding: '1rem',
                background: '#f8f9fa',
                borderRadius: '8px',
                border: '2px solid #e9ecef'
              }}>
                <div>
                  <h3 style={{ margin: 0, color: '#495057' }}>
                    {region.toUpperCase()} Region 
                    <span style={{ fontSize: '0.8em', fontWeight: 'normal', marginLeft: '0.5rem' }}>
                      ({regionCells.filter(c => c.active).length}/{regionCells.length} active)
                    </span>
                  </h3>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button 
                    className="toggle-btn activate"
                    onClick={() => toggleRegionStatus(region, true)}
                    disabled={allActive}
                    style={{ 
                      opacity: allActive ? 0.5 : 1,
                      fontSize: '0.9rem',
                      padding: '0.5rem 1rem'
                    }}
                  >
                    ✓ Activate Region
                  </button>
                  <button 
                    className="toggle-btn deactivate"
                    onClick={() => toggleRegionStatus(region, false)}
                    disabled={allInactive}
                    style={{ 
                      opacity: allInactive ? 0.5 : 1,
                      fontSize: '0.9rem',
                      padding: '0.5rem 1rem'
                    }}
                  >
                    ✗ Deactivate Region
                  </button>
                </div>
              </div>
              
              <div className="cells-grid">
                {regionCells.map(cell => (
                  <div key={cell.cellId} className={`cell-card ${cell.active ? 'active' : 'inactive'}`}>
                    <h3>{cell.cellId}</h3>
                    <div className="cell-info">
                      <p><strong>Region:</strong> {cell.region}</p>
                      <p><strong>AZ:</strong> {cell.availabilityZone}</p>
                      <p><strong>Weight:</strong> {cell.weight}</p>
                      <p><strong>Status:</strong> 
                        <span className={`status ${cell.active ? 'active' : 'inactive'}`}>
                          {cell.active ? 'Active' : 'Inactive'}
                        </span>
                      </p>
                      {cell.lastHeartbeat && (
                        <p><strong>Last Heartbeat:</strong> {new Date(cell.lastHeartbeat).toLocaleString()}</p>
                      )}
                    </div>
                    <button 
                      className={`toggle-btn ${cell.active ? 'deactivate' : 'activate'}`}
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
          <h2>Client Distribution</h2>
          <div style={{ 
            marginBottom: '1rem', 
            padding: '0.75rem', 
            background: '#fff3cd', 
            borderRadius: '5px',
            border: '1px solid #ffeeba',
            fontSize: '0.85rem',
            color: '#856404'
          }}>
            <strong>Note:</strong> The pie chart shows relative cell sizes (percentages). Client positions are based on their hash values and remain fixed - they don't move when cells are added/removed, but the pie segments adjust to show new coverage.
          </div>
          <div className="hash-ring-container" style={{ 
            display: 'grid', 
            gridTemplateColumns: '2.2fr 320px 340px', 
            gap: '1.8rem', 
            alignItems: 'start' 
          }}>
            <div className="chart-container">
              <div className="chart-wrapper" style={{ position: 'relative' }}>
                <ResponsiveContainer width="100%" height={550}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="45%"
                      labelLine={false}
                      label={(entry) => `${entry.name}: ${entry.value.toFixed(1)}%`}
                      outerRadius={90}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
                
                {/* Client positioning overlay */}
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none'
                }}>
                  <svg width="100%" height="100%" style={{ position: 'absolute' }}>
                    {recentClients.slice(0, 10).map((client, index) => {
                      // Use backend's routing decision from cellClients map
                      let cellId = null;
                      for (const [cell, clients] of cellClients.entries()) {
                        if (clients.includes(client)) {
                          cellId = cell;
                          break;
                        }
                      }
                      
                      // Skip if no cellId found
                      if (!cellId) return null;
                      
                      // Get the degree range for this cell
                      const degreeRange = cellDegreeRanges.get(cellId);
                      if (!degreeRange) return null; // Skip if cell not found
                      
                      // Get all clients assigned to this cell that are being displayed
                      const displayedClientsInCell = recentClients.slice(0, 10).filter(c => {
                        for (const [cell, clients] of cellClients.entries()) {
                          if (clients.includes(c) && cell === cellId) return true;
                        }
                        return false;
                      });
                      
                      const clientPositionInCell = displayedClientsInCell.indexOf(client);
                      const totalInCell = displayedClientsInCell.length;
                      
                      // Calculate position within the cell's degree range
                      let startDeg = degreeRange.start;
                      let endDeg = degreeRange.end;
                      
                      // Handle wrap-around (e.g., 350° to 30°)
                      let degreeSpan = endDeg - startDeg;
                      if (degreeSpan < 0) {
                        degreeSpan += 360;
                      }
                      
                      // Distribute clients evenly within the degree range
                      const positionRatio = totalInCell > 1 
                        ? clientPositionInCell / (totalInCell - 1)
                        : 0.5; // Center if only one client
                      
                      let clientDegrees = startDeg + (degreeSpan * positionRatio);
                      if (clientDegrees >= 360) {
                        clientDegrees -= 360;
                      }
                      
                      // Convert degrees to radians (adjusting for pie chart starting at top)
                      const angle = (clientDegrees) * Math.PI / 180;
                      
                      // Match the ResponsiveContainer dimensions (550px height)
                      // ResponsiveContainer will scale to fit available width
                      const containerHeight = 550;
                      const containerWidth = 550; // Assume square for ResponsiveContainer
                      const centerX = containerWidth * 0.5 + 95; // 50% + radius offset + fine adjustment
                      const centerY = containerHeight * 0.45 - 10; // 45% of container height + fine adjustment
                      const pieRadius = 90; // Same as pie chart outerRadius
                      const innerRadius = pieRadius + 15; // Just outside pie
                      // Slight stagger to prevent overlap of labels
                      const outerRadius = pieRadius + 80 + (index % 2) * 20; // 170, 190
                      
                      const labelX = centerX + Math.cos(angle) * outerRadius;
                      const labelY = centerY + Math.sin(angle) * outerRadius;
                      const lineX = centerX + Math.cos(angle) * innerRadius;
                      const lineY = centerY + Math.sin(angle) * innerRadius;
                      
                      const cellIndex = pieData.findIndex(p => p.name === cellId);
                      const color = cellIndex >= 0 ? COLORS[cellIndex % COLORS.length] : '#666';
                      
                      return (
                        <g key={client}>
                          {/* Line from pie to label */}
                          <line
                            x1={lineX}
                            y1={lineY}
                            x2={labelX}
                            y2={labelY}
                            stroke={color}
                            strokeWidth="2"
                            strokeDasharray="3,3"
                          />
                          {/* Client label background */}
                          <rect
                            x={labelX - 40}
                            y={labelY - 8}
                            width="80"
                            height="16"
                            fill="white"
                            stroke={color}
                            strokeWidth="1"
                            rx="8"
                          />
                          {/* Client label text */}
                          <text
                            x={labelX}
                            y={labelY + 3}
                            textAnchor="middle"
                            fontSize="9"
                            fill={color}
                            fontWeight="bold"
                          >
                            {client.length > 12 ? client.slice(-10) : client}
                          </text>
                        </g>
                      );
                    }).filter(Boolean)} {/* Filter out null returns */}
                  </svg>
                </div>
              </div>
            </div>
            
            {/* Second Column: Cell Stats */}
            <div className="distribution-details">
              <h3>Cell Statistics</h3>
              <div className="table-container" style={{ height: '420px', overflowY: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Cell ID</th>
                      <th>Clients</th>
                      <th>Load %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hashRing.distribution.map(d => {
                      const cellClientCount = cellClients.get(d.cellId)?.length || 0;
                      const cellIndex = pieData.findIndex(p => p.name === d.cellId);
                      const color = cellIndex >= 0 ? COLORS[cellIndex % COLORS.length] : '#666';
                      
                      return (
                        <tr key={d.cellId}>
                          <td style={{ fontWeight: 600 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <div style={{ 
                                width: '10px', 
                                height: '10px', 
                                borderRadius: '50%', 
                                background: color 
                              }}></div>
                              {d.cellId}
                            </div>
                          </td>
                          <td style={{ textAlign: 'center', fontWeight: 600 }}>
                            {cellClientCount}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {d.percentage.toFixed(1)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ 
                marginTop: '1rem', 
                padding: '0.75rem', 
                background: '#f0f8ff', 
                borderRadius: '5px',
                border: '1px solid #b0d4ff'
              }}>
                <strong>Total Clients:</strong> {recentClients.length}
              </div>
              <div style={{ 
                marginTop: '0.5rem', 
                padding: '0.75rem', 
                background: '#f0fff0', 
                borderRadius: '5px',
                border: '1px solid #90ee90'
              }}>
                <strong>Active Regions:</strong> {new Set(cells.filter(c => c.active).map(c => c.region)).size}
              </div>
            </div>

            {/* Third Column: Recent Client Mappings */}
            <div className="client-mappings">
              <h3>Recent Client → Cell Mappings</h3>
              <div style={{ 
                height: '460px', 
                overflowY: 'auto', 
                border: '1px solid #ddd', 
                borderRadius: '8px',
                background: '#fafafa'
              }}>
                {recentClients.length > 0 ? (
                  <div style={{ padding: '1rem' }}>
                    {recentClients.map((client, index) => {
                      // Use backend's routing decision from cellClients map
                      let cellId = null;
                      for (const [cell, clients] of cellClients.entries()) {
                        if (clients.includes(client)) {
                          cellId = cell;
                          break;
                        }
                      }
                      
                      const cellIndex = pieData.findIndex(p => p.name === cellId);
                      const color = cellIndex >= 0 ? COLORS[cellIndex % COLORS.length] : '#666';
                      
                      return (
                        <div key={client} style={{
                          display: 'flex',
                          alignItems: 'center',
                          padding: '0.6rem',
                          marginBottom: '0.4rem',
                          background: 'white',
                          border: `1px solid ${color}`,
                          borderRadius: '5px',
                          fontSize: '0.85rem'
                        }}>
                          <div style={{ 
                            width: '10px', 
                            height: '10px', 
                            borderRadius: '50%', 
                            background: color,
                            marginRight: '0.6rem',
                            flexShrink: 0
                          }}></div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ 
                              fontWeight: 600, 
                              color: '#333',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}>
                              {client}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#666' }}>
                              → {cellId || 'unknown'}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ 
                    padding: '2rem', 
                    textAlign: 'center', 
                    color: '#666',
                    fontStyle: 'italic'
                  }}>
                    No recent client activity
                  </div>
                )}
              </div>
              <div style={{ 
                marginTop: '1rem', 
                padding: '0.5rem', 
                background: '#e3f2fd', 
                borderRadius: '5px',
                fontSize: '0.85rem',
                color: '#1976d2'
              }}>
                <strong>Total Recent Clients:</strong> {recentClients.length}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <h2>Client Routing Test</h2>
        <div className="client-test">
          <div className="input-group">
            <input
              type="text"
              placeholder="Enter Client ID"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && checkClientRoute()}
            />
            <button onClick={checkClientRoute}>Check Route</button>
          </div>
          {clientRoute && (
            <div className="route-result">
              <h3>Routing Result</h3>
              <p><strong>Client ID:</strong> {clientRoute.clientId}</p>
              <p><strong>Hash Value:</strong> {clientRoute.hashValue}</p>
              <p><strong>Routed to Cell:</strong> {clientRoute.targetCell.cellId}</p>
              <p><strong>Region:</strong> {clientRoute.targetCell.region}</p>
              <p><strong>AZ:</strong> {clientRoute.targetCell.availabilityZone}</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default CellDemo;