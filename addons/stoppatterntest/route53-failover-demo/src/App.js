import React, { useEffect, useState } from 'react';
import ClientIcon from './components/ClientIcon';
import ConnectionLine from './components/ConnectionLine';
import ToggleFailoverSwitch from './components/ToggleFailoverSwitch';
import DNSQueryDisplay from './components/DNSQueryDisplay';

function App() {
  const [isPrimary, setIsPrimary] = useState(true);
  const [resolvedIP, setResolvedIP] = useState('1.1.1.1');
  const [recordsetDetails, setRecordsetDetails] = useState(null);

  const toggleFailover = async () => {
    // Toggle the failover state (this would normally trigger Route53 record updates)
    setIsPrimary(!isPrimary);
    // Fetch updated recordset details after the toggle
    await fetchRecordsetDetails();
  };

  const fetchRecordsetDetails = async () => {
    try {
      // Replace with your actual API Gateway URL
      const apiUrl = process.env.REACT_APP_API_URL || 'https://your-api-gateway-url.execute-api.region.amazonaws.com/prod';
      const response = await fetch(`${apiUrl}/route53-info`);
      const data = await response.json();
      
      if (data.success) {
        setRecordsetDetails(data.records);
      }
    } catch (error) {
      console.error('Error fetching recordset details:', error);
    }
  };

  const resolveDNS = async () => {
    // This would normally query DNS, but for demo purposes we'll use the recordset data
    await fetchRecordsetDetails();
  };

  useEffect(() => {
    resolveDNS();
  }, []);

  useEffect(() => {
    if (recordsetDetails) {
      const primaryRecord = recordsetDetails.find(record => record.failover === 'PRIMARY');
      const secondaryRecord = recordsetDetails.find(record => record.failover === 'SECONDARY');
      
      if (isPrimary && primaryRecord) {
        setResolvedIP(primaryRecord.values[0]);
      } else if (!isPrimary && secondaryRecord) {
        setResolvedIP(secondaryRecord.values[0]);
      }
    }
  }, [isPrimary, recordsetDetails]);

  return (
    <div style={{ textAlign: 'center', marginTop: '2rem' }}>
      <ClientIcon />
      <ConnectionLine isPrimary={isPrimary} />
      <ToggleFailoverSwitch toggle={toggleFailover} isPrimary={isPrimary} />
      <DNSQueryDisplay ip={resolvedIP} recordsetDetails={recordsetDetails} />
    </div>
  );
}

export default App;
