import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, PutCommand, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(client);
const CLIENT_VISITS_TABLE = process.env.CLIENT_VISITS_TABLE!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  try {
    // Handle preflight requests
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers,
        body: ''
      };
    }

    const path = event.resource;
    const method = event.httpMethod;

    if (method === 'POST' && path === '/visits') {
      return await createVisit(event, headers);
    } else if (method === 'GET' && path === '/visits') {
      return await getRecentVisits(headers);
    } else if (method === 'GET' && path === '/visits/cell/{cellId}') {
      return await getVisitsByCell(event, headers);
    } else {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Not found' })
      };
    }
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

async function createVisit(event: APIGatewayProxyEvent, headers: any): Promise<APIGatewayProxyResult> {
  if (!event.body) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Request body is required' })
    };
  }

  const body = JSON.parse(event.body);
  const { clientId, cellId, sourceIp, userAgent, timestamp } = body;

  if (!clientId || !cellId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'clientId and cellId are required' })
    };
  }

  const visitTimestamp = timestamp || new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 days TTL

  const item = {
    clientId,
    timestamp: visitTimestamp,
    cellId,
    sourceIp: sourceIp || 'unknown',
    userAgent: userAgent || 'unknown',
    ttl
  };

  try {
    await dynamodb.send(new PutCommand({
      TableName: CLIENT_VISITS_TABLE,
      Item: item
    }));

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({ 
        success: true, 
        message: 'Visit recorded',
        visit: item
      })
    };
  } catch (error) {
    console.error('Error creating visit:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to record visit' })
    };
  }
}

async function getRecentVisits(headers: any): Promise<APIGatewayProxyResult> {
  try {
    // Get recent visits across all cells using the timestamp index
    const result = await dynamodb.send(new ScanCommand({
      TableName: CLIENT_VISITS_TABLE,
      IndexName: 'timestamp-index',
      Limit: 100
    }));

    // Sort by timestamp (most recent first) and group by cell
    const visits = (result.Items || []).sort((a: any, b: any) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Group by cell and get unique clients per cell
    const cellClients: { [cellId: string]: string[] } = {};
    const allClients: string[] = [];
    const seenClients = new Set<string>();

    visits.forEach((visit: any) => {
      if (!cellClients[visit.cellId]) {
        cellClients[visit.cellId] = [];
      }
      
      // Add to cell-specific list if not already there
      if (!cellClients[visit.cellId].includes(visit.clientId)) {
        cellClients[visit.cellId].push(visit.clientId);
      }
      
      // Add to overall recent clients list (unique)
      if (!seenClients.has(visit.clientId)) {
        allClients.push(visit.clientId);
        seenClients.add(visit.clientId);
      }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        cellClients,
        recentClients: allClients.slice(0, 10), // Most recent 10 unique clients
        totalVisits: visits.length
      })
    };
  } catch (error) {
    console.error('Error getting recent visits:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to get recent visits' })
    };
  }
}

async function getVisitsByCell(event: APIGatewayProxyEvent, headers: any): Promise<APIGatewayProxyResult> {
  const cellId = event.pathParameters?.cellId;
  
  if (!cellId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'cellId is required' })
    };
  }

  try {
    const result = await dynamodb.send(new QueryCommand({
      TableName: CLIENT_VISITS_TABLE,
      IndexName: 'cellId-timestamp-index',
      KeyConditionExpression: 'cellId = :cellId',
      ExpressionAttributeValues: {
        ':cellId': cellId
      },
      ScanIndexForward: false, // Sort by timestamp descending
      Limit: 50
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        cellId,
        visits: result.Items || [],
        count: result.Count || 0
      })
    };
  } catch (error) {
    console.error('Error getting visits by cell:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to get visits for cell' })
    };
  }
}