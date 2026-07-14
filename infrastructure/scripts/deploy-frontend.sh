#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration - try to load from config file if available.
# CONFIG_FILE must be absolute: the script cd's into frontend/ later, and a
# relative path silently resolves outside the repo from there (the
# siteDomainName lookup below then kills the script via set -e).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/../../config.json"
if [ -f "$CONFIG_FILE" ] && command -v jq >/dev/null 2>&1; then
    echo -e "${GREEN}Loading configuration from config.json...${NC}"
    PROJECT_NAME="${PROJECT_NAME:-$(jq -r '.projectName // "cell-demo"' $CONFIG_FILE)}"
    REGIONS="${REGIONS:-$(jq -r '.regions | join(",") // "us-east-1,us-west-2"' $CONFIG_FILE)}"
    DOMAIN_NAME="${DOMAIN_NAME:-$(jq -r '.domainName // empty' $CONFIG_FILE)}"
    # Optional single-hostname edge mode (see demo-edge.yaml); empty = off
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
    REGIONS="${REGIONS:-us-east-1,us-west-2}"
    DOMAIN_NAME="${DOMAIN_NAME:-}"
    EDGE_DOMAIN="${EDGE_DOMAIN:-}"
fi

# Edge mode: audience traffic flows through one CloudFront hostname. The
# router pages call the routing API at the relative /api base and redirect to
# /{cellId}/ paths; the admin QR card encodes the edge hostname.
EDGE_MODE="false"
EDGE_HOST=""
ROUTER_URL=""
if [ ! -z "$EDGE_DOMAIN" ] && [ ! -z "$DOMAIN_NAME" ]; then
    EDGE_MODE="true"
    EDGE_HOST="${EDGE_DOMAIN}.${DOMAIN_NAME}"
    ROUTER_URL="https://${EDGE_HOST}"
    echo -e "${GREEN}Edge mode enabled: ${ROUTER_URL}${NC}"
fi

# Invalidate a CloudFront distribution's cache by its dxxx.cloudfront.net
# domain. Without this, a cached index.html keeps referencing hashed bundle
# names that `aws s3 sync --delete` just removed - the page then loads blank
# with 403s on the bundle until the cache expires.
invalidate_distribution() {
    local domain="${1#https://}"
    [ -z "$domain" ] && return 0
    local dist_id=$(aws cloudfront list-distributions \
        --query "DistributionList.Items[?DomainName=='${domain}'].Id" \
        --output text 2>/dev/null)
    if [ ! -z "$dist_id" ] && [ "$dist_id" != "None" ]; then
        aws cloudfront create-invalidation --distribution-id "$dist_id" --paths "/*" > /dev/null
        echo -e "${GREEN}Invalidated CloudFront cache: ${domain} (${dist_id})${NC}"
    else
        echo -e "${YELLOW}Warning: no CloudFront distribution found for ${domain} - skipping invalidation${NC}"
    fi
}

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
    ROUTING_API="https://api.${DOMAIN_NAME}"
    ADMIN_URL="https://admin.${DOMAIN_NAME}"
fi

if [ -z "$ROUTING_API" ] || [ "$ROUTING_API" == "None" ]; then
    echo -e "${RED}Error: Could not resolve routing API endpoint. Make sure infrastructure is deployed.${NC}"
    exit 1
fi

# Educational-site URL - the site is hosted on Vercel (auto-deployed from
# GitHub), so the link target comes straight from config.json's siteDomainName.
SITE_DOMAIN_NAME="${SITE_DOMAIN_NAME:-$(jq -r '.siteDomainName // empty' $CONFIG_FILE 2>/dev/null || true)}"
INTRO_URL=""
if [ ! -z "$SITE_DOMAIN_NAME" ]; then INTRO_URL="https://${SITE_DOMAIN_NAME}"; fi

# Build admin tool with the routing API injected (webpack DefinePlugin).
# ROUTER_URL (edge mode only) points the "Scan to join" QR card at the single
# edge hostname; when empty the card falls back to this host's /router.html.
echo -e "\n${YELLOW}Building admin tool...${NC}"
cd admin
npm install
ADMIN_API_URL="$ROUTING_API" INTRO_URL="$INTRO_URL" ROUTER_URL="$ROUTER_URL" npm run build
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
# for the %%ROUTING_API_URL%% placeholder at deploy time. %%EDGE_HOST%% is the
# edge hostname (empty when edge mode is off): the SAME router artifact is
# served from both the admin host and the edge host, so the page decides at
# runtime - relative /api calls and /{cellId}/ redirects only when
# location.hostname matches the edge host.
TMP_ROUTER_DIR=$(mktemp -d)
for page in index.html auto.html; do
    sed "s|%%ROUTING_API_URL%%|${ROUTING_API}|g; s|%%INTRO_URL%%|${INTRO_URL}|g; s|%%EDGE_HOST%%|${EDGE_HOST}|g" router/${page} > ${TMP_ROUTER_DIR}/${page}
