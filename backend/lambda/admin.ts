import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  ScanCommand, 
  GetCommand,
  PutCommand,
  UpdateCommand 
} from '@aws-sdk/lib-dynamodb';
import { ConsistentHash, Cell } from '../lib/consistent-hash';

const client = new DynamoDBClient({});
const ddbDoc = DynamoDBDocumentClient.from(client);

const CELL_REGISTRY_TABLE = process.env.CELL_REGISTRY_TABLE!;
const CUSTOM_DOMAIN = process.env.CUSTOM_DOMAIN || '';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const path = event.path;
    const method = event.httpMethod;

    if (path === '/admin/cells' && method === 'GET') {
      return await handleGetCells();
    } else if (path?.startsWith('/admin/cells/') && method === 'PUT') {
      return await handleUpdateCell(event);
    } else if (path === '/admin/hash-ring' && method === 'GET') {
      return await handleGetHashRing();
    } else if (path?.startsWith('/admin/client-route/') && method === 'GET') {
      return await handleGetClientRoute(event);
    } else if (path === '/admin/cell-urls' && method === 'GET') {
      return await handleGetCellUrls();
    } else if (path === '/admin/recent-clients' && method === 'GET') {
      return await handleGetRecentClients();
    } else if (path?.startsWith('/admin/regions/') && method === 'PUT') {
      return await handleUpdateRegionCells(event);
    }

    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'Not found' })
    };
  } catch (error) {
    console.error('Error in admin handler:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

async function handleGetCells() {
  const scanResult = await ddbDoc.send(new ScanCommand({
    TableName: CELL_REGISTRY_TABLE
  }));

  const cells = (scanResult.Items || []) as Cell[];
  
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      cells: cells.sort((a, b) => a.cellId.localeCompare(b.cellId)),
      count: cells.length,
      activeCount: cells.filter(c => c.active).length
    })
  };
}

async function handleUpdateCell(event: any) {
  const cellId = event.pathParameters?.cellId;
  const body = JSON.parse(event.body || '{}');

  if (!cellId) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'cellId is required' })
    };
  }

  await ddbDoc.send(new UpdateCommand({
    TableName: CELL_REGISTRY_TABLE,
    Key: { cellId },
    UpdateExpression: 'SET #active = :active, #weight = :weight, #updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#active': 'active',
      '#weight': 'weight',
      '#updatedAt': 'updatedAt'
    },
    ExpressionAttributeValues: {
      ':active': body.active ?? true,
      ':weight': body.weight ?? 1,
      ':updatedAt': new Date().toISOString()
    }
  }));

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({ message: 'Cell updated successfully' })
  };
}

async function handleGetHashRing() {
  const scanResult = await ddbDoc.send(new ScanCommand({
    TableName: CELL_REGISTRY_TABLE
  }));

  const cells = (scanResult.Items || []) as Cell[];
  const activeCells = cells.filter(cell => cell.active);

  const consistentHash = new ConsistentHash();
  consistentHash.rebuildFromCells(activeCells);

  const distribution = consistentHash.getCellDistribution();
  const visualization = consistentHash.getRingVisualization();

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      distribution: Array.from(distribution.entries()).map(([cellId, count]) => ({
        cellId,
        virtualNodes: count,
        percentage: (count / visualization.length) * 100
      })),
      ring: visualization,
      totalVirtualNodes: visualization.length
    })
  };
}

async function handleGetClientRoute(event: any) {
  const clientId = event.pathParameters?.clientId;

  if (!clientId) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'clientId is required' })
    };
  }

  const scanResult = await ddbDoc.send(new ScanCommand({
    TableName: CELL_REGISTRY_TABLE
  }));

  const cells = (scanResult.Items || []) as Cell[];
  const activeCells = cells.filter(cell => cell.active);

  const consistentHash = new ConsistentHash();
  consistentHash.rebuildFromCells(activeCells);
  
  const targetCell = consistentHash.getCell(clientId);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      clientId,
      targetCell,
      hashValue: require('crypto').createHash('md5').update(clientId).digest().readUInt32BE(0)
    })
  };
}

async function handleGetCellUrls() {
  const scanResult = await ddbDoc.send(new ScanCommand({
    TableName: CELL_REGISTRY_TABLE
  }));

  const cells = (scanResult.Items || []) as Cell[];
  const activeCells = cells.filter(cell => cell.active);

  const cellUrls = activeCells.map(cell => {
    const baseUrl = CUSTOM_DOMAIN 
      ? `https://cell-${cell.cellId}.${CUSTOM_DOMAIN}`
      : `https://${cell.cellId}-cloudfront-url.cloudfront.net`;
    
    const routingUrl = CUSTOM_DOMAIN 
      ? `https://cellapi.${CUSTOM_DOMAIN}/route/`
      : `https://api-gateway-url.execute-api.${cell.region}.amazonaws.com/prod/route/`;

    return {
      cellId: cell.cellId,
      region: cell.region,
      availabilityZone: cell.availabilityZone,
      directUrl: baseUrl,
      routingUrl: routingUrl,
      weight: cell.weight,
      active: cell.active
    };
  });

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      cellUrls,
      customDomain: CUSTOM_DOMAIN,
      totalCells: cellUrls.length
    })
  };
}

async function handleGetRecentClients() {
  // For now, return demo data. In production, this would fetch from a database
  const demoData = {
    'cell-1': ['client-001', 'client-037', 'client-102', 'client-089', 'client-156'],
    'cell-2': ['client-023', 'client-078', 'client-134', 'client-067', 'client-191'],
    'cell-3': ['client-045', 'client-112', 'client-088', 'client-203', 'client-156']
  };

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
    },
    body: JSON.stringify(demoData)
  };
}

async function handleUpdateRegionCells(event: any) {
  const region = event.pathParameters?.region;
  const body = JSON.parse(event.body || '{}');

  if (!region) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'region is required' })
    };
  }

  // Get all cells in the region
  const scanResult = await ddbDoc.send(new ScanCommand({
    TableName: CELL_REGISTRY_TABLE,
    FilterExpression: '#region = :region',
    ExpressionAttributeNames: {
      '#region': 'region'
    },
    ExpressionAttributeValues: {
      ':region': region
    }
  }));

  const cellsInRegion = scanResult.Items || [];
  
  if (cellsInRegion.length === 0) {
    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'No cells found in region' })
    };
  }

  // Update all cells in the region
  const updatePromises = cellsInRegion.map(cell => 
    ddbDoc.send(new UpdateCommand({
      TableName: CELL_REGISTRY_TABLE,
      Key: { cellId: cell.cellId },
      UpdateExpression: 'SET #active = :active, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#active': 'active',
        '#updatedAt': 'updatedAt'
      },
      ExpressionAttributeValues: {
        ':active': body.active ?? true,
        ':updatedAt': new Date().toISOString()
      }
    }))
  );

  await Promise.all(updatePromises);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({ 
      message: `Updated ${cellsInRegion.length} cells in region ${region}`,
      cellsUpdated: cellsInRegion.map(c => c.cellId)
    })
  };
}