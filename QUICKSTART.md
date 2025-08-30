# Quick Start Guide

Get your AWS Cell Architecture Demo up and running in minutes!

## Prerequisites

- AWS CLI configured with appropriate credentials
- Node.js 18+ and npm
- SAM CLI
- jq (for JSON parsing)

## Installation Steps

### 1. Clone and Setup
```bash
git clone <repository-url>
cd cells
```

### 2. Configure Your Deployment
```bash
# Copy the example configuration
cp config.example.json config.json

# Edit config.json with your settings
nano config.json
```

**Required Configuration:**
```json
{
  "projectName": "my-cell-demo",
  "samBucket": "my-sam-deployment-bucket",
  "domainName": "cells.example.com",
  "hostedZoneId": "Z1234567890ABC"
}
```

### 3. Deploy Everything
```bash
./setup.sh
```

That's it! 🎉

## What You Get

After deployment, you'll have:

- **Admin Dashboard**: `https://celladmin.{your-domain}`
- **Routing API**: `https://cellapi.{your-domain}`
- **Cell Sites**: `https://cell-{cell-id}.{your-domain}`

Example with `sb.seibtribe.us`:
- `https://celladmin.sb.seibtribe.us`
- `https://cellapi.sb.seibtribe.us`
- `https://cell-us-east-1-az1.sb.seibtribe.us`
- `https://cell-us-west-2-az1.sb.seibtribe.us`

## Configuration Options

### config.json Reference

```json
{
  "projectName": "cell-demo",           // AWS resource prefix
  "samBucket": "my-bucket",             // S3 bucket for deployments
  "domainName": "cells.example.com",    // Your custom domain
  "hostedZoneId": "Z123...",            // Route53 hosted zone ID
  "regions": ["us-east-1", "us-west-2"], // Deployment regions
  "azsPerRegion": 2,                    // AZs per region
  "deployment": {
    "autoCreateSamBucket": true,        // Auto-create SAM bucket
    "validateDomain": true              // Validate hosted zone
  }
}
```

### Without Custom Domain

If you don't have a custom domain, just leave `domainName` and `hostedZoneId` empty:

```json
{
  "projectName": "cell-demo",
  "samBucket": "my-sam-deployment-bucket",
  "domainName": "",
  "hostedZoneId": ""
}
```

## Finding Your Hosted Zone ID

If you have a domain in Route53:

```bash
aws route53 list-hosted-zones --query 'HostedZones[?Name==`example.com.`].Id' --output text
```

## Cleanup

To remove everything:
```bash
./infrastructure/scripts/cleanup.sh
```

## Troubleshooting

### Setup Script Fails
- Ensure AWS CLI is configured: `aws sts get-caller-identity`
- Check you have required tools: `sam --version`, `node --version`, `jq --version`

### Domain Not Working
- DNS propagation can take 10-15 minutes
- Verify your hosted zone ID is correct
- Check certificate validation in ACM console

### SAM Bucket Issues
- Bucket names must be globally unique
- Set `autoCreateSamBucket: false` if you want to create it manually

## Next Steps

1. Visit your admin dashboard to see the cell architecture
2. Test client routing with different client IDs
3. View QR codes for easy mobile access
4. Monitor cell health and distribution

For detailed documentation, see [README.md](README.md).