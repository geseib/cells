import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Route53Client } from '@aws-sdk/client-route-53';
import { listFailoverRecordSets, formatFailoverRecords } from '../lib/route53-failover';

const route53 = new Route53Client({ region: 'us-east-1' });

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
    const hostedZoneId = process.env.HOSTED_ZONE_ID;
    const domainName = process.env.DOMAIN_NAME;

    if (!hostedZoneId || !domainName) {
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'HOSTED_ZONE_ID and DOMAIN_NAME must be configured for Route 53 lookups',
          timestamp: new Date().toISOString()
        })
      };
    }

    // Shared with the failover demo: lists A AND CNAME records at
    // failover.{domain} (the armed demo creates CNAMEs; an A-only filter
    // would hide them).
    const recordSets = await listFailoverRecordSets(route53, hostedZoneId, domainName);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        records: formatFailoverRecords(recordSets),
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
