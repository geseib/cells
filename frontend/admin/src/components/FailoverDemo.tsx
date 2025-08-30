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

  // Use actual cell endpoints
  const primaryCell: CellEndpoint = {
    region: 'us-east-1',
    cellId: 'us-east-1-az1',
    endpoint: 'https://cell-us-east-1-az1.sb.seibtribe.us'
  };

  const secondaryCell: CellEndpoint = {
    region: 'us-west-2', 
    cellId: 'us-west-2-az1',
    endpoint: 'https://cell-us-west-2-az1.sb.seibtribe.us'
  };

  const currentCell = isPrimary ? primaryCell : secondaryCell;

  const toggleFailover = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // In a real implementation, this would trigger Route 53 failover
      // For now, we'll just toggle the state and resolve DNS
      setIsPrimary(!isPrimary);
      await resolveDNS();
    } catch (err) {
      setError('Failed to toggle failover');
      console.error('Failover error:', err);
    } finally {
      setLoading(false);
    }
  };

  const detectFailoverState = async () => {
    try {
      // In a real implementation, this would check Route 53 status or health checks
      // For now, simulate detecting current failover state
      const response = await fetch('stop.sb.seibtribe.us', { mode: 'no-cors' });
      // Since we can't read the response in no-cors mode, we'll simulate detection
      // In reality, you'd use a backend service to check DNS records
      setIsPrimary(true); // Default to primary
    } catch (err) {
      console.log('State detection completed (simulated)');
      setIsPrimary(true);
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
    detectFailoverState();
    resolveDNS();
  }, []);

  useEffect(() => {
    resolveDNS();
  }, [isPrimary]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '2rem',
      background: '#27293d',
      borderRadius: '0.25rem',
      margin: '2rem',
      border: '1px solid #344675',
      color: '#ffffff'
    }}>
      <h2 style={{ marginBottom: '2rem', color: '#ffffff' }}>
        🔄 Route 53 Failover Demo
      </h2>
      
      {/* Client Icon */}
      <div style={{ fontSize: '4rem', marginBottom: '2rem' }}>
        <div>🖥️</div>
        <p style={{ fontSize: '1rem', margin: '0.5rem 0' }}>Client</p>
      </div>

      {/* Connection Status */}
      <div style={{ 
        margin: '1rem 0', 
        fontSize: '1.2rem',
        padding: '1rem',
        background: isPrimary ? 'rgba(45, 206, 137, 0.2)' : 'rgba(17, 205, 239, 0.2)',
        borderRadius: '0.25rem',
        border: `1px solid ${isPrimary ? '#2dce89' : '#11cdef'}`,
        textAlign: 'center'
      }}>
        <div style={{ marginBottom: '0.5rem' }}>
          Connection Status: <strong>{isPrimary ? 'Primary' : 'Secondary'}</strong>
        </div>
        <div style={{ fontSize: '0.9rem', color: '#c4c4c4' }}>
          {currentCell.region} - {currentCell.cellId}
        </div>
        <div style={{ fontSize: '0.8rem', fontFamily: 'monospace', marginTop: '0.5rem' }}>
          {currentCell.endpoint}
        </div>
      </div>

      {/* Failover Toggle */}
      <button 
        onClick={toggleFailover}
        disabled={loading}
        style={{
          padding: '0.75rem 2rem',
          fontSize: '1rem',
          background: loading ? '#6c757d' : 'linear-gradient(135deg, #5e72e4 0%, #8965e0 100%)',
          color: '#ffffff',
          border: 'none',
          borderRadius: '0.25rem',
          cursor: loading ? 'not-allowed' : 'pointer',
          transition: 'all 0.15s ease',
          fontWeight: '600',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          margin: '1rem 0'
        }}
        onMouseEnter={(e) => {
          if (!loading) {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 10px 20px rgba(94, 114, 228, 0.3)';
          }
        }}
        onMouseLeave={(e) => {
          if (!loading) {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'none';
          }
        }}
      >
        {loading ? 'Switching...' : `Switch to ${isPrimary ? 'Secondary' : 'Primary'}`}
      </button>

      {/* DNS Query Display */}
      <div style={{ 
        marginTop: '2rem', 
        fontFamily: 'monospace',
        background: '#1e1e2e',
        padding: '1rem',
        borderRadius: '0.25rem',
        border: '1px solid #344675',
        textAlign: 'center'
      }}>
        <div style={{ marginBottom: '0.5rem', fontSize: '1.1rem' }}>
          🔍 DNS Resolution
        </div>
        <div style={{ fontSize: '0.9rem', color: '#11cdef', marginBottom: '1rem' }}>
          stop.sb.seibtribe.us → {resolvedIP || 'resolving...'}
        </div>
        <button 
          onClick={resolveDNS}
          style={{
            padding: '0.5rem 1rem',
            fontSize: '0.9rem',
            background: 'linear-gradient(135deg, #11cdef 0%, #1171ef 100%)',
            color: '#ffffff',
            border: 'none',
            borderRadius: '0.25rem',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            fontWeight: '600'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = '0 5px 15px rgba(17, 205, 239, 0.3)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          Query
        </button>
        {error && (
          <div style={{ color: '#f5365c', fontSize: '0.8rem', marginTop: '0.5rem' }}>
            ⚠️ {error}
          </div>
        )}
      </div>

      {/* Route 53 Records Display */}
      <div style={{ 
        marginTop: '2rem', 
        fontFamily: 'monospace',
        background: '#1e1e2e',
        padding: '1rem',
        borderRadius: '0.25rem',
        border: '1px solid #344675',
        width: '100%',
        maxWidth: '800px'
      }}>
        <div style={{ marginBottom: '1rem', fontSize: '1.1rem', textAlign: 'center' }}>
          ⚙️ Route 53 Record Sets
        </div>
        
        {recordsLoading ? (
          <div style={{ textAlign: 'center', color: '#c4c4c4' }}>
            Loading Route 53 records...
          </div>
        ) : route53Records.length > 0 ? (
          <div style={{ fontSize: '0.85rem' }}>
            {route53Records.map((record, index) => (
              <div key={index} style={{ 
                marginBottom: '1rem', 
                padding: '0.75rem',
                background: 'rgba(68, 70, 117, 0.3)',
                borderRadius: '0.25rem',
                border: '1px solid #344675'
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <div><strong>Name:</strong> {record.name}</div>
                  <div><strong>Type:</strong> {record.type}</div>
                  <div><strong>TTL:</strong> {record.ttl || 'N/A'}</div>
                  <div><strong>Set ID:</strong> {record.setIdentifier || 'N/A'}</div>
                  <div><strong>Failover:</strong> 
                    <span style={{ 
                      color: record.failover === 'PRIMARY' ? '#2dce89' : '#11cdef',
                      fontWeight: 'bold',
                      marginLeft: '0.5rem'
                    }}>
                      {record.failover || 'N/A'}
                    </span>
                  </div>
                  <div><strong>Health Check:</strong> {record.healthCheckId || 'N/A'}</div>
                </div>
                <div style={{ marginTop: '0.5rem' }}>
                  <strong>Values:</strong>
                  <div style={{ marginLeft: '1rem', color: '#11cdef' }}>
                    {record.values.map((value: string, i: number) => (
                      <div key={i}>• {value}</div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: '#c4c4c4' }}>
            No Route 53 records found or API URL not configured
          </div>
        )}
      </div>

      {/* Information Panel */}
      <div style={{
        marginTop: '2rem',
        padding: '1rem',
        background: 'rgba(17, 205, 239, 0.1)',
        borderRadius: '0.25rem',
        border: '1px solid #11cdef',
        fontSize: '0.85rem',
        textAlign: 'center',
        maxWidth: '600px'
      }}>
        <div style={{ marginBottom: '0.5rem', fontWeight: '600' }}>
          📋 Demo Information
        </div>
        <div style={{ color: '#c4c4c4', lineHeight: '1.5' }}>
          This demo simulates Route 53 DNS failover between two cell regions.
          In a real implementation, Route 53 health checks would automatically 
          switch traffic from the primary to secondary endpoint when failures are detected.
        </div>
      </div>
    </div>
  );
};

export default FailoverDemo;