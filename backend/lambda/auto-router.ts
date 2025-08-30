import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ConsistentHash, Cell } from '../lib/consistent-hash';

const client = new DynamoDBClient({});
const ddbDoc = DynamoDBDocumentClient.from(client);

const CELL_REGISTRY_TABLE = process.env.CELL_REGISTRY_TABLE!;
const CUSTOM_DOMAIN = process.env.CUSTOM_DOMAIN || '';

export const handler = async (event: any): Promise<any> => {
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

    // Get all active cells
    const scanResult = await ddbDoc.send(new ScanCommand({
      TableName: CELL_REGISTRY_TABLE
    }));

    const cells = (scanResult.Items || []) as Cell[];
    const activeCells = cells.filter(cell => cell.active);

    if (activeCells.length === 0) {
      return {
        statusCode: 503,
        headers: {
          'Content-Type': 'text/html',
          'Access-Control-Allow-Origin': '*'
        },
        body: `
          <!DOCTYPE html>
          <html>
          <head><title>Service Unavailable</title></head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-align: center; padding: 2rem;">
            <h1>🚫 No Active Cells</h1>
            <p>All cells are currently unavailable. Please try again later.</p>
            <a href="https://celladmin.${CUSTOM_DOMAIN}" style="color: #007AFF;">View Admin Dashboard</a>
          </body>
          </html>
        `
      };
    }

    // Use consistent hashing to determine target cell
    const consistentHash = new ConsistentHash();
    consistentHash.rebuildFromCells(activeCells);
    
    const targetCell = consistentHash.getCell(clientId);
    
    if (!targetCell) {
      return {
        statusCode: 503,
        headers: {
          'Content-Type': 'text/html',
          'Access-Control-Allow-Origin': '*'
        },
        body: `
          <!DOCTYPE html>
          <html>
          <head><title>Routing Error</title></head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-align: center; padding: 2rem;">
            <h1>❌ Routing Failed</h1>
            <p>Unable to route client ${clientId} to a cell.</p>
            <a href="https://celladmin.${CUSTOM_DOMAIN}" style="color: #007AFF;">View Admin Dashboard</a>
          </body>
          </html>
        `
      };
    }

    // Build target URL
    const targetUrl = CUSTOM_DOMAIN 
      ? `https://cell-${targetCell.cellId}.${CUSTOM_DOMAIN}`
      : `https://${targetCell.cellId}.example.com`; // fallback

    // Return redirect response
    return {
      statusCode: 302,
      headers: {
        'Location': targetUrl,
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      },
      body: `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Redirecting to Cell</title>
          <meta http-equiv="refresh" content="0; url=${targetUrl}">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-align: center; padding: 2rem;">
          <h1>🔄 Routing to Cell</h1>
          <p>Redirecting ${clientId} to cell ${targetCell.cellId}...</p>
          <p><a href="${targetUrl}">Click here if not redirected automatically</a></p>
        </body>
        </html>
      `
    };

  } catch (error) {
    console.error('Error in auto-router:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': '*'
      },
      body: `
        <!DOCTYPE html>
        <html>
        <head><title>Server Error</title></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-align: center; padding: 2rem;">
          <h1>🔧 Server Error</h1>
          <p>An error occurred while routing your request.</p>
          <a href="https://celladmin.${CUSTOM_DOMAIN}" style="color: #007AFF;">View Admin Dashboard</a>
        </body>
        </html>
      `
    };
  }
};