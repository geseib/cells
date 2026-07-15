import {
  Route53Client,
  ListResourceRecordSetsCommand,
  ResourceRecordSet
} from '@aws-sdk/client-route-53';

/**
 * Display shape shared by /route53-info and /admin/failover/status.
 */
export interface Route53Record {
  name: string;
  type: string;
  ttl?: number;
  values: string[];
  setIdentifier?: string;
  failover?: string;
  healthCheckId?: string;
}

/**
 * List every record set at failover.{domainName}, of ANY relevant type
 * (A and CNAME). Older experiments may have left A records at the name;
 * filtering to a single type would make them invisible to both the status
 * display and the disarm sweep. Raw ResourceRecordSets are returned so the
 * disarm path can build exact DELETE changes from them.
 *
 * A single page suffices: listing starts at the failover name with type A,
 * and CNAME sorts after A at the same name, so both types arrive together.
 */
export async function listFailoverRecordSets(
  route53: Route53Client,
  hostedZoneId: string,
  domainName: string
): Promise<ResourceRecordSet[]> {
  const failoverRecordName = `failover.${domainName}.`;

  const response = await route53.send(new ListResourceRecordSetsCommand({
    HostedZoneId: hostedZoneId,
    StartRecordName: `failover.${domainName}`,
    StartRecordType: 'A'
  }));

  return (response.ResourceRecordSets || []).filter((record) =>
    record.Name === failoverRecordName && (record.Type === 'A' || record.Type === 'CNAME')
  );
}

export function formatFailoverRecords(recordSets: ResourceRecordSet[]): Route53Record[] {
  return recordSets.map((record) => ({
    name: record.Name || '',
    type: record.Type || '',
    ttl: record.TTL,
    values: record.ResourceRecords?.map((rr) => rr.Value || '') || [],
    setIdentifier: record.SetIdentifier,
    failover: record.Failover,
    healthCheckId: record.HealthCheckId
  }));
}
