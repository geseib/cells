import { DynamoDBStreamHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const TARGET_REGIONS = (process.env.TARGET_REGIONS || '').split(',').filter(r => r);
const CELL_REGISTRY_TABLE = process.env.CELL_REGISTRY_TABLE!;
const CURRENT_REGION = process.env.AWS_REGION!;

export const handler: DynamoDBStreamHandler = async (event) => {
  console.log(`Processing ${event.Records.length} stream records`);
  
  for (const record of event.Records) {
    if (record.eventName === 'INSERT' || record.eventName === 'MODIFY') {
      const newImage = record.dynamodb?.NewImage;
      if (newImage) {
        const item = unmarshall(newImage as any);
        
        for (const targetRegion of TARGET_REGIONS) {
          if (targetRegion !== CURRENT_REGION) {
            try {
              const client = new DynamoDBClient({ region: targetRegion });
              const ddbDoc = DynamoDBDocumentClient.from(client);
              
              await ddbDoc.send(new PutCommand({
                TableName: CELL_REGISTRY_TABLE,
                Item: {
                  ...item,
                  syncedFrom: CURRENT_REGION,
                  syncedAt: new Date().toISOString()
                }
              }));
              
              console.log(`Synced cell ${item.cellId} to ${targetRegion}`);
            } catch (error) {
              console.error(`Failed to sync to ${targetRegion}:`, error);
            }
          }
        }
      }
    } else if (record.eventName === 'REMOVE') {
      console.log('Cell removed - consider implementing deletion sync');
    }
  }
  
  return { batchItemFailures: [] };
};