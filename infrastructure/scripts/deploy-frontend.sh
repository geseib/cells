#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration - try to load from config file if available
CONFIG_FILE="../../config.json"
if [ -f "$CONFIG_FILE" ] && command -v jq >/dev/null 2>&1; then
    echo -e "${GREEN}Loading configuration from config.json...${NC}"
    PROJECT_NAME="${PROJECT_NAME:-$(jq -r '.projectName // "cell-demo"' $CONFIG_FILE)}"
    REGIONS="${REGIONS:-$(jq -r '.regions | join(",") // "us-east-1,us-west-2"' $CONFIG_FILE)}"
    DOMAIN_NAME="${DOMAIN_NAME:-$(jq -r '.domainName // empty' $CONFIG_FILE)}"
    AWS_PROFILE_CONFIG=$(jq -r '.deployment.awsProfile // empty' $CONFIG_FILE)
    
    # Set AWS profile if specified
    if [ ! -z "$AWS_PROFILE_CONFIG" ] && [ "$AWS_PROFILE_CONFIG" != "null" ]; then
        export AWS_PROFILE="$AWS_PROFILE_CONFIG"
        echo -e "${GREEN}Using AWS Profile: $AWS_PROFILE${NC}"
    fi
else
    # Fallback to environment variables
    PROJECT_NAME="${PROJECT_NAME:-cell-demo}"
    REGIONS="${REGIONS:-us-east-1,us-west-2}"
    DOMAIN_NAME="${DOMAIN_NAME:-}"
fi

echo -e "${GREEN}AWS Cell Architecture Demo - Frontend Deployment${NC}"
echo "================================================"

cd ../../frontend

# Resolve the routing (global) API endpoint and admin URL once — these are
# injected into the admin build and substituted into the router pages.
ROUTING_API=$(aws cloudformation describe-stacks \
    --stack-name ${PROJECT_NAME}-routing \
    --region us-east-1 \
    --query 'Stacks[0].Outputs[?OutputKey==`RoutingApiEndpoint`].OutputValue' \
    --output text)

ADMIN_URL=$(aws cloudformation describe-stacks \
    --stack-name ${PROJECT_NAME}-routing \
    --region us-east-1 \
    --query 'Stacks[0].Outputs[?OutputKey==`AdminUrl`].OutputValue' \
    --output text)

if [ ! -z "$DOMAIN_NAME" ]; then
    ROUTING_API="https://cellapi.${DOMAIN_NAME}"
    ADMIN_URL="https://celladmin.${DOMAIN_NAME}"
fi

if [ -z "$ROUTING_API" ] || [ "$ROUTING_API" == "None" ]; then
    echo -e "${RED}Error: Could not resolve routing API endpoint. Make sure infrastructure is deployed.${NC}"
    exit 1
fi

# Build admin tool with the routing API injected (webpack DefinePlugin)
echo -e "\n${YELLOW}Building admin tool...${NC}"
cd admin
npm install
ADMIN_API_URL="$ROUTING_API" npm run build
cd ..

# Get admin bucket from CloudFormation
ADMIN_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name ${PROJECT_NAME}-routing \
    --region us-east-1 \
    --query 'Stacks[0].Outputs[?OutputKey==`AdminBucket`].OutputValue' \
    --output text)

if [ -z "$ADMIN_BUCKET" ]; then
    echo -e "${RED}Error: Could not find admin bucket. Make sure infrastructure is deployed.${NC}"
    exit 1
fi

# Deploy admin tool
echo -e "\n${YELLOW}Deploying admin tool to S3...${NC}"
aws s3 sync admin/dist/ s3://${ADMIN_BUCKET}/ --delete
# Deploy additional admin files
aws s3 cp admin/demo-script.html s3://${ADMIN_BUCKET}/demo-script.html
aws s3 cp admin/demo-panel-embed.js s3://${ADMIN_BUCKET}/demo-panel-embed.js

# Router pages live in the admin bucket; substitute the routing API endpoint
# for the %%ROUTING_API_URL%% placeholder at deploy time.
TMP_ROUTER_DIR=$(mktemp -d)
for page in index.html auto.html; do
    sed "s|%%ROUTING_API_URL%%|${ROUTING_API}|g" router/${page} > ${TMP_ROUTER_DIR}/${page}
done
aws s3 cp ${TMP_ROUTER_DIR}/index.html s3://${ADMIN_BUCKET}/router.html
aws s3 cp ${TMP_ROUTER_DIR}/auto.html s3://${ADMIN_BUCKET}/auto.html
aws s3 cp router/favicon.ico s3://${ADMIN_BUCKET}/favicon.ico
rm -rf ${TMP_ROUTER_DIR}

# Build and deploy the cell SPA once per cell, injecting that cell's own API
# endpoint — cells must not depend on another cell's or region's API at runtime.
IFS=',' read -ra REGION_ARRAY <<< "$REGIONS"
for region in "${REGION_ARRAY[@]}"; do
    echo -e "\n${YELLOW}Deploying SPAs to region: ${region}${NC}"

    # Get all cell stacks in the region
    CELL_STACKS=$(aws cloudformation list-stacks \
        --region ${region} \
        --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
        --query "StackSummaries[?starts_with(StackName, '${PROJECT_NAME}-cell-')].StackName" \
        --output text)

    for stack in ${CELL_STACKS}; do
        CONTENT_BUCKET=$(aws cloudformation describe-stacks \
            --region ${region} \
            --stack-name ${stack} \
            --query 'Stacks[0].Outputs[?OutputKey==`ContentBucket`].OutputValue' \
            --output text)

        CELL_API=$(aws cloudformation describe-stacks \
            --region ${region} \
            --stack-name ${stack} \
            --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
            --output text)

        if [ ! -z "$CONTENT_BUCKET" ]; then
            echo -e "${GREEN}Building SPA for ${stack} (API: ${CELL_API})${NC}"
            (cd spa && npm install && CELL_API_URL="$CELL_API" ADMIN_URL="$ADMIN_URL" npm run build)
            echo -e "${GREEN}Deploying to ${CONTENT_BUCKET}${NC}"
            aws s3 sync spa/dist/ s3://${CONTENT_BUCKET}/ --delete --region ${region}
            aws s3 cp admin/demo-panel-embed.js s3://${CONTENT_BUCKET}/demo-panel-embed.js --region ${region}
        fi
    done
done

# Get URLs
echo -e "\n${GREEN}Frontend deployment completed!${NC}"
echo "================================================"
echo -e "${GREEN}Admin Dashboard:${NC} ${ADMIN_URL}"
echo -e "${GREEN}Router:${NC} ${ADMIN_URL}/router.html"
echo -e "${GREEN}Auto-Router:${NC} ${ADMIN_URL}/auto.html"

# Get cell URLs
echo -e "\n${GREEN}Cell URLs:${NC}"
for region in "${REGION_ARRAY[@]}"; do
    CELL_STACKS=$(aws cloudformation list-stacks \
        --region ${region} \
        --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
        --query "StackSummaries[?starts_with(StackName, '${PROJECT_NAME}-cell-')].StackName" \
        --output text)
    
    for stack in ${CELL_STACKS}; do
        CLOUDFRONT_URL=$(aws cloudformation describe-stacks \
            --region ${region} \
            --stack-name ${stack} \
            --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontUrl`].OutputValue' \
            --output text)
        
        CELL_ID=$(echo ${stack} | sed "s/${PROJECT_NAME}-cell-//")
        if [ ! -z "$CLOUDFRONT_URL" ]; then
            echo "  ${CELL_ID}: ${CLOUDFRONT_URL}"
        fi
    done
done