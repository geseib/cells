# API Reference

Endpoint map for the deployed AWS demo. Two API surfaces exist:

- **Global routing API** (one, in us-east-1; stack `{project}-routing`) — routing
  decisions, admin operations, global client tracking. With a custom domain it
  is `https://api.{domain}`; otherwise the API Gateway URL from the stack's
  `RoutingApiEndpoint` output.
- **Cell API** (one per cell; stack `{project}-cell-{cellId}`) — the cell's own
  info, health, and visitor tracking. The cell SPA only ever talks to its own
  cell's API (fault isolation). URL comes from each cell stack's `ApiEndpoint`
  output.

All endpoints return JSON with permissive CORS headers.

## Global routing API

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | `/route/{clientId}` | `lambda/routing.ts` | Cell assignment for a client (consistent hash) |
| GET | `/go/{clientId}` | `lambda/auto-router.ts` | 302 redirect straight to the client's cell page |
| GET | `/admin/cells` | `lambda/admin.ts` | All registered cells from the registry |
| PUT | `/admin/cells/{cellId}` | `lambda/admin.ts` | Update a cell (`{"active": bool, "weight": number}`) |
| PUT | `/admin/regions/{region}` | `lambda/admin.ts` | Activate/deactivate every cell in a region |
| GET | `/admin/hash-ring` | `lambda/admin.ts` | Virtual-node distribution + ring positions |
| GET | `/admin/client-route/{clientId}` | `lambda/admin.ts` | Routing decision incl. raw hash value |
| GET | `/admin/cell-urls` | `lambda/admin.ts` | Direct/routing/API URLs for every cell (`apiUrl` comes from the cell's registration heartbeat) |
| POST | `/admin/failover/arm` | `lambda/failover-admin.ts` | Arm the REAL failover demo (`{primaryCellId, secondaryCellId}`): creates 2 Route 53 health checks + 2 `failover.{domain}` CNAMEs |
| POST | `/admin/failover/disarm` | `lambda/failover-admin.ts` | Idempotent teardown: sweeps all `failover.*` records (any type), then health checks (incl. tag-prefix orphan sweep) |
| GET | `/admin/failover/status` | `lambda/failover-admin.ts` | Armed state, checker observations, live records, both cells' health (fetched server-side), authoritative CNAME answer, accrued cost |
| GET | `/admin/failover/probe` | `lambda/failover-admin.ts` | Server-side proof: resolves the failover CNAME and fetches the winning cell's `/info` |
| POST | `/admin/failover/chaos` | `lambda/failover-admin.ts` | Proxy a chaos toggle to a cell's own `/chaos` server-side (`{cellId, enabled, durationMinutes?}`) — the browser never dials cell APIs |
| POST | `/track-client` | `lambda/client-tracking.ts` | Record a client visit (`{clientId, cellId, sourceIp}`) |
| GET | `/clients/records` | `lambda/client-tracking.ts` | All live clients seen anywhere in the last hour (feeds the admin ring); `?prefix=us-east-1#` filters by region, `?prefix=us-east-1#az1#` by cell |
| GET | `/clients` | `lambda/client-tracking.ts` | Recent clients across all cells |
| GET | `/clients/cell/{cellId}` | `lambda/client-tracking.ts` | Last 5 clients for one cell |
| GET | `/clients/count/cell/{cellId}` | `lambda/client-tracking.ts` | Client count for one cell |
| POST | `/qr-code` | `lambda/qr-generator.ts` | Generate a QR code (`{text, size}` → `{qrCodeUrl}` data URI) |
| GET | `/route53-info` | `lambda/route53-info.ts` | `failover.*` record sets (A + CNAME) from Route 53 (requires custom domain) |

### Example responses

`GET /admin/cells`
```json
{
  "cells": [
    {
      "cellId": "us-east-1-az1",
      "region": "us-east-1",
      "availabilityZone": "us-east-1a",
      "weight": 1,
      "active": true,
      "lastHeartbeat": "2026-01-01T10:00:00Z"
    }
  ],
  "count": 1
}
```

`GET /admin/hash-ring`
```json
{
  "distribution": [
    { "cellId": "us-east-1-az1", "virtualNodes": 150, "percentage": 50.0 }
  ],
  "ring": [
    { "position": 123456, "cellId": "us-east-1-az1", "region": "us-east-1", "az": "us-east-1a" }
  ],
  "totalVirtualNodes": 300
}
```

`GET /admin/client-route/{clientId}`
```json
{
  "clientId": "user123",
  "hashValue": 1792101289,
  "targetCell": {
    "cellId": "us-east-1-az1",
    "region": "us-east-1",
    "availabilityZone": "us-east-1a"
  }
}
```

### Failover demo (real when armed)

All `/admin/failover/*` routes except the chaos proxy return **503** until
`domainName`/`hostedZoneId` are configured. Health checks are paid hourly
(HTTPS + 10s interval ≈ $2.50/check/mo, pair ≈ $0.0068/hr) — always disarm
after a demo; disarm is idempotent and safe to call at any time.

`POST /admin/failover/arm` `{"primaryCellId": "...", "secondaryCellId": "..."}`
(422 until both cells' registration heartbeats have populated `apiUrl`)
```json
{
  "success": true,
  "armed": true,
  "failoverFqdn": "failover.cells.example.com",
  "primaryCellId": "us-east-1-az1",
  "secondaryCellId": "us-west-2-az1",
  "healthCheckIds": { "primary": "hc-id-1", "secondary": "hc-id-2" },
  "armedAt": "2026-01-01T10:00:00Z",
  "estimatedCost": { "ratePerHourUsd": 0.006849 }
}
```

`GET /admin/failover/status` (armed; unarmed is a cheap `{"armed": false, ...}`)
```json
{
  "armed": true,
  "failoverFqdn": "failover.cells.example.com",
  "armedAt": "2026-01-01T10:00:00Z",
  "primaryCellId": "us-east-1-az1",
  "secondaryCellId": "us-west-2-az1",
  "healthChecks": [
    { "cellId": "us-east-1-az1", "healthCheckId": "hc-id-1", "status": "unhealthy", "checkersReporting": 16, "healthyCount": 2, "sample": [] },
    { "cellId": "us-west-2-az1", "healthCheckId": "hc-id-2", "status": "healthy", "checkersReporting": 16, "healthyCount": 16, "sample": [] }
  ],
  "records": [
    { "name": "failover.cells.example.com.", "type": "CNAME", "ttl": 15, "values": ["abc.execute-api.us-east-1.amazonaws.com"], "setIdentifier": "primary", "failover": "PRIMARY", "healthCheckId": "hc-id-1" }
  ],
  "cellHealth": [
    { "cellId": "us-east-1-az1", "statusCode": 503, "status": "failing (chaos)", "chaos": { "enabled": true, "expiresAt": 1767261600000 } },
    { "cellId": "us-west-2-az1", "statusCode": 200, "status": "healthy", "chaos": { "enabled": false } }
  ],
  "dnsAnswer": { "value": "def.execute-api.us-west-2.amazonaws.com", "matchesCellId": "us-west-2-az1", "resolvedAt": "2026-01-01T10:42:00Z" },
  "estimatedCost": { "ratePerHourUsd": 0.006849, "armedMinutes": 42, "accruedUsd": 0.0048 }
}
```
`healthChecks` and `cellHealth` are arrays ordered primary-first. `cellHealth`
and `dnsAnswer` are gathered **server-side** each status call — the DNS answer
comes from Route 53's own `TestDNSAnswer` (authoritative, health-check-aware,
immune to resolver caching) — so the admin UI never dials cell APIs or
third-party DNS resolvers.

`GET /admin/failover/probe`
```json
{
  "armed": true,
  "fqdn": "failover.cells.example.com",
  "cnameTarget": "def.execute-api.us-west-2.amazonaws.com",
  "winningCellId": "us-west-2-az1",
  "cellInfo": { "cellId": "us-west-2-az1", "region": "us-west-2" },
  "resolvedAt": "2026-01-01T10:42:00Z",
  "note": "failover.cells.example.com has no regional custom domain, so direct HTTPS to it is impossible; the probe resolves the CNAME and fetches the winning cell's API host with matching SNI."
}
```

### Live client records

Every `/track-client` call (global or per-cell) also writes a fire-and-forget
record to the global tracking table in us-east-1 under a hierarchical key:

```
PK = CLIENTRECORDS
SK = {region}#{az}#{clientId}     e.g. us-east-1#az1#user123
```

Records carry a one-hour TTL; because DynamoDB TTL deletion lags, the query
also filters expired items so the window is exact. Cell writes are
best-effort telemetry — a cell keeps serving even if the global table is
unreachable.

## Cell API (per cell)

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | `/info` | `lambda/cell-info.ts` | Cell identity, request metadata, stats, current chaos state |
| GET | `/health` | `lambda/cell-health.ts` | Health checks (DynamoDB, memory, CPU); 503 when degraded **or chaos is active** |
| POST | `/chaos` | `lambda/cell-health.ts` | Chaos flag in the cell's own table (`{enabled, durationMinutes?}`, default 30 min, cap 120 — code-honored expiry) |
| GET | `/chaos` | `lambda/cell-health.ts` | Current chaos state (`{"chaos": {"enabled": false}}` when off/expired) |
| POST | `/track-client` | `lambda/client-tracking.ts` | Record a visit in the cell's own tracking table |
| GET | `/clients` | `lambda/client-tracking.ts` | Recent visitors to this cell |
| GET | `/clients/cell/{cellId}` | `lambda/client-tracking.ts` | Last 5 visitors (shape used by the cell SPA) |

`GET /health`
```json
{
  "cellId": "us-east-1-az1",
  "status": "healthy",
  "lastCheck": "2026-01-01T10:00:00Z",
  "checks": { "dynamodb": true, "memory": true, "cpu": true },
  "chaos": { "enabled": false },
  "memoryUsage": { "heapUsed": "24 MB", "heapTotal": "64 MB", "percentage": "37%" }
}
```

With an unexpired chaos flag (set via `POST /chaos` or the admin's
`/admin/failover/chaos` proxy), `/health` short-circuits to **503**:
```json
{
  "cellId": "us-east-1-az1",
  "status": "failing (chaos)",
  "checks": { "dynamodb": true, "memory": true, "cpu": true, "chaos": false },
  "chaos": { "enabled": true, "expiresAt": 1767261600000 }
}
```

## Consistent hashing

Routing is MD5-based: the first 4 bytes of `md5(clientId)`, read as an unsigned
big-endian 32-bit integer, place the client on a ring of virtual nodes
(150 × weight per cell). Implementation: `backend/lib/consistent-hash.ts` —
shared verbatim by the routing Lambda, the admin dashboard, and the educational
site in `site/`. Weights are fractional multipliers (1.0 = normal share).

## Frontend → API wiring

| Frontend | API it calls | How the URL is configured |
|----------|-------------|---------------------------|
| Admin dashboard (`frontend/admin`) | Global routing API | `ADMIN_API_URL` env at build time (webpack DefinePlugin) |
| Cell SPA (`frontend/spa`) | Its own cell's API only | `CELL_API_URL` env at build time; deploy-frontend.sh builds once per cell |
| Router pages (`frontend/router`) | Global routing API | `%%ROUTING_API_URL%%` substituted by deploy-frontend.sh |
