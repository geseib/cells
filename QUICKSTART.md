# Quick Start — deploying the AWS demo

This deploys the real cell architecture to your AWS account: a global routing
layer plus one isolated stack per cell. (To just *learn* the pattern, you don't
need any of this — open the interactive site in [`site/`](site/) instead.)

## Prerequisites

- AWS CLI configured with credentials (`aws sts get-caller-identity` works)
- SAM CLI (`sam --version`)
- Node.js 18+ and npm
- jq
- An S3 bucket for SAM deployment artifacts (or let setup create one)

## First deployment (no custom domain — recommended)

Start without a domain: everything runs on API Gateway and CloudFront URLs,
with no certificate-validation waits.

```bash
cp config.example.json config.json
```

Edit `config.json`:

```json
{
  "projectName": "cell-demo",
  "samBucket": "your-sam-deployment-bucket",
  "domainName": "",
  "hostedZoneId": "",
  "regions": ["us-east-1"],
  "azsPerRegion": 2,
  "deployment": {
    "autoCreateSamBucket": true,
    "validateDomain": false
  }
}
```

> `config.json` is gitignored — it holds your account-specific values.
> Add `"awsProfile": "your-profile"` under `deployment` if you use named profiles.
> Start with one region; add `"us-west-2"` later and re-run setup to scale out.

Then:

```bash
./setup.sh
```

What happens, in order (rough timings):

| Step | What | Time |
|------|------|------|
| 1 | Global stack (`{project}-global`): cell registry + tracking tables, event bus | ~2 min |
| 2 | Routing stack (`{project}-routing`, us-east-1): routing/admin Lambdas, API, admin bucket + CloudFront | ~5 min |
| 3 | One cell stack per region×AZ: S3 + CloudFront + API + Lambdas + DynamoDB | ~5–8 min each |
| 4 | Frontend deploy: admin dashboard once, cell SPA built **per cell** with that cell's API injected, router pages with the routing API substituted | ~2 min/cell |

Cells self-register on a 5-minute schedule — the admin dashboard may be empty
for the first few minutes after deploy. That's normal.

## Verify the deployment

```bash
./infrastructure/scripts/smoke-test.sh
```

This polls until cells register, verifies the deployed hash ring returns the
same golden value as the unit tests (`md5("user123") → 1792101289`), checks
every cell's `/info`, `/health`, and per-cell client tracking, and prints the
exact env-var line to run the Playwright E2E suite:

```bash
cd tests && ADMIN_BASE_URL=... ROUTING_API_URL=... CELL_URLS=... CELL_API_URLS=... npm test
```

## Adding custom domains (second pass)

Set `domainName` (e.g. `cells.example.com`), optionally `siteDomainName`
(e.g. `cellintro.example.com`), and `hostedZoneId` in `config.json`, then
re-run `./setup.sh`. You get:

- Educational site: `https://{siteDomainName}` (own S3+CloudFront stack)
- Admin dashboard + router pages: `https://admin.{domain}`
- Routing API: `https://api.{domain}`
- Cells **in us-east-1**: `https://{cell-id}.{domain}`

The demo hangs everything under the `domainName` subdomain, so records like
`us-east-1-az1.cells.example.com` live in your parent hosted zone — no
delegation needed.

**Limitation:** CloudFront only accepts ACM certificates from us-east-1, and
the cell template creates its certificate in the cell's own region — so cells
outside us-east-1 keep their CloudFront URLs (deploy.sh skips the domain for
them and says so). The failover demo's Route 53 record inspection also
requires a custom domain.

Finding your hosted zone ID:

```bash
aws route53 list-hosted-zones --query 'HostedZones[?Name==`example.com.`].Id' --output text
```

## Cleanup

```bash
./infrastructure/scripts/cleanup.sh
```

Deletes cell stacks (emptying their buckets first), then the routing and
global stacks.

## Troubleshooting

- **Setup fails immediately** — check `aws sts get-caller-identity`,
  `sam --version`, `jq --version`; ensure the SAM bucket name is globally
  unique or set `autoCreateSamBucket: false` and create it yourself.
- **Admin dashboard shows no cells** — wait 5 minutes (registration schedule),
  then check CloudWatch logs for `{project}-{cellId}-registration`.
- **Smoke test hash-parity failure** — the deployed Lambda bundle is stale;
  re-run `cd backend && npm run build` and redeploy (the build step installs
  runtime deps into `backend/dist/`).
- **Custom domain not resolving** — DNS + certificate validation can take
  10–15 minutes; check the certificate status in ACM (us-east-1).
