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
| POST | `/admin/quorum/arm` | `lambda/failover-admin.ts` | Arm the quorum demo (`{threshold?}`, default 3): 5 vote items ON, 5 HTTPS checkers against `/vote-status/{i}`, 1 CALCULATED parent |
| POST | `/admin/quorum/disarm` | `lambda/failover-admin.ts` | Idempotent teardown: restore wired record, parent first, then children, `{project}-quorum-*` tag sweep, vote/log items, state |
| GET | `/admin/quorum/status` | `lambda/failover-admin.ts` | Voters, computed parent, stored control + versioned decision log, wire truth, honest two-component cost |
| POST | `/admin/quorum/vote` | `lambda/failover-admin.ts` | Flip a vote (`{i, on}`) — creates/deletes the `QUORUM_VOTE#{i}` item the checkers observe |
| POST | `/admin/quorum/break-voter` | `lambda/failover-admin.ts` | Simulate a voter fault (`{i, broken}`) — separate `QUORUM_BROKEN#{i}` item; `/vote-status/{i}` answers 500 |
| POST | `/admin/quorum/wire` | `lambda/failover-admin.ts` | Point the PRIMARY failover record's HealthCheckId at the quorum parent (`{on}`; requires the failover demo armed) |
| GET | `/vote-status/{i}` | `lambda/failover-admin.ts` | **Public checker target**: 200 vote-on / 503 vote-off / 500 broken / 404 bad index |
| POST | `/admin/idem/pay` | `lambda/idem-admin.ts` | Proxy a payment to a region's idem API server-side (`{region, orderId, amount, mode}`) |
| GET | `/admin/idem/status` | `lambda/idem-admin.ts` | Per-region idem health + shared/isolated/charge records (arrays), replicated badges |
| POST | `/admin/idem/chaos` | `lambda/idem-admin.ts` | Proxy a region kill-switch toggle to that region's idem API server-side |
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

### Quorum demo (real when armed)

A Route 53 **CALCULATED health check is the consensus evaluator**: five HTTPS
"reverse" health checks each observe one vote flag (an item in the
routing-config table, served by the public `GET /vote-status/{i}`), and the
CALCULATED parent with `HealthThreshold` over those five children decides.
The demo works **without a custom domain** (checkers hit the API Gateway
hostname); only `/admin/quorum/wire` needs the hosted zone. Every status
collection is an **array, never a keyed object**.

Armed cost is honestly **two components** — the checks (5 × HTTPS
fast-interval ≈ $2.50/mo + $1/mo calculated ≈ **$0.0185/hr**) plus the checker
**traffic** (~27,000 requests/hr against the routing API ≈ **$0.095/hr**) —
about **$0.12/hr total**. Always disarm after a demo; disarm is idempotent.

`POST /admin/quorum/arm` `{"threshold": 3}` (optional, default 3, 1–5)
```json
{
  "success": true,
  "armed": true,
  "threshold": 3,
  "voterHealthCheckIds": ["hc-v1", "hc-v2", "hc-v3", "hc-v4", "hc-v5"],
  "parentHealthCheckId": "hc-parent",
  "voteStatusUrl": "https://api.cells.example.com/vote-status/{i}",
  "armedAt": "2026-01-01T10:00:00Z",
  "storedControl": { "on": false, "version": 126, "since": "2026-01-01T10:00:00Z" },
  "estimatedCost": { "healthChecksPerHourUsd": 0.0185, "checkerTrafficPerHourUsd": 0.0945, "ratePerHourUsd": 0.113 }
}
```
The decision log seeds at **v126 ("Routing = Disabled")**; the first
checker-confirmed quorum commits v127 for real.

