import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import MD5 from 'crypto-js/md5';

const client = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(client);
const CLIENT_TRACKING_TABLE = process.env.CLIENT_TRACKING_TABLE!;

// Live-client records live in the global tracking table in us-east-1 so the
// admin ring can show every client seen anywhere in the last hour. Cells
// write them cross-region fire-and-forget (like cell registration): telemetry
// must never block or fail the cell's own serving path.
const GLOBAL_CLIENT_RECORDS_TABLE = process.env.GLOBAL_CLIENT_RECORDS_TABLE || '';
const globalClient = new DynamoDBClient({ region: 'us-east-1' });
const globalDynamo = DynamoDBDocumentClient.from(globalClient);

const LIVE_RECORD_TTL_SECONDS = 60 * 60; // records display for one hour

/**
 * Hierarchical live-client record under a single partition:
 *   PK = CLIENTRECORDS
 *   SK = {region}#{az}#{clientId}   e.g. us-east-1#az1#user123
 * Query the PK for all clients, begins_with 'us-east-1#' for a region,
 * begins_with 'us-east-1#az1#' for one cell.
 */
async function recordLiveClient(clientId: string, cellId: string, now: string): Promise<void> {
  if (!GLOBAL_CLIENT_RECORDS_TABLE) return;
  const azIndex = cellId.lastIndexOf('-');
  const region = azIndex > 0 ? cellId.slice(0, azIndex) : cellId;
  const az = azIndex > 0 ? cellId.slice(azIndex + 1) : 'az0';
  try {
    await globalDynamo.send(new PutCommand({
      TableName: GLOBAL_CLIENT_RECORDS_TABLE,
      Item: {
        PK: 'CLIENTRECORDS',
        SK: `${region}#${az}#${clientId}`,
        ClientId: clientId,
        CellId: cellId,
        Region: region,
        Az: az,
        LastSeen: now,
        TTL: Math.floor(Date.now() / 1000) + LIVE_RECORD_TTL_SECONDS
      }
    }));
  } catch (error) {
    // Best-effort telemetry - never fail the serving path over it
    console.error('Failed to record live client (non-fatal):', error);
  }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
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

    if (method === 'POST' && path === '/track-client') {
      return await trackClient(event, headers);
    } else if (method === 'GET' && path === '/clients/records') {
      return await getLiveClientRecords(event, headers);
    } else if (method === 'GET' && path === '/clients') {
      return await getRecentClients(headers);
    } else if (method === 'GET' && path === '/clients/cell/{cellId}') {
      return await getClientsByCell(event, headers);
    } else if (method === 'GET' && path === '/clients/count/cell/{cellId}') {
      return await getClientCountByCell(event, headers);
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

async function trackClient(event: APIGatewayProxyEvent, headers: any): Promise<APIGatewayProxyResult> {
  if (!event.body) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Request body is required' })
    };
  }

  const body = JSON.parse(event.body);
  const { clientId, sourceIp } = body;
  // A cell's own deployment knows its identity (CELL_ID env) - callers only
  // need to pass cellId on the global routing API, which serves every cell.
  const cellId = body.cellId || process.env.CELL_ID;

  if (!clientId || !cellId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'clientId and cellId are required' })
    };
  }

  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + (30 * 60); // 30 minutes TTL

  const pk = 'CLIENTS';
  const sk = `CELL#${cellId}#CLIENT#${clientId}`;

  // Global live-client record for the admin ring (best-effort)
  await recordLiveClient(clientId, cellId, now);

  try {
    // Try to update existing record or insert new one
    await dynamodb.send(new UpdateCommand({
      TableName: CLIENT_TRACKING_TABLE,
      Key: {
        PK: pk,
        SK: sk
      },
      UpdateExpression: 'SET LastConnectTime = :lastConnect, #ip = :ip, #ttl = :ttl, CellId = :cellId ADD #connectCount :inc',
      ExpressionAttributeNames: {
        '#ip': 'IP',
        '#ttl': 'TTL',
        '#connectCount': 'ConnectCount'
      },
      ExpressionAttributeValues: {
        ':lastConnect': now,
        ':ip': sourceIp || 'unknown',
        ':ttl': ttl,
        ':cellId': cellId,
        ':inc': 1
      },
      // If record doesn't exist, set FirstConnectTime
      ConditionExpression: 'attribute_exists(PK)',
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true, 
        message: 'Client visit updated',
        clientId,
        cellId
      })
    };
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      // Record doesn't exist, create new one
      await dynamodb.send(new PutCommand({
        TableName: CLIENT_TRACKING_TABLE,
        Item: {
          PK: pk,
          SK: sk,
          CellId: cellId,
          ClientId: clientId,
          FirstConnectTime: now,
          LastConnectTime: now,
          IP: sourceIp || 'unknown',
          ConnectCount: 1,
          TTL: ttl
        }
      }));

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({ 
          success: true, 
          message: 'New client tracked',
          clientId,
          cellId
        })
      };
    } else {
      throw error;
    }
  }
}

