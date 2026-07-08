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
| `backend/lambda/` | Lambda handlers (routing, admin, cell info/health, client tracking, registration, QR, Route 53 info, cross-region sync) |
| `backend/lib/consistent-hash.ts` | **The shared core.** MD5 hash ring with virtual nodes. Used by the backend, the admin dashboard, and the site |
| `frontend/spa/` | Per-cell page (React + webpack) |
| `frontend/admin/` | Admin dashboard (React + webpack, recharts) |
| `frontend/router/` | Static router pages (`index.html`, `auto.html`) deployed to the admin bucket |
| `infrastructure/templates/` | Live templates only: `global-resources.yaml`, `routing-layer.yaml`, `cell-template.yaml` |
| `infrastructure/scripts/` | `deploy.sh`, `deploy-frontend.sh`, `cleanup.sh` |
| `tests/` | Playwright E2E suite, parameterized by env vars (`tests/tests/config.ts`) |

## Build & test commands

```bash
npm run build            # root: backend + spa + admin + site
cd backend && npm run build && npm test    # tsc + jest (hash-ring unit tests)
cd frontend/spa && npm run build           # webpack; reads CELL_API_URL, ADMIN_URL
cd frontend/admin && npm run build         # webpack; reads ADMIN_API_URL
cd site && npm run build                   # webpack; fully static output in site/dist
cd site && npm run dev                     # dev server for the educational site
# site builds standalone (no backend install needed); root vercel.json deploys
# only site/ for quick review — the AWS demo is never part of that deploy
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
- **CloudFront certificates must live in us-east-1.** `cell-template.yaml`
  creates its ACM cert in the stack's own region, so custom domains only
  validate for us-east-1 cells; other regions fall back to the CloudFront URL.
- **The failover demo is a simulation** (labeled as such in the UI). Don't wire
  it to fake network calls; real failover is Route 53 health checks.
- AWS deployment can't be verified in CI (no credentials) — builds and unit
  tests are the automated gate; E2E tests skip when endpoint env vars are unset.

## Docs

- `README.md` — overview + repo layout (start here)
- `QUICKSTART.md` — AWS deployment walkthrough
- `API_REFERENCE.md` — endpoint map (keep in sync with the lambda handlers)
- `DEMO_SCRIPT.md` — 20-minute live-presentation script; the narrative source
  for the sections in `site/`
