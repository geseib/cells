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
    SAM_BUCKET="${SAM_BUCKET:-$(jq -r '.samBucket // empty' $CONFIG_FILE)}"
    REGIONS="${REGIONS:-$(jq -r '.regions | join(",") // "us-east-1,us-west-2"' $CONFIG_FILE)}"
    AZS_PER_REGION="${AZS_PER_REGION:-$(jq -r '.azsPerRegion // 2' $CONFIG_FILE)}"
    DOMAIN_NAME="${DOMAIN_NAME:-$(jq -r '.domainName // empty' $CONFIG_FILE)}"
    HOSTED_ZONE_ID="${HOSTED_ZONE_ID:-$(jq -r '.hostedZoneId // empty' $CONFIG_FILE)}"
    # Optional single-hostname edge mode: subdomain for the shared CloudFront
    # distribution (e.g. "go" -> go.{domainName}). Empty/absent = disabled.
    EDGE_DOMAIN="${EDGE_DOMAIN:-$(jq -r '.edgeDomain // empty' $CONFIG_FILE)}"
    AWS_PROFILE_CONFIG=$(jq -r '.deployment.awsProfile // empty' $CONFIG_FILE)
    
    # Set AWS profile if specified
    if [ ! -z "$AWS_PROFILE_CONFIG" ] && [ "$AWS_PROFILE_CONFIG" != "null" ]; then
        export AWS_PROFILE="$AWS_PROFILE_CONFIG"
        echo -e "${GREEN}Using AWS Profile: $AWS_PROFILE${NC}"
    fi
else
    # Fallback to environment variables
    PROJECT_NAME="${PROJECT_NAME:-cell-demo}"
    SAM_BUCKET="${SAM_BUCKET}"
    REGIONS="${REGIONS:-us-east-1,us-west-2}"
    AZS_PER_REGION="${AZS_PER_REGION:-2}"
    DOMAIN_NAME="${DOMAIN_NAME:-}"
    HOSTED_ZONE_ID="${HOSTED_ZONE_ID:-}"
    EDGE_DOMAIN="${EDGE_DOMAIN:-}"
fi

echo -e "${GREEN}AWS Cell Architecture Demo - Deployment Script${NC}"
echo "================================================"

# Check if SAM bucket is provided
if [ -z "$SAM_BUCKET" ]; then
    echo -e "${RED}Error: SAM_BUCKET not configured${NC}"
    echo "Either:"
    echo "  1. Set environment variable: SAM_BUCKET=your-bucket-name ./deploy.sh"
    echo "  2. Configure in config.json and run: ../../setup.sh"
    exit 1
fi

# Build backend
echo -e "\n${YELLOW}Building backend...${NC}"
cd ../../backend
npm install
npm run build
cd ../infrastructure/scripts

# Deploy global resources (us-east-1, alongside the routing layer)
echo -e "\n${YELLOW}Deploying global resources...${NC}"
sam deploy \
    --template-file ../templates/global-resources.yaml \
    --stack-name ${PROJECT_NAME}-global \
    --s3-bucket ${SAM_BUCKET} \
    --region us-east-1 \
    --capabilities CAPABILITY_NAMED_IAM \
    --parameter-overrides ProjectName=${PROJECT_NAME} \
    --no-confirm-changeset \
    --no-fail-on-empty-changeset

# Deploy routing layer in us-east-1 (required for CloudFront certificates)
echo -e "\n${YELLOW}Deploying routing layer in us-east-1...${NC}"

# Build parameter overrides
ROUTING_PARAMS="ProjectName=${PROJECT_NAME}"
if [ ! -z "$DOMAIN_NAME" ] && [ ! -z "$HOSTED_ZONE_ID" ]; then
    ROUTING_PARAMS="${ROUTING_PARAMS} DomainName=${DOMAIN_NAME} HostedZoneId=${HOSTED_ZONE_ID}"
    echo -e "${GREEN}Using custom domain: ${DOMAIN_NAME}${NC}"
fi

sam deploy \
    --template-file ../templates/routing-layer.yaml \
    --stack-name ${PROJECT_NAME}-routing \
    --s3-bucket ${SAM_BUCKET} \
    --region us-east-1 \
    --capabilities CAPABILITY_IAM \
    --parameter-overrides ${ROUTING_PARAMS} \
    --no-confirm-changeset \
    --no-fail-on-empty-changeset

