import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ConsistentHash, Cell } from '../lib/consistent-hash';

const client = new DynamoDBClient({});
const ddbDoc = DynamoDBDocumentClient.from(client);

const CELL_REGISTRY_TABLE = process.env.CELL_REGISTRY_TABLE!;

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
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

    if (activeCells.length === 0) {
      return {
        statusCode: 503,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'No active cells available' })
      };
    }

    const consistentHash = new ConsistentHash();
    consistentHash.rebuildFromCells(activeCells);
    
    const targetCell = consistentHash.getCell(clientId);
    
    if (!targetCell) {
      return {
        statusCode: 503,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Unable to route client' })
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        clientId,
        routedTo: {
          cellId: targetCell.cellId,
          region: targetCell.region,
          availabilityZone: targetCell.availabilityZone
        },
        timestamp: new Date().toISOString()
      })
    };
  } catch (error) {
    console.error('Error in routing handler:', error);
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