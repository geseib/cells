import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(client);
const CLIENT_TRACKING_TABLE = process.env.CLIENT_TRACKING_TABLE!;

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
  const { clientId, cellId, sourceIp } = body;

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

async function getRecentClients(headers: any): Promise<APIGatewayProxyResult> {
  try {
    // Get the 10 most recent clients across all cells
    const result = await dynamodb.send(new QueryCommand({
      TableName: CLIENT_TRACKING_TABLE,
      IndexName: 'LastConnectTime-index',
      KeyConditionExpression: 'LastConnectTime = :dummy',
      FilterExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': 'CLIENTS',
        ':dummy': 'dummy' // This won't match, but we'll scan instead
      },
      ScanIndexForward: false,
      Limit: 50
    }));

    // Since we can't easily query by LastConnectTime across all records,
    // let's do a scan with filter instead
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