# The educational site (site/) is hosted on Vercel and auto-deploys from
# GitHub on every push to main - it is not part of the AWS deployment.

# Get routing API endpoint
ROUTING_API=$(aws cloudformation describe-stacks \
    --stack-name ${PROJECT_NAME}-routing \
    --region us-east-1 \
    --query 'Stacks[0].Outputs[?OutputKey==`RoutingApiEndpoint`].OutputValue' \
    --output text)

echo -e "${GREEN}Routing API Endpoint: ${ROUTING_API}${NC}"

# Deploy cells in each region
IFS=',' read -ra REGION_ARRAY <<< "$REGIONS"
for region in "${REGION_ARRAY[@]}"; do
    echo -e "\n${YELLOW}Deploying cells in region: ${region}${NC}"
    
    # Get AZs for the region
    AZS=$(aws ec2 describe-availability-zones \
        --region ${region} \
        --query "AvailabilityZones[0:${AZS_PER_REGION}].ZoneName" \
        --output text)
    
    AZ_COUNT=1
    for az in ${AZS}; do
        CELL_ID="${region}-az${AZ_COUNT}"
        echo -e "${GREEN}Deploying cell: ${CELL_ID} in ${az}${NC}"
        
        # Build cell parameter overrides. CloudFront only accepts us-east-1
        # certificates, so cells in other regions get theirs from a small
        # us-east-1 certificate stack and receive the ARN as a parameter;
        # us-east-1 cells create the certificate in their own stack.
        CELL_PARAMS="ProjectName=${PROJECT_NAME} CellId=${CELL_ID} CellRegion=${region} AvailabilityZone=${az} CellWeight=1"
        if [ ! -z "$DOMAIN_NAME" ] && [ ! -z "$HOSTED_ZONE_ID" ]; then
            CELL_PARAMS="${CELL_PARAMS} DomainName=${DOMAIN_NAME} HostedZoneId=${HOSTED_ZONE_ID}"
            if [ "$region" != "us-east-1" ]; then
                echo -e "${YELLOW}Creating us-east-1 certificate for ${CELL_ID}...${NC}"
                sam deploy \
                    --template-file ../templates/cell-certificate.yaml \
                    --stack-name ${PROJECT_NAME}-cert-${CELL_ID} \
                    --s3-bucket ${SAM_BUCKET} \
                    --region us-east-1 \
                    --parameter-overrides ProjectName=${PROJECT_NAME} CellId=${CELL_ID} DomainName=${DOMAIN_NAME} HostedZoneId=${HOSTED_ZONE_ID} \
                    --no-confirm-changeset \
                    --no-fail-on-empty-changeset
                CERT_ARN=$(aws cloudformation describe-stacks \
                    --stack-name ${PROJECT_NAME}-cert-${CELL_ID} \
                    --region us-east-1 \
                    --query 'Stacks[0].Outputs[?OutputKey==`CertificateArn`].OutputValue' \
                    --output text)
                CELL_PARAMS="${CELL_PARAMS} CertificateArn=${CERT_ARN}"
            fi
        fi
        
        # --resolve-s3: deployment artifacts must live in the cell's own
        # region, so let SAM manage a per-region bucket instead of the
        # configured (us-east-1) one.
        sam deploy \
            --template-file ../templates/cell-template.yaml \
            --stack-name ${PROJECT_NAME}-cell-${CELL_ID} \
            --resolve-s3 \
            --region ${region} \
            --capabilities CAPABILITY_IAM \
            --parameter-overrides ${CELL_PARAMS} \
            --no-confirm-changeset \
            --no-fail-on-empty-changeset
        
        AZ_COUNT=$((AZ_COUNT + 1))
    done
done

