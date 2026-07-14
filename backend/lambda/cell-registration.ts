import { ScheduledHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

// Cell registry table is always in us-east-1 (global region)
const client = new DynamoDBClient({ region: 'us-east-1' });
const ddbDoc = DynamoDBDocumentClient.from(client);

const CELL_ID = process.env.CELL_ID!;
const CELL_REGION = process.env.CELL_REGION!;
const AVAILABILITY_ZONE = process.env.AVAILABILITY_ZONE!;
const CELL_WEIGHT = parseFloat(process.env.CELL_WEIGHT || '1');
const CELL_REGISTRY_TABLE = process.env.CELL_REGISTRY_TABLE!;

export const handler: ScheduledHandler = async (event) => {
  try {
    const now = new Date().toISOString();

    // Heartbeat = an UPDATE, not a full-item Put: it must refresh liveness
    // (lastHeartbeat, ttl) and static facts (url, weight, AZ) WITHOUT
    // touching operator state. A Put here would reset `active: true` every
    // five minutes, silently undoing an admin's deactivate of a live cell.
    // `active` and `registeredAt` are only seeded on first registration.
    await ddbDoc.send(new UpdateCommand({
      TableName: CELL_REGISTRY_TABLE,
      Key: { cellId: CELL_ID },
      UpdateExpression:
        'SET #region = :region, availabilityZone = :az, #weight = :weight, ' +
        '#url = :url, lastHeartbeat = :hb, #ttl = :ttl, ' +
        '#active = if_not_exists(#active, :true), ' +
        'registeredAt = if_not_exists(registeredAt, :now)',
      ExpressionAttributeNames: {
        '#region': 'region',
        '#weight': 'weight',
        '#url': 'url',
        '#ttl': 'ttl',
        '#active': 'active'
      },
      ExpressionAttributeValues: {
        ':region': CELL_REGION,
        ':az': AVAILABILITY_ZONE,
        ':weight': CELL_WEIGHT,
        // The cell knows its own public URL (custom domain or CloudFront);
        // consumers must use this instead of deriving URLs from the cellId
        ':url': process.env.CELL_URL || '',
        ':hb': now,
        ':ttl': Math.floor(Date.now() / 1000) + 600, // 10 minute TTL
        ':true': true,
        ':now': now
      }
    }));

    console.log(`Cell ${CELL_ID} heartbeat recorded`);
  } catch (error) {
    console.error('Error registering cell:', error);
  }
};
