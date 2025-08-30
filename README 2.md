# AWS Cell-Based Architecture Demo

This project demonstrates a cell-based architecture implementation on AWS using serverless technologies. It showcases how to build resilient, scalable systems using consistent hashing for routing across multiple cells distributed across regions and availability zones.

## Architecture Overview

- **Cells**: Independent deployment units in specific regions and AZs
- **Consistent Hashing**: Deterministic routing of clients to cells
- **Multi-Region**: Support for deployment across multiple AWS regions
- **Serverless**: Built entirely with AWS serverless services

## Components

### Infrastructure
- **CloudFormation/SAM Templates**: Infrastructure as code for all resources
- **DynamoDB**: Cell registry and routing configuration storage
- **Lambda Functions**: Routing logic, cell management, and health checks
- **API Gateway**: RESTful APIs for routing and administration
- **S3 & CloudFront**: Static content hosting for SPAs

### Backend Services
- **Routing Service**: Determines which cell a client should connect to
- **Cell Registration**: Automatic cell registration with heartbeat
- **Health Monitoring**: Continuous health checks for each cell
- **Admin API**: Cell management and monitoring endpoints

### Frontend Applications
- **Cell SPA**: Displays cell information and health status
- **Admin Dashboard**: Monitors cells, visualizes hash ring distribution

## Prerequisites

- AWS CLI configured with appropriate credentials
- Node.js 18+ and npm
- SAM CLI
- An S3 bucket for SAM deployments

## Quick Start

### ⚡ Simple Setup (Recommended)

1. **Clone and configure**
   ```bash
   git clone <repository-url>
   cd cells
   cp config.example.json config.json
   # Edit config.json with your domain and SAM bucket
   ```

2. **Deploy everything**
   ```bash
   ./setup.sh
   ```

That's it! 🎉 See [QUICKSTART.md](QUICKSTART.md) for detailed instructions.

### 🔧 Manual Setup

1. **Install dependencies**
   ```bash
   npm install
   cd backend && npm install && cd ..
   cd frontend/spa && npm install && cd ../..
   cd frontend/admin && npm install && cd ../..
   ```

2. **Deploy infrastructure**
   ```bash
   export SAM_BUCKET=your-sam-bucket-name
   export DOMAIN_NAME=cells.example.com  # optional
   export HOSTED_ZONE_ID=Z1234567890ABC  # required if using custom domain
   cd infrastructure/scripts
   ./deploy.sh
   ```

3. **Deploy frontend applications**
   ```bash
   ./deploy-frontend.sh
   ```

## Deployment

### Environment Variables
- `SAM_BUCKET`: S3 bucket for SAM package uploads (required)
- `PROJECT_NAME`: Project name prefix (default: cell-demo)
- `REGIONS`: Comma-separated list of regions (default: us-east-1,us-west-2)
- `AZS_PER_REGION`: Number of AZs per region (default: 2)
- `DOMAIN_NAME`: Custom domain name (optional, e.g., cells.example.com)
- `HOSTED_ZONE_ID`: Route53 hosted zone ID for custom domain (required if DOMAIN_NAME is set)

### Full Deployment

**Basic deployment:**
```bash
cd infrastructure/scripts
SAM_BUCKET=your-bucket ./deploy.sh
./deploy-frontend.sh
```

**With custom domain:**
```bash
cd infrastructure/scripts
SAM_BUCKET=your-bucket \
DOMAIN_NAME=cells.example.com \
HOSTED_ZONE_ID=Z1234567890ABC \
./deploy.sh
./deploy-frontend.sh
```

**Custom Domain Setup:**
- Cells will be available at: `cell-{cell-id}.{domain}` (e.g., `cell-us-east-1-az1.sb.seibtribe.us`)
- Admin dashboard at: `celladmin.{domain}`
- Routing API at: `cellapi.{domain}`
- SSL certificates are automatically generated via ACM

### Cleanup
```bash
cd infrastructure/scripts
./cleanup.sh
```

## API Endpoints

### Routing API
- `GET /route/{clientId}` - Get cell assignment for a client

### Admin API
- `GET /admin/cells` - List all registered cells
- `PUT /admin/cells/{cellId}` - Update cell status
- `GET /admin/hash-ring` - Get hash ring visualization
- `GET /admin/client-route/{clientId}` - Test client routing
- `GET /admin/cell-urls` - Get all cell URLs and routing information
- `POST /qr-code` - Generate QR codes for URLs

### Cell API
- `GET /info` - Get cell information
- `GET /health` - Get cell health status

## How It Works

1. **Cell Registration**: Each cell registers itself in the global DynamoDB table with a heartbeat
2. **Consistent Hashing**: The routing function uses MD5 hashing to deterministically assign clients to cells
3. **Load Distribution**: Virtual nodes ensure even distribution across cells
4. **Failover**: Inactive cells are automatically excluded from routing decisions
5. **Monitoring**: Real-time health checks and admin dashboard for visibility

## Project Structure

```
cells/
├── backend/
│   ├── lambda/          # Lambda function handlers
│   ├── lib/             # Shared libraries (consistent hash)
│   └── package.json
├── frontend/
│   ├── spa/             # Cell information SPA
│   └── admin/           # Admin dashboard
├── infrastructure/
│   ├── templates/       # CloudFormation/SAM templates
│   └── scripts/         # Deployment scripts
└── README.md
```

## Testing

### Test Client Routing
```bash
# Get routing for a specific client
curl https://your-api-url/prod/route/client123

# Check cell health
curl https://your-cell-url/prod/health
```

### Admin Dashboard
Access the admin dashboard URL provided after deployment to:
- View all active cells
- Monitor hash ring distribution
- Test client routing
- Activate/deactivate cells
- View cell URLs with QR codes
- Direct access links to each cell
- Routing URL patterns for client redirection

## Security Considerations

- All APIs use HTTPS
- S3 buckets are configured with appropriate access policies
- IAM roles follow least privilege principle
- Cross-region access is controlled via specific IAM roles

## Cost Optimization

- DynamoDB uses on-demand billing
- Lambda functions are pay-per-use
- CloudFront uses PriceClass_100 for cost optimization
- S3 lifecycle policies can be added for log rotation

## Troubleshooting

1. **Deployment fails**: Ensure SAM_BUCKET exists and you have permissions
2. **Cells not registering**: Check Lambda logs in CloudWatch
3. **Routing errors**: Verify at least one cell is active in the admin dashboard
4. **Frontend not loading**: Check CloudFront distribution status

## Future Enhancements

- Auto-scaling based on load
- Custom domain names
- Enhanced monitoring with CloudWatch dashboards
- Integration with Route 53 for DNS-based routing
- Cell capacity management
- Automated failover testing