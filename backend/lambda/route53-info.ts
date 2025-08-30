import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Route53Client, ListResourceRecordSetsCommand } from '@aws-sdk/client-route-53';

const route53 = new Route53Client({ region: 'us-east-1' });

interface Route53Record {
  name: string;
  type: string;
  ttl?: number;
  values: string[];
  setIdentifier?: string;
  failover?: string;
  healthCheckId?: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    // Get the hosted zone ID for sb.seibtribe.us
    // You'll need to replace this with the actual hosted zone ID
    const hostedZoneId = process.env.HOSTED_ZONE_ID || '/hostedzone/Z1D633PJN98FT9';
    
    const command = new ListResourceRecordSetsCommand({
      HostedZoneId: hostedZoneId,
      StartRecordName: 'stop.sb.seibtribe.us',
      StartRecordType: 'A'
    });

    const response = await route53.send(command);
    
    // Filter for the stop.sb.seibtribe.us records
    const stopRecords = response.ResourceRecordSets?.filter((record: any) => 
      record.Name === 'stop.sb.seibtribe.us.' && record.Type === 'A'
    ) || [];

    const formattedRecords: Route53Record[] = stopRecords.map((record: any) => ({
      name: record.Name || '',
      type: record.Type || '',
      ttl: record.TTL,
      values: record.ResourceRecords?.map((rr: any) => rr.Value || '') || [],
      setIdentifier: record.SetIdentifier,
      failover: record.Failover,
      healthCheckId: record.HealthCheckId
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        records: formattedRecords,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('Error fetching Route 53 records:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to fetch Route 53 records',
        timestamp: new Date().toISOString()
      })
    };
  }
};