# Optional single-hostname edge mode: one CloudFront distribution fronting the
# router pages, the routing API and every cell under {edgeDomain}.{domainName}.
# Deployed after the cell stacks because it needs each cell's CloudFront
# domain and execute-api endpoint from the stack outputs.
if [ ! -z "$EDGE_DOMAIN" ]; then
    if [ -z "$DOMAIN_NAME" ] || [ -z "$HOSTED_ZONE_ID" ]; then
        echo -e "${RED}edgeDomain is set but domainName/hostedZoneId are not - skipping edge stack (it requires the custom domain).${NC}"
    else
        echo -e "\n${YELLOW}Deploying single-hostname edge distribution (${EDGE_DOMAIN}.${DOMAIN_NAME})...${NC}"

        ADMIN_BUCKET_ORIGIN=$(aws cloudformation describe-stacks \
            --stack-name ${PROJECT_NAME}-routing \
            --region us-east-1 \
            --query 'Stacks[0].Outputs[?OutputKey==`AdminBucketRegionalDomainName`].OutputValue' \
            --output text)
        ADMIN_OAI=$(aws cloudformation describe-stacks \
            --stack-name ${PROJECT_NAME}-routing \
            --region us-east-1 \
            --query 'Stacks[0].Outputs[?OutputKey==`AdminOAI`].OutputValue' \
            --output text)

        # Gather every cell's CloudFront domain + execute-api host from the
        # cell stack outputs. demo-edge.yaml has 8 parameter slots.
        EDGE_PARAMS="ProjectName=${PROJECT_NAME} DomainName=${DOMAIN_NAME} EdgeSubdomain=${EDGE_DOMAIN} HostedZoneId=${HOSTED_ZONE_ID}"
        EDGE_PARAMS="${EDGE_PARAMS} AdminBucketRegionalDomainName=${ADMIN_BUCKET_ORIGIN} AdminOriginAccessIdentity=${ADMIN_OAI}"
        CELL_SLOT=1
        for region in "${REGION_ARRAY[@]}"; do
            CELL_STACKS=$(aws cloudformation list-stacks \
                --region ${region} \
                --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
                --query "StackSummaries[?starts_with(StackName, '${PROJECT_NAME}-cell-')].StackName" \
                --output text)
            for stack in ${CELL_STACKS}; do
                if [ "$CELL_SLOT" -gt 8 ]; then
                    echo -e "${RED}More than 8 cells; demo-edge.yaml only has 8 slots - skipping the rest.${NC}"
                    break 2
                fi
                CELL_ID="${stack#${PROJECT_NAME}-cell-}"
                CELL_CF=$(aws cloudformation describe-stacks \
                    --region ${region} --stack-name ${stack} \
                    --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontUrl`].OutputValue' \
                    --output text)
                CELL_API=$(aws cloudformation describe-stacks \
                    --region ${region} --stack-name ${stack} \
                    --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
                    --output text)
                # Strip scheme and stage: origins are bare hostnames
                CELL_CF_HOST="${CELL_CF#https://}"
                CELL_API_HOST="${CELL_API#https://}"
                CELL_API_HOST="${CELL_API_HOST%/prod}"
                EDGE_PARAMS="${EDGE_PARAMS} CellId${CELL_SLOT}=${CELL_ID} CellPageOrigin${CELL_SLOT}=${CELL_CF_HOST} CellApiOrigin${CELL_SLOT}=${CELL_API_HOST}"
                CELL_SLOT=$((CELL_SLOT + 1))
            done
        done

        sam deploy \
            --template-file ../templates/demo-edge.yaml \
            --stack-name ${PROJECT_NAME}-edge \
            --s3-bucket ${SAM_BUCKET} \
            --region us-east-1 \
            --parameter-overrides ${EDGE_PARAMS} \
            --no-confirm-changeset \
            --no-fail-on-empty-changeset

        echo -e "${GREEN}Edge URL:${NC} https://${EDGE_DOMAIN}.${DOMAIN_NAME}"
    fi
fi

# Get admin URL
ADMIN_URL=$(aws cloudformation describe-stacks \
    --stack-name ${PROJECT_NAME}-routing \
    --region us-east-1 \
    --query 'Stacks[0].Outputs[?OutputKey==`AdminUrl`].OutputValue' \
    --output text)

echo -e "\n${GREEN}Deployment completed successfully!${NC}"
echo "================================================"
if [ ! -z "$DOMAIN_NAME" ]; then
    echo -e "${GREEN}Routing API:${NC} https://api.${DOMAIN_NAME}"
    echo -e "${GREEN}Admin Dashboard:${NC} https://admin.${DOMAIN_NAME}"
else
    echo -e "${GREEN}Routing API:${NC} ${ROUTING_API}"
    echo -e "${GREEN}Admin Dashboard:${NC} ${ADMIN_URL}"
fi
echo -e "\n${YELLOW}Note: Frontend deployment script available at ./deploy-frontend.sh${NC}"
if [ ! -z "$DOMAIN_NAME" ]; then
    echo -e "${YELLOW}Custom domain setup may take 10-15 minutes for DNS propagation and certificate validation${NC}"
fi