`GET /admin/quorum/status` (armed; unarmed is a cheap `{"armed": false, "whatArmingCreates": {...}}`)
```json
{
  "armed": true,
  "threshold": 3,
  "armedAt": "2026-01-01T10:00:00Z",
  "voters": [
    { "i": 1, "on": true, "broken": false, "healthCheckId": "hc-v1", "status": "healthy", "healthyCount": 16, "checkersReporting": 16 },
    { "i": 2, "on": false, "broken": false, "healthCheckId": "hc-v2", "status": "unhealthy", "healthyCount": 0, "checkersReporting": 16 }
  ],
  "parent": {
    "healthCheckId": "hc-parent",
    "threshold": 3,
    "healthyChildren": 4,
    "status": "healthy",
    "computedFrom": "count(healthy children) >= threshold, computed from the child checks' checker observations — Route 53 does not expose GetHealthCheckStatus for CALCULATED health checks"
  },
  "storedControl": { "on": true, "version": 127, "since": "2026-01-01T10:02:10Z" },
  "decisionLog": [
    { "version": 127, "decision": "on", "healthyChildren": 5, "threshold": 3, "at": "2026-01-01T10:02:10Z" },
    { "version": 126, "decision": "off", "healthyChildren": 0, "threshold": 3, "at": "2026-01-01T10:00:00Z" }
  ],
  "wire": { "wired": false, "failoverArmed": false, "recordHealthCheckId": null, "pointsAtParent": false },
  "voteStatusUrl": "https://api.cells.example.com/vote-status/{i}",
  "estimatedCost": { "healthChecksPerHourUsd": 0.0185, "checkerTrafficPerHourUsd": 0.0945, "ratePerHourUsd": 0.113, "armedMinutes": 12, "accruedUsd": 0.0226 }
}
```
The parent's status is **computed** (and labeled as such) because
`GetHealthCheckStatus` does not work on CALCULATED checks. `storedControl` is
the ARC lesson: a **versioned committed decision** that flips only on a
genuine parent transition — each flip appends a new `decisionLog` entry
(newest-first, capped at 20) rather than rewriting anything.
`wire.recordHealthCheckId` is read from the actual PRIMARY failover record,
not from stored state.

`POST /admin/quorum/vote` `{"i": 2, "on": false}` → `{"success": true, "i": 2, "on": false}`
(409 unless armed). `POST /admin/quorum/break-voter` `{"i": 4, "broken": true}`
is the separate fault flag — a broken voter answers 500 regardless of its vote.

`POST /admin/quorum/wire` `{"on": true}` (503 without a domain; 409 unless the
failover demo is armed)
```json
{ "success": true, "wired": true, "recordHealthCheckId": "hc-parent", "originalPrimaryHealthCheckId": "hc-fo-1" }
```
Wire swaps the PRIMARY `failover.{domain}` record's HealthCheckId for the
quorum parent, so the committed quorum decision drives real DNS failover;
`{"on": false}` (and quorum disarm) restores the original. A failover disarm
clears the wire state automatically.

`GET /vote-status/{i}` — the public checker target. `200 {"i":1,"vote":"on"}`
when the vote item exists, `503 {"i":1,"vote":"off"}` when it doesn't (also
the disarmed-at-rest answer), `500` while `QUORUM_BROKEN#{i}` exists, `404`
for indexes outside 1–5.

### Idempotency demo

Two per-region stacks (`{project}-idem-{region}`, deployed primary-first) run
a Python (Powertools) payment Lambda over a **shared DynamoDB global table**
(`{project}-idem-shared`) and a per-region isolated table
(`{project}-idem-local`). The admin routes proxy everything server-side —
the browser only talks to the routing API host. All record collections are
arrays. Routes return `{"configured": false, ...}` until deploy.sh has
written the `IDEM_ENDPOINTS` row (requires ≥ 2 regions in config).

`POST /admin/idem/pay` `{"region": "us-east-1", "orderId": "order-1", "amount": 42, "mode": "shared"}`
(`mode` is `shared` | `isolated`; 409 while the same payment is in flight)
```json
{
  "success": true,
  "orderId": "order-1",
  "amount": 42,
  "chargeId": "ch-8f3a...",
  "region": "us-east-1",
  "processedAt": "2026-01-01T10:00:00Z"
}
```
A deduped retry (same `orderId`+`amount`, shared mode, either region) returns
the **same `chargeId`** — and `region` still names the region that took the
original charge, which is the visual proof. There is no "idempotentHit" flag:
dedupe is proven by identical `chargeId` and by the real charge-row count.

`GET /admin/idem/status`
```json
{
  "configured": true,
  "regions": [
    { "region": "us-east-1", "apiUrl": "https://abc.execute-api.us-east-1.amazonaws.com/prod", "health": "healthy", "shared": [], "isolated": [], "charges": [] },
    { "region": "us-west-2", "apiUrl": "https://def.execute-api.us-west-2.amazonaws.com/prod", "health": "healthy", "shared": [], "isolated": [], "charges": [] }
  ],
  "sharedRecords": [
    { "id": "a1b2c3...", "orderId": "order-1", "replicated": true }
  ]
}
```
`regions` is primary-first; `sharedRecords[].replicated` is computed by
intersecting the two replicas' id sets. Powertools stores hashed idempotency
keys — the raw id plus parsed data appear in the under-the-covers panels.

`POST /admin/idem/chaos` `{"region": "us-east-1", "enabled": true}` — proxies
the region's kill switch (`KILL` item, code-honored expiry like the cells'
chaos flag) so "region A dies" is real for the retry demo.

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
