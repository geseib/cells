# API Reference

Endpoint map for the deployed AWS demo. Two API surfaces exist:

- **Global routing API** (one, in us-east-1; stack `{project}-routing`) — routing
  decisions, admin operations, global client tracking. With a custom domain it
  is `https://cellapi.{domain}`; otherwise the API Gateway URL from the stack's
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
| GET | `/admin/cell-urls` | `lambda/admin.ts` | Direct/routing URLs for every cell |
| POST | `/track-client` | `lambda/client-tracking.ts` | Record a client visit (`{clientId, cellId, sourceIp}`) |
| GET | `/clients` | `lambda/client-tracking.ts` | Recent clients across all cells (feeds the admin pie chart) |
| GET | `/clients/cell/{cellId}` | `lambda/client-tracking.ts` | Last 5 clients for one cell |
| GET | `/clients/count/cell/{cellId}` | `lambda/client-tracking.ts` | Client count for one cell |
| POST | `/qr-code` | `lambda/qr-generator.ts` | Generate a QR code (`{text, size}` → `{qrCodeUrl}` data URI) |
| GET | `/route53-info` | `lambda/route53-info.ts` | Failover record sets from Route 53 (requires custom domain) |

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

## Cell API (per cell)

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | `/info` | `lambda/cell-info.ts` | Cell identity, request metadata, stats |
| GET | `/health` | `lambda/cell-health.ts` | Health checks (DynamoDB, memory, CPU); 503 when degraded |
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
  "memoryUsage": { "heapUsed": "24 MB", "heapTotal": "64 MB", "percentage": "37%" }
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