/**
 * All clients seen anywhere in the last hour, optionally filtered by SK
 * prefix (?prefix=us-east-1# for a region, ?prefix=us-east-1#az1# for a
 * cell). DynamoDB TTL deletion lags, so expired records are filtered here -
 * the one-hour window is exact regardless of physical deletion.
 */
async function getLiveClientRecords(event: APIGatewayProxyEvent, headers: any): Promise<APIGatewayProxyResult> {
  const prefix = event.queryStringParameters?.prefix || '';
  const nowEpoch = Math.floor(Date.now() / 1000);

  try {
    const result = await dynamodb.send(new QueryCommand({
      TableName: CLIENT_TRACKING_TABLE,
      KeyConditionExpression: prefix
        ? 'PK = :pk AND begins_with(SK, :prefix)'
        : 'PK = :pk',
      FilterExpression: '#ttl > :now',
      ExpressionAttributeNames: { '#ttl': 'TTL' },
      ExpressionAttributeValues: {
        ':pk': 'CLIENTRECORDS',
        ':now': nowEpoch,
        ...(prefix ? { ':prefix': prefix } : {})
      }
    }));

    const records = (result.Items || [])
      .map((item: any) => ({
        clientId: item.ClientId,
        cellId: item.CellId,
        region: item.Region,
        az: item.Az,
        lastSeen: item.LastSeen,
        // Ring position included here so the dashboard needs no extra
        // round-trips - same computation as ConsistentHash.hash
        hashValue: MD5(item.ClientId).words[0] >>> 0
      }))
      .sort((a: any, b: any) => (a.lastSeen < b.lastSeen ? 1 : -1));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ records, count: records.length, windowSeconds: LIVE_RECORD_TTL_SECONDS })
    };
  } catch (error) {
    console.error('Error getting live client records:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to get live client records' })
    };
  }
}

async function getRecentClients(headers: any): Promise<APIGatewayProxyResult> {
  try {
    // All client records share PK=CLIENTS, so a single partition query
    // retrieves them; recency is sorted in memory below.
    const scanResult = await dynamodb.send(new QueryCommand({
      TableName: CLIENT_TRACKING_TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': 'CLIENTS'
      },
      ScanIndexForward: false,
      Limit: 100
    }));

    // Sort by LastConnectTime and get the 10 most recent
    const clients = (scanResult.Items || [])
      .sort((a: any, b: any) => new Date(b.LastConnectTime).getTime() - new Date(a.LastConnectTime).getTime())
      .slice(0, 10);

    // Group by cell for pie chart
    const cellClients: { [cellId: string]: string[] } = {};
    clients.forEach((client: any) => {
      if (!cellClients[client.CellId]) {
        cellClients[client.CellId] = [];
      }
      cellClients[client.CellId].push(client.ClientId);
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        recentClients: clients.map((c: any) => c.ClientId),
        cellClients,
        clients: clients.map((c: any) => ({
          clientId: c.ClientId,
          cellId: c.CellId,
          lastConnectTime: c.LastConnectTime,
          firstConnectTime: c.FirstConnectTime,
          connectCount: c.ConnectCount || 1
        }))
      })
    };
  } catch (error) {
    console.error('Error getting recent clients:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to get recent clients' })
    };
  }
}

async function getClientsByCell(event: APIGatewayProxyEvent, headers: any): Promise<APIGatewayProxyResult> {
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
      TableName: CLIENT_TRACKING_TABLE,
      IndexName: 'CellId-LastConnectTime-index',
      KeyConditionExpression: 'CellId = :cellId',
      ExpressionAttributeValues: {
        ':cellId': cellId
      },
      ScanIndexForward: false, // Most recent first
      Limit: 5
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        cellId,
        clients: (result.Items || []).map((item: any) => ({
          clientId: item.ClientId,
          lastConnectTime: item.LastConnectTime,
          firstConnectTime: item.FirstConnectTime,
          connectCount: item.ConnectCount || 1,
          ip: item.IP
        }))
      })
    };
  } catch (error) {
    console.error('Error getting clients by cell:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to get clients for cell' })
    };
  }
}

async function getClientCountByCell(event: APIGatewayProxyEvent, headers: any): Promise<APIGatewayProxyResult> {
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
      TableName: CLIENT_TRACKING_TABLE,
      IndexName: 'CellId-LastConnectTime-index',
      KeyConditionExpression: 'CellId = :cellId',
      ExpressionAttributeValues: {
        ':cellId': cellId
      },
      Select: 'COUNT'
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        cellId,
        count: result.Count || 0
      })
    };
  } catch (error) {
    console.error('Error getting client count by cell:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to get client count for cell' })
    };
  }
}