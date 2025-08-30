import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const ddbDoc = DynamoDBDocumentClient.from(client);

const CELL_ID = process.env.CELL_ID!;
const CELL_REGION = process.env.CELL_REGION!;
const AVAILABILITY_ZONE = process.env.AVAILABILITY_ZONE!;
const CELL_DATA_TABLE = process.env.CELL_DATA_TABLE!;
const CLOUDFRONT_URL = process.env.CLOUDFRONT_URL!;

export const handler = async (event: any): Promise<any> => {
  try {
    const cellInfo: any = {
      cellId: CELL_ID,
      region: CELL_REGION,
      availabilityZone: AVAILABILITY_ZONE,
      cloudfrontUrl: `https://${CLOUDFRONT_URL}`,
      timestamp: new Date().toISOString(),
      requestId: event.requestContext.requestId,
      sourceIp: event.requestContext.identity.sourceIp || '',
      userAgent: event.headers['User-Agent'] || 'Unknown'
    };

    const statsResult = await ddbDoc.send(new GetCommand({
      TableName: CELL_DATA_TABLE,
      Key: {
        pk: 'CELL_STATS',
        sk: CELL_ID
      }
    }));

    if (statsResult.Item) {
      cellInfo['stats'] = {
        requestCount: statsResult.Item.requestCount || 0,
        lastHealthCheck: statsResult.Item.lastHealthCheck || 'Never',
        uptime: statsResult.Item.uptime || '0%'
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'X-Cell-ID': CELL_ID || '',
        'X-Cell-Region': CELL_REGION || '',
        'X-Cell-AZ': AVAILABILITY_ZONE || ''
      },
      body: JSON.stringify(cellInfo, null, 2)
    };
  } catch (error) {
    console.error('Error in cell info handler:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: 'Internal server error',
        cellId: CELL_ID 
      })
    };
  }
};