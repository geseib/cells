#!/bin/bash

echo "=== Deploying Cell SPAs ==="

# Build and deploy us-east-1-az1 cell
cd /Users/georgeseib/Documents/projects/cells/frontend/spa
echo "Building us-east-1-az1 cell..."
REACT_APP_API_URL="https://c08u5dq4o3.execute-api.us-east-1.amazonaws.com/prod" npm run build
echo "Deploying us-east-1-az1 cell..."
aws s3 sync ./dist s3://cell-us-east-1-az1-spa --delete

# Build and deploy us-east-1-az2 cell
echo "Building us-east-1-az2 cell..."
REACT_APP_API_URL="https://lo4603bdh4.execute-api.us-east-1.amazonaws.com/prod" npm run build
echo "Deploying us-east-1-az2 cell..."
aws s3 sync ./dist s3://cell-us-east-1-az2-spa --delete

# Deploy admin dashboard
cd /Users/georgeseib/Documents/projects/cells/frontend/admin
echo "Deploying admin dashboard..."
aws s3 sync ./dist s3://cell-admin-dashboard --delete

# Deploy router pages
cd /Users/georgeseib/Documents/projects/cells/frontend/router
echo "Deploying router pages..."
aws s3 sync . s3://cell-router --delete

echo "=== Creating CloudFront Invalidations ==="
aws cloudfront create-invalidation --distribution-id E1QOGJJ3PTCG0Z --paths "/*" # us-east-1-az1
aws cloudfront create-invalidation --distribution-id E1XHQHP0NNQZXZ --paths "/*" # us-east-1-az2  
aws cloudfront create-invalidation --distribution-id EZCGBCKR04H04 --paths "/*" # admin
aws cloudfront create-invalidation --distribution-id E1RMBQK20T6WH7 --paths "/*" # router

echo "=== Disabling CloudFront Caching ==="

# Function to disable caching for a distribution
disable_caching() {
    local dist_id=$1
    local origin_id=$2
    
    echo "Disabling caching for distribution $dist_id..."
    
    # Get current distribution config
    aws cloudfront get-distribution-config --id $dist_id > /tmp/dist-config.json
    
    # Extract ETag
    ETAG=$(jq -r '.ETag' /tmp/dist-config.json)
    
    # Update cache behavior to disable caching
    jq '.DistributionConfig.DefaultCacheBehavior.MinTTL = 0 |
        .DistributionConfig.DefaultCacheBehavior.DefaultTTL = 0 |
        .DistributionConfig.DefaultCacheBehavior.MaxTTL = 0 |
        .DistributionConfig.DefaultCacheBehavior.ForwardedValues.QueryString = true |
        .DistributionConfig.DefaultCacheBehavior.ForwardedValues.Cookies.Forward = "all" |
        .DistributionConfig.DefaultCacheBehavior.ForwardedValues.Headers.Quantity = 1 |
        .DistributionConfig.DefaultCacheBehavior.ForwardedValues.Headers.Items = ["*"]' \
        /tmp/dist-config.json > /tmp/updated-config.json
    
    # Update the distribution
    aws cloudfront update-distribution \
        --id $dist_id \
        --distribution-config file:///tmp/updated-config.json \
        --if-match $ETAG
}

# Disable caching for all distributions
disable_caching "E1QOGJJ3PTCG0Z" "cell-us-east-1-az1-origin"
disable_caching "E1XHQHP0NNQZXZ" "cell-us-east-1-az2-origin"  
disable_caching "EZCGBCKR04H04" "cell-admin-origin"
disable_caching "E1RMBQK20T6WH7" "cell-router-origin"

echo "=== Deployment Complete ==="