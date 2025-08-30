import React from 'react';

function DNSQueryDisplay({ ip, recordsetDetails }) {
  return (
    <div style={{ marginTop: '2rem', fontFamily: 'monospace' }}>
      <div style={{ marginBottom: '1rem' }}>
        🔍 DNS Response: stop.sb.seibtribe.us → {ip}
      </div>
      
      {recordsetDetails && (
        <div style={{ 
          backgroundColor: '#f5f5f5', 
          padding: '1rem', 
          borderRadius: '4px',
          textAlign: 'left',
          maxWidth: '600px',
          margin: '0 auto'
        }}>
          <h3>Route53 Recordset Details:</h3>
          {recordsetDetails.map((record, index) => (
            <div key={index} style={{ 
              marginBottom: '1rem', 
              padding: '0.5rem', 
              backgroundColor: record.failover === 'PRIMARY' ? '#e8f5e8' : '#f5e8e8',
              borderRadius: '4px'
            }}>
              <div><strong>Type:</strong> {record.type}</div>
              <div><strong>TTL:</strong> {record.ttl}</div>
              <div><strong>Value:</strong> {record.values.join(', ')}</div>
              <div><strong>Failover:</strong> {record.failover}</div>
              <div><strong>Set ID:</strong> {record.setIdentifier}</div>
              {record.healthCheckId && (
                <div><strong>Health Check ID:</strong> {record.healthCheckId}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default DNSQueryDisplay;