done
aws s3 cp ${TMP_ROUTER_DIR}/index.html s3://${ADMIN_BUCKET}/router.html
aws s3 cp ${TMP_ROUTER_DIR}/auto.html s3://${ADMIN_BUCKET}/auto.html
aws s3 cp router/favicon.ico s3://${ADMIN_BUCKET}/favicon.ico
rm -rf ${TMP_ROUTER_DIR}

# The admin distribution just received new hashed bundles + router pages;
# flush its cache so stale index.html never points at deleted bundles.
ADMIN_CF_DOMAIN=$(aws cloudformation describe-stacks \
    --stack-name ${PROJECT_NAME}-routing \
    --region us-east-1 \
    --query 'Stacks[0].Outputs[?OutputKey==`AdminUrl`].OutputValue' \
    --output text)
invalidate_distribution "$ADMIN_CF_DOMAIN"

# The edge distribution serves the same admin-bucket router pages at /.
if [ "$EDGE_MODE" == "true" ]; then
    EDGE_DIST_ID=$(aws cloudformation describe-stacks \
        --stack-name ${PROJECT_NAME}-edge \
        --region us-east-1 \
        --query 'Stacks[0].Outputs[?OutputKey==`EdgeDistributionId`].OutputValue' \
        --output text 2>/dev/null)
    if [ ! -z "$EDGE_DIST_ID" ] && [ "$EDGE_DIST_ID" != "None" ]; then
        aws cloudfront create-invalidation --distribution-id "$EDGE_DIST_ID" --paths "/*" > /dev/null
        echo -e "${GREEN}Invalidated CloudFront cache: edge (${EDGE_DIST_ID})${NC}"
    fi
fi

# Build and deploy the cell SPA once per cell, injecting that cell's own API
# endpoint — cells must not depend on another cell's or region's API at runtime.
IFS=',' read -ra REGION_ARRAY <<< "$REGIONS"

# The SPA tints itself with the same palette slot the admin dashboard and the
# site assign this cell: index into CELL_COLOR_VARS by sorted-cellId order over
# ALL cells (see makeCellColors in frontend/admin/src/ring.ts). A single cell
# can't see the full registry at runtime, so gather every cell id across all
# regions up front and pass each build its CELL_INDEX.
ALL_CELL_IDS=""
for region in "${REGION_ARRAY[@]}"; do
    REGION_CELL_STACKS=$(aws cloudformation list-stacks \
        --region ${region} \
        --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
        --query "StackSummaries[?starts_with(StackName, '${PROJECT_NAME}-cell-')].StackName" \
        --output text)
    for stack in ${REGION_CELL_STACKS}; do
        ALL_CELL_IDS="${ALL_CELL_IDS} ${stack#${PROJECT_NAME}-cell-}"
    done
done
# Lexicographic sort (LC_ALL=C matches the JS sort the admin/site use on
# these ASCII ids), de-duplicated.
ALL_CELL_IDS=$(echo ${ALL_CELL_IDS} | tr ' ' '\n' | LC_ALL=C sort -u)

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
            # CELL_ID lets the SPA detect edge mode at runtime: when served
            # under /{cellId}/ it swaps its API base to the relative
            # /{cellId}/api instead of the baked absolute endpoint.
            CELL_ID="${stack#${PROJECT_NAME}-cell-}"
            # CELL_INDEX: this cell's position in the sorted list of all cell
            # ids — drives the SPA's identity color (palette parity with the
            # admin dashboard and site).
            CELL_INDEX=0
            for id in ${ALL_CELL_IDS}; do
                if [ "$id" == "$CELL_ID" ]; then break; fi
                CELL_INDEX=$((CELL_INDEX + 1))
            done
            echo -e "${GREEN}Building SPA for ${stack} (API: ${CELL_API}, palette index: ${CELL_INDEX})${NC}"
            (cd spa && npm install && CELL_API_URL="$CELL_API" CELL_ID="$CELL_ID" CELL_INDEX="$CELL_INDEX" ADMIN_URL="$ADMIN_URL" INTRO_URL="$INTRO_URL" npm run build)
            echo -e "${GREEN}Deploying to ${CONTENT_BUCKET}${NC}"
            aws s3 sync spa/dist/ s3://${CONTENT_BUCKET}/ --delete --region ${region}
            aws s3 cp admin/demo-panel-embed.js s3://${CONTENT_BUCKET}/demo-panel-embed.js --region ${region}

            # Flush this cell's CloudFront cache so its index.html can't
            # reference the bundle hash the sync above just deleted.
            CELL_CF_URL=$(aws cloudformation describe-stacks \
                --region ${region} \
                --stack-name ${stack} \
                --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontUrl`].OutputValue' \
                --output text)
            invalidate_distribution "$CELL_CF_URL"
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