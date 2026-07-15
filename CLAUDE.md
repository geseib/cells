# CLAUDE.md

Educational project demonstrating **cell-based architecture**: partitioning a
workload into isolated cells with consistent-hash routing. Two deliverables:

1. `site/` — self-contained interactive teaching site (no AWS needed). This is
   the primary artifact.
2. The AWS demo (backend + frontends + infrastructure) — a real serverless
   implementation users can deploy to their own account. Chapter two.

## Project map

| Path | What it is |
|------|-----------|
| `site/` | Educational site: React + webpack, simulates the hash ring in-browser |
| `backend/lambda/` | Lambda handlers (routing, admin, failover admin, cell info/health, client tracking, registration, QR, Route 53 info, cross-region sync) |
| `backend/lib/consistent-hash.ts` | **The shared core.** MD5 hash ring with virtual nodes. Used by the backend, the admin dashboard, and the site |
| `frontend/spa/` | Per-cell page (React + webpack) |
| `frontend/admin/` | Admin dashboard (React + webpack, recharts) |
| `frontend/router/` | Static router pages (`index.html`, `auto.html`) deployed to the admin bucket |
| `infrastructure/templates/` | Live templates only: `global-resources.yaml`, `routing-layer.yaml`, `cell-template.yaml`, `cell-certificate.yaml`, `demo-edge.yaml` (optional single-hostname edge mode, enabled via `edgeDomain` in config), `github-oidc-role.yaml` (one-time bootstrap for the auto-deploy workflow) |
| `infrastructure/scripts/` | `deploy.sh`, `deploy-frontend.sh`, `smoke-test.sh` (post-deploy verification), `cleanup.sh` |
| `tests/` | Playwright E2E suite, parameterized by env vars (`tests/tests/config.ts`) |

## Build & test commands

```bash
npm run build            # root: backend + spa + admin + site
cd backend && npm run build && npm test    # tsc + jest (hash-ring unit tests)
cd frontend/spa && npm run build           # webpack; reads CELL_API_URL, ADMIN_URL
cd frontend/admin && npm run build         # webpack; reads ADMIN_API_URL
cd site && npm run build                   # webpack; fully static output in site/dist
cd site && npm run dev                     # dev server for the educational site
# site builds standalone (no backend install needed). Hosting is split:
# the site auto-deploys on VERCEL from GitHub (root vercel.json builds only
# site/; DEMO_ADMIN_URL + custom domain live in the Vercel project settings),
# and the AWS demo auto-deploys via .github/workflows/deploy-aws.yml (OIDC
# role from infrastructure/templates/github-oidc-role.yaml + two repo
# secrets). deploy.sh/deploy-frontend.sh never touch the site.
cd tests && npm test                       # Playwright; needs ADMIN_BASE_URL etc. or skips
```

## Deploy flow (AWS demo)

`cp config.example.json config.json` → edit → `./setup.sh`, which runs
`infrastructure/scripts/deploy.sh` (SAM: global stack, routing stack in
us-east-1, one cell stack per region×AZ) then `deploy-frontend.sh` (builds admin
once and the cell SPA **once per cell** with that cell's API endpoint injected;
sed-substitutes `%%ROUTING_API_URL%%` into the router pages).

`config.json` is **gitignored** — it holds account-specific values. Never commit
real account IDs, hosted zone IDs, domains, or API Gateway IDs anywhere;
`config.example.json` is the template.

Domain naming (all config-driven): educational site at `{siteDomainName}`
(e.g. `cellintro.example.com`), demo under `{domainName}` (e.g.
`cells.example.com`): `api.{domainName}`, `admin.{domainName}`,
`{cellId}.{domainName}`. Cell names keep the full cellId (region+AZ) because
region-only names can't distinguish the AZs.

## Invariants & gotchas

- **One hash implementation.** Client→cell mapping is MD5-first-4-bytes-BE over
  a virtual-node ring (`backend/lib/consistent-hash.ts`). The admin dashboard
  and `site/` must import/port this exact logic — never approximate it with a
  different hash, or the visualization will contradict real routing. A jest
  golden-value test anchors the algorithm.
- **Weights are fractional multipliers** (weight 1.0 → 150 virtual nodes).
  Never use `weight: 100`.
- **Cells are isolated.** A cell page/API must never call another cell's API or
  the global API at runtime — fault isolation is the lesson being taught.
  Client tracking goes to the cell's own `/track-client`.
- **CloudFront certificates must live in us-east-1** (the DNS name itself is
  region-agnostic). us-east-1 cells create their cert in-stack; for other
  regions deploy.sh creates a `{project}-cert-{cellId}` stack in us-east-1
  (`cell-certificate.yaml`) and passes the ARN via the cell template's
  `CertificateArn` parameter. Cells register their actual URL (`url` in the
  registry) — never derive a cell URL from its cellId.
- **The failover demo is REAL when armed.** Arm/disarm from the admin dashboard
  (`backend/lambda/failover-admin.ts`) creates/deletes actual Route 53 health
  checks and `failover.{domainName}` CNAMEs. **Never leave it armed** — health
  checks are paid hourly; disarm sweeps every `failover.*` record set (any
  type) and every health check tagged `{project}-failover-*`. The chaos flag
  lives in the cell's **own** table/API (`/chaos`, pk=`CHAOS`, code-honored
  expiry) so cell isolation holds. The browser talks **only to the API host**:
  the failover Lambda proxies chaos toggles and cell health reads server-side
  (control plane → cell, never cell → cell) — no new DNS names for an audience
  to allowlist.
- AWS deployment can't be verified in CI (no credentials) — builds and unit
  tests are the automated gate; E2E tests skip when endpoint env vars are unset.
  After a real deploy, run `infrastructure/scripts/smoke-test.sh`: it checks
  registration, hash-parity against the jest golden value, and per-cell APIs,
  then prints the env vars for the Playwright suite.

## Docs

- `README.md` — overview + repo layout (start here)
- `QUICKSTART.md` — AWS deployment walkthrough
- `API_REFERENCE.md` — endpoint map (keep in sync with the lambda handlers)
- `DEMO_SCRIPT.md` — 20-minute live-presentation script; the narrative source
  for the sections in `site/`
