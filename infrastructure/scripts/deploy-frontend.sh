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

# Build SPAs
echo -e "\n${YELLOW}Building frontend applications...${NC}"
cd ../../frontend

# Build cell SPA
echo -e "${GREEN}Building cell SPA...${NC}"
cd spa
npm install
npm run build
cd ..

# Build admin tool
echo -e "${GREEN}Building admin tool...${NC}"
cd admin
npm install
npm run build
cd ..

# Get admin bucket from CloudFormation
ADMIN_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name ${PROJECT_NAME}-routing \
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
# Deploy router files to admin bucket for navigation
aws s3 cp router/index.html s3://${ADMIN_BUCKET}/router.html
aws s3 cp router/auto.html s3://${ADMIN_BUCKET}/auto.html
aws s3 cp router/favicon.ico s3://${ADMIN_BUCKET}/favicon.ico

# Deploy router pages
echo -e "\n${YELLOW}Deploying router pages...${NC}"
# Try to get router bucket from various possible stacks
ROUTER_BUCKET=""
for stack_name in "${PROJECT_NAME}-router-fix" "${PROJECT_NAME}-simple-router" "${PROJECT_NAME}-global-entry"; do
    ROUTER_BUCKET=$(aws cloudformation describe-stacks \
        --stack-name ${stack_name} \
        --query 'Stacks[0].Outputs[?OutputKey==`RouterBucket`].OutputValue' \
        --output text 2>/dev/null || true)
    if [ ! -z "$ROUTER_BUCKET" ] && [ "$ROUTER_BUCKET" != "None" ]; then
        break
    fi
done

# If not found in stacks, use the known bucket name
if [ -z "$ROUTER_BUCKET" ] || [ "$ROUTER_BUCKET" == "None" ]; then
    ROUTER_BUCKET="${PROJECT_NAME}-router-${AWS_ACCOUNT_ID:-021891573713}"
    echo -e "${YELLOW}Using default router bucket: ${ROUTER_BUCKET}${NC}"
fi

# Deploy router files
if [ -d "router" ]; then
    echo -e "${GREEN}Deploying to router bucket: ${ROUTER_BUCKET}${NC}"
    aws s3 sync router/ s3://${ROUTER_BUCKET}/ --delete
else
    echo -e "${RED}Warning: router directory not found. Skipping router deployment.${NC}"
fi

# Deploy cell SPAs to each region
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
        # Get content bucket for this cell
        CONTENT_BUCKET=$(aws cloudformation describe-stacks \
            --region ${region} \
            --stack-name ${stack} \
            --query 'Stacks[0].Outputs[?OutputKey==`ContentBucket`].OutputValue' \
            --output text)
        
        if [ ! -z "$CONTENT_BUCKET" ]; then
            echo -e "${GREEN}Deploying to ${CONTENT_BUCKET}${NC}"
            aws s3 sync spa/dist/ s3://${CONTENT_BUCKET}/ --delete --region ${region}
        fi
    done
done

# Get URLs
echo -e "\n${GREEN}Frontend deployment completed!${NC}"
echo "================================================"

# Get admin URL
ADMIN_URL=$(aws cloudformation describe-stacks \
    --stack-name ${PROJECT_NAME}-routing \
    --query 'Stacks[0].Outputs[?OutputKey==`AdminUrl`].OutputValue' \
    --output text)

echo -e "${GREEN}Admin Dashboard:${NC} ${ADMIN_URL}"

# Get router URL
ROUTER_URL=""
for stack_name in "${PROJECT_NAME}-router-fix" "${PROJECT_NAME}-simple-router" "${PROJECT_NAME}-global-entry"; do
    ROUTER_URL=$(aws cloudformation describe-stacks \
        --stack-name ${stack_name} \
        --query 'Stacks[0].Outputs[?OutputKey==`RouterUrl`].OutputValue' \
        --output text 2>/dev/null || true)
    if [ ! -z "$ROUTER_URL" ] && [ "$ROUTER_URL" != "None" ]; then
        break
    fi
done

if [ ! -z "$ROUTER_URL" ] && [ "$ROUTER_URL" != "None" ]; then
    echo -e "${GREEN}Router:${NC} ${ROUTER_URL}"
    echo -e "${GREEN}Auto-Router:${NC} ${ROUTER_URL}/auto.html"
fi

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