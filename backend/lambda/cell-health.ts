import { APIGatewayProxyHandler, ScheduledHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const ddbDoc = DynamoDBDocumentClient.from(client);

const CELL_ID = process.env.CELL_ID!;
const CELL_DATA_TABLE = process.env.CELL_DATA_TABLE!;

// Chaos flag: lives in the CELL'S OWN table (pk='CHAOS', sk=CELL_ID) so cell
// isolation is preserved — no other cell or global table is involved. The
// expiry is code-honored (the table has no TTL spec): a forgotten flag can
// never wedge a cell for longer than CHAOS_MAX_MINUTES.
export const CHAOS_DEFAULT_MINUTES = 30;
export const CHAOS_MAX_MINUTES = 120;

export interface ChaosItem {
  pk: 'CHAOS';
  sk: string;
  enabled: boolean;
  expiresAt: number; // epoch millis
  setAt: string;
}

export function computeChaosExpiresAt(durationMinutes?: number, nowMs: number = Date.now()): number {
  const requested = typeof durationMinutes === 'number' && durationMinutes > 0
    ? durationMinutes
    : CHAOS_DEFAULT_MINUTES;
  const minutes = Math.min(requested, CHAOS_MAX_MINUTES);
  return nowMs + minutes * 60_000;
}

export function isChaosActive(item: Partial<ChaosItem> | undefined, nowMs: number = Date.now()): boolean {
  return !!item && item.enabled === true && typeof item.expiresAt === 'number' && item.expiresAt > nowMs;
}

async function readChaosItem(): Promise<ChaosItem | undefined> {
  const result = await ddbDoc.send(new GetCommand({
    TableName: CELL_DATA_TABLE,
    Key: { pk: 'CHAOS', sk: CELL_ID }
  }));
  return result.Item as ChaosItem | undefined;
}

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'X-Cell-ID': CELL_ID
};

async function handleChaosRoute(event: any): Promise<any> {
  if (event.httpMethod === 'POST') {
    let body: any = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ error: 'Request body must be JSON' })
      };
    }

    if (body.enabled === true) {
      const expiresAt = computeChaosExpiresAt(body.durationMinutes);
      await ddbDoc.send(new PutCommand({
        TableName: CELL_DATA_TABLE,
        Item: {
          pk: 'CHAOS',
          sk: CELL_ID,
          enabled: true,
          expiresAt,
          setAt: new Date().toISOString()
        }
      }));
      return {
        statusCode: 200,
        headers: jsonHeaders,
        body: JSON.stringify({ cellId: CELL_ID, chaos: { enabled: true, expiresAt } })
      };
    }

    await ddbDoc.send(new DeleteCommand({
      TableName: CELL_DATA_TABLE,
      Key: { pk: 'CHAOS', sk: CELL_ID }
    }));
    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({ cellId: CELL_ID, chaos: { enabled: false } })
    };
  }

  // GET /chaos — current state (expired item reads as disabled)
  const item = await readChaosItem();
  const active = isChaosActive(item);
  return {
    statusCode: 200,
    headers: jsonHeaders,
    body: JSON.stringify({
      cellId: CELL_ID,
      chaos: active ? { enabled: true, expiresAt: item!.expiresAt } : { enabled: false }
    })
  };
}

const healthStatus = {
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
  const isApiEvent = !isScheduledEvent && typeof event.httpMethod === 'string';

  try {
    if (isApiEvent && event.path?.endsWith('/chaos')) {
      return await handleChaosRoute(event);
    }

    // Chaos short-circuit: an unexpired CHAOS item makes /health fail on
    // demand — this is what trips the armed Route 53 failover demo. Scheduled
    // runs record the degraded status in history too (honest telemetry).
    let chaosItem: ChaosItem | undefined;
    try {
      chaosItem = await readChaosItem();
    } catch (error) {
      console.error('Chaos flag read failed (treating as disabled):', error);
    }

    if (isChaosActive(chaosItem)) {
      const chaosBody = {
        cellId: CELL_ID,
        status: 'failing (chaos)',
        lastCheck: new Date().toISOString(),
        checks: { dynamodb: true, memory: true, cpu: true, chaos: false },
        chaos: { enabled: true, expiresAt: chaosItem!.expiresAt }
      };

      if (isScheduledEvent) {
        await ddbDoc.send(new PutCommand({
          TableName: CELL_DATA_TABLE,
          Item: {
            pk: 'HEALTH_HISTORY',
            sk: `${CELL_ID}#${Date.now()}`,
            ...chaosBody,
            ttl: Math.floor(Date.now() / 1000) + 86400 // 24 hour TTL
          }
        }));
        return { statusCode: 200, body: '' };
      }

      return {
        statusCode: 503,
        headers: jsonHeaders,
        body: JSON.stringify(chaosBody)
      };
    }

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
      headers: jsonHeaders,
      body: JSON.stringify({
        cellId: CELL_ID,
        ...healthStatus,
        chaos: { enabled: false },
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
