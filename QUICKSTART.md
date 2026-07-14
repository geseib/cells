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

- Educational site: `https://{siteDomainName}` — hosted on **Vercel**, not AWS:
  add the domain to your Vercel project and point the Route 53 record at
  Vercel per its instructions (the AWS stacks never touch the site)
- Admin dashboard + router pages: `https://admin.{domain}`
- Routing API: `https://api.{domain}`
- Every cell: `https://{cell-id}.{domain}`

The demo hangs everything under the `domainName` subdomain, so records like
`us-east-1-az1.cells.example.com` live in your parent hosted zone — no
delegation needed. CloudFront only accepts us-east-1 certificates, so cells
in other regions get theirs from a small `{project}-cert-{cellId}` stack that
deploy.sh creates in us-east-1 automatically (the DNS name itself is
region-agnostic).

**Limitation:** CloudFront only accepts ACM certificates from us-east-1, and
the cell template creates its certificate in the cell's own region — so cells
outside us-east-1 keep their CloudFront URLs (deploy.sh skips the domain for
them and says so). The failover demo's Route 53 record inspection also
requires a custom domain.

Finding your hosted zone ID:

```bash
aws route53 list-hosted-zones --query 'HostedZones[?Name==`example.com.`].Id' --output text
```

## Single-hostname mode (optional)

If you demo to audiences behind restrictive corporate proxies, many
hostnames (`admin.…`, `api.…`, one per cell, raw `*.execute-api.…` hosts)
are a problem — each needs allowlisting. Single-hostname "edge mode" puts
every audience-facing endpoint behind **one** DNS name:

1. Requires the custom-domain setup above (`domainName` + `hostedZoneId`).
2. Set `"edgeDomain": "go"` (any subdomain label) in `config.json`.
3. Re-run `./setup.sh`. deploy.sh deploys `infrastructure/templates/demo-edge.yaml`
   as `{project}-edge` in us-east-1 after the cell stacks (it reads each
   cell's CloudFront domain and API endpoint from stack outputs; the
   template has slots for up to 8 cells), and deploy-frontend.sh rebuilds
   the frontends in edge mode (`%%EDGE_MODE%%=true`, QR card pointing at
   the edge hostname).

Give the audience `https://go.{domainName}` (or the QR code on the admin
dashboard): the router page is the default root, the routing API is at
`/api/*`, and each cell is at `/{cellId}/` with its API at `/{cellId}/api/*`.
One name to allowlist.

**Trade-off, stated honestly:** this bolts a shared component in front of
all client traffic — it is exactly the "central router" topology the demo's
trade-offs discussion argues against, accepted deliberately for demo
convenience. Cells stay isolated from each other behind it (each
`/{cellId}/api/*` route reaches only that cell's own API), but the edge
distribution itself is a single shared failure point for audience access.

`infrastructure/scripts/smoke-test.sh` checks the edge paths automatically
when `edgeDomain` is set, and skips them cleanly when it isn't.

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

## Auto-deploy (GitHub Actions)

Pushes to `main` deploy automatically:

- **Educational site** → Vercel builds `site/` on every push (root `vercel.json`).
  One-time: import the repo in Vercel, set env `DEMO_ADMIN_URL`, add your
  `siteDomainName` as the project domain.
- **AWS demo** → `.github/workflows/deploy-aws.yml` runs deploy.sh,
  deploy-frontend.sh, and smoke-test.sh on any push touching `backend/`,
  `frontend/`, or `infrastructure/`. One-time bootstrap:

  ```bash
  cd infrastructure/scripts
  sam deploy --template-file ../templates/github-oidc-role.yaml \
    --stack-name my-cell-demo-github-deploy --region us-east-1 \
    --capabilities CAPABILITY_NAMED_IAM \
    --parameter-overrides GitHubOrg=YOUR_ORG GitHubRepo=YOUR_REPO ProjectName=my-cell-demo
  ```

  Then add two repo secrets (Settings → Secrets and variables → Actions):
  `AWS_DEPLOY_ROLE_ARN` (the stack's `DeployRoleArn` output) and
  `CELLS_CONFIG_JSON` (the full contents of your `config.json`). Until the
  secrets exist the workflow skips itself and stays green.
