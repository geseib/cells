import { ScheduledHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

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
    const registrationData = {
      cellId: CELL_ID,
      region: CELL_REGION,
      availabilityZone: AVAILABILITY_ZONE,
      weight: CELL_WEIGHT,
      active: true,
      registeredAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + 600 // 10 minute TTL
    };

    await ddbDoc.send(new PutCommand({
      TableName: CELL_REGISTRY_TABLE,
      Item: registrationData
    }));

    console.log(`Cell ${CELL_ID} registered successfully`);
  } catch (error) {
    console.error('Error registering cell:', error);
  }
};