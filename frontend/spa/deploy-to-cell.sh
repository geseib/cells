#!/bin/bash
set -e

CELL_ID=$1
API_URL=$2
S3_BUCKET=$3
AWS_PROFILE=${4:-default}

if [ -z "$CELL_ID" ] || [ -z "$API_URL" ] || [ -z "$S3_BUCKET" ]; then
    echo "Usage: $0 <cell-id> <api-url> <s3-bucket> [aws-profile]"
    exit 1
fi

echo "Deploying SPA for cell: $CELL_ID"
echo "API URL: $API_URL"
echo "S3 Bucket: $S3_BUCKET"

# Build with environment variable
REACT_APP_API_URL=$API_URL npm run build

# Deploy to S3
aws s3 sync dist/ s3://$S3_BUCKET/ --delete --profile $AWS_PROFILE

echo "Deployment complete for cell: $CELL_ID"