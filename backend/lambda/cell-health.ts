import { APIGatewayProxyHandler, ScheduledHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const ddbDoc = DynamoDBDocumentClient.from(client);

const CELL_ID = process.env.CELL_ID!;
const CELL_DATA_TABLE = process.env.CELL_DATA_TABLE!;

let healthStatus = {
  status: 'healthy',
  lastCheck: new Date().toISOString(),
  checks: {
    dynamodb: true,
    memory: true,
    cpu: true
  }
};

export const handler = async (event: any): Promise<any> => {
  const isScheduledEvent = 'source' in event && event.source === 'aws.events';
  
  try {
    const memoryUsage = process.memoryUsage();
    // Use rss (Resident Set Size) vs the Lambda memory limit for more accurate health check
    const lambdaMemoryLimit = 512 * 1024 * 1024; // 512MB in bytes
    const memoryPercent = (memoryUsage.rss / lambdaMemoryLimit) * 100;
    
    healthStatus.checks.memory = memoryPercent < 80; // More conservative threshold
    
    try {
      await ddbDoc.send(new UpdateCommand({
        TableName: CELL_DATA_TABLE,
        Key: {
          pk: 'CELL_STATS',
          sk: CELL_ID
        },
        UpdateExpression: 'SET lastHealthCheck = :timestamp, #rc = if_not_exists(#rc, :zero) + :inc',
        ExpressionAttributeNames: {
          '#rc': 'requestCount'
        },
        ExpressionAttributeValues: {
          ':timestamp': new Date().toISOString(),
          ':zero': 0,
          ':inc': isScheduledEvent ? 0 : 1
        }
      }));
      healthStatus.checks.dynamodb = true;
    } catch (error) {
      console.error('DynamoDB health check failed:', error);
      healthStatus.checks.dynamodb = false;
    }
    
    healthStatus.status = Object.values(healthStatus.checks).every(check => check) ? 'healthy' : 'degraded';
    healthStatus.lastCheck = new Date().toISOString();
    
    if (isScheduledEvent) {
      await ddbDoc.send(new PutCommand({
        TableName: CELL_DATA_TABLE,
        Item: {
          pk: 'HEALTH_HISTORY',
          sk: `${CELL_ID}#${Date.now()}`,
          ...healthStatus,
          ttl: Math.floor(Date.now() / 1000) + 86400 // 24 hour TTL
        }
      }));
      
      return { statusCode: 200, body: '' };
    }
    
    return {
      statusCode: healthStatus.status === 'healthy' ? 200 : 503,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'X-Cell-ID': CELL_ID
      },
      body: JSON.stringify({
        cellId: CELL_ID,
        ...healthStatus,
        memoryUsage: {
          heapUsed: `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
          heapTotal: `${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
          rss: `${(memoryUsage.rss / 1024 / 1024).toFixed(2)} MB`,
          lambdaLimit: `${(lambdaMemoryLimit / 1024 / 1024).toFixed(0)} MB`,
          percentage: `${memoryPercent.toFixed(2)}%`
        }
      })
    };
  } catch (error) {
    console.error('Error in health check:', error);
    
    if (isScheduledEvent) {
      return { statusCode: 500, body: '' };
    }
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: 'Health check failed',
        cellId: CELL_ID 
      })
    };
  }
};