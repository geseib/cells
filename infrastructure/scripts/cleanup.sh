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
fi

echo -e "${YELLOW}AWS Cell Architecture Demo - Cleanup Script${NC}"
echo "================================================"
echo -e "${RED}WARNING: This will delete all resources!${NC}"
read -p "Are you sure you want to continue? (yes/no): " -n 3 -r
echo
if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "Cleanup cancelled."
    exit 1
fi

# --- Paid-resource sweep: demo Route 53 health checks -----------------------
# The failover and quorum demos create health checks at DEMO time via the
# admin API — no stack owns them, so stack deletion never removes them and
# they bill hourly forever if missed. Sweep anything whose Name tag starts
# with {project}-failover- or {project}-quorum- BEFORE touching the stacks.
# Quorum parents go first: a CALCULATED parent references its children, and
# Route 53 refuses to delete a child that is still referenced.
echo -e "\n${YELLOW}Sweeping demo Route 53 health checks (failover + quorum)...${NC}"
HC_IDS=$(aws route53 list-health-checks --query 'HealthChecks[].Id' --output text 2>/dev/null || true)
HC_MATCHES=""
for hc_id in ${HC_IDS}; do
    hc_name=$(aws route53 list-tags-for-resource \
        --resource-type healthcheck --resource-id "${hc_id}" \
        --query "ResourceTagSet.Tags[?Key=='Name'].Value" --output text 2>/dev/null || true)
    case "$hc_name" in
        ${PROJECT_NAME}-failover-*|${PROJECT_NAME}-quorum-*)
            HC_MATCHES="${HC_MATCHES} ${hc_id}=${hc_name}"
            ;;
    esac
done
# Pass 1: quorum parents. Pass 2: everything else.
for entry in ${HC_MATCHES}; do
    case "${entry#*=}" in
        *-quorum-parent*)
            echo "Deleting health check (parent first): ${entry#*=} (${entry%%=*})"
            aws route53 delete-health-check --health-check-id "${entry%%=*}" || true
            ;;
    esac
done
for entry in ${HC_MATCHES}; do
    case "${entry#*=}" in
        *-quorum-parent*) ;;
        *)
            echo "Deleting health check: ${entry#*=} (${entry%%=*})"
            aws route53 delete-health-check --health-check-id "${entry%%=*}" || true
            ;;
    esac
done
if [ -z "${HC_MATCHES}" ]; then
    echo "No ${PROJECT_NAME}-failover-* / ${PROJECT_NAME}-quorum-* health checks found."
fi

# Delete cell stacks in each region
IFS=',' read -ra REGION_ARRAY <<< "$REGIONS"
for region in "${REGION_ARRAY[@]}"; do
    echo -e "\n${YELLOW}Cleaning up cells in region: ${region}${NC}"
    
    CELL_STACKS=$(aws cloudformation list-stacks \
        --region ${region} \
        --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
        --query "StackSummaries[?starts_with(StackName, '${PROJECT_NAME}-cell-')].StackName" \
        --output text)
    
    for stack in ${CELL_STACKS}; do
        echo -e "${GREEN}Deleting stack: ${stack}${NC}"
        
        # Empty S3 bucket first
        CONTENT_BUCKET=$(aws cloudformation describe-stacks \
            --region ${region} \
            --stack-name ${stack} \
            --query 'Stacks[0].Outputs[?OutputKey==`ContentBucket`].OutputValue' \
            --output text)
        
        if [ ! -z "$CONTENT_BUCKET" ]; then
            echo "Emptying bucket: ${CONTENT_BUCKET}"
            aws s3 rm s3://${CONTENT_BUCKET} --recursive --region ${region} || true
        fi
        
        aws cloudformation delete-stack \
            --stack-name ${stack} \
            --region ${region}
    done
done

# --- Idempotency demo stacks ({project}-idem-{region}) ----------------------
# Secondary regions FIRST, the primary (REGIONS[0]) LAST: the primary stack
# owns the AWS::DynamoDB::GlobalTable and its replicas — deleting it while a
# secondary stack still points at the replica risks a stuck delete. These
# deletes are waited on so the global-table verification below is meaningful.
echo -e "\n${YELLOW}Deleting idempotency demo stacks (secondary regions first)...${NC}"
for (( idem_idx=${#REGION_ARRAY[@]}-1 ; idem_idx>=0 ; idem_idx-- )); do
    region="${REGION_ARRAY[idem_idx]}"
    stack="${PROJECT_NAME}-idem-${region}"
    if aws cloudformation describe-stacks --stack-name "${stack}" --region "${region}" >/dev/null 2>&1; then
        echo "Deleting idem stack: ${stack} (${region})"
        aws cloudformation delete-stack --stack-name "${stack}" --region "${region}" || true
        aws cloudformation wait stack-delete-complete --stack-name "${stack}" --region "${region}" || true
    else
        echo "No idem stack ${stack} in ${region} - skipping."
    fi
done

# Verify the shared global table is actually GONE in both regions — replicas
# that outlive a failed delete keep billing for storage indefinitely.
for region in "${REGION_ARRAY[@]}"; do
    if aws dynamodb describe-table --table-name "${PROJECT_NAME}-idem-shared" --region "${region}" >/dev/null 2>&1; then
        echo -e "${RED}WARNING: ${PROJECT_NAME}-idem-shared still exists in ${region} — delete it manually.${NC}"
    else
        echo -e "${GREEN}Verified: ${PROJECT_NAME}-idem-shared is gone in ${region}.${NC}"
    fi
done

# Delete per-cell certificate stacks (us-east-1; created for cells in other
# regions since CloudFront only accepts us-east-1 certificates)
echo -e "\n${YELLOW}Deleting cell certificate stacks...${NC}"
CERT_STACKS=$(aws cloudformation list-stacks \
    --region us-east-1 \
    --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
    --query "StackSummaries[?starts_with(StackName, '${PROJECT_NAME}-cert-')].StackName" \
    --output text)
for stack in ${CERT_STACKS}; do
    echo "Deleting certificate stack: ${stack}"
    aws cloudformation delete-stack --stack-name ${stack} --region us-east-1 || true
done

# Delete the educational-site hosting stack if present
SITE_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name ${PROJECT_NAME}-site \
    --region us-east-1 \
    --query 'Stacks[0].Outputs[?OutputKey==`SiteBucket`].OutputValue' \
    --output text 2>/dev/null || true)
if [ ! -z "$SITE_BUCKET" ] && [ "$SITE_BUCKET" != "None" ]; then
    echo "Emptying site bucket: ${SITE_BUCKET}"
    aws s3 rm s3://${SITE_BUCKET} --recursive || true
    aws cloudformation delete-stack --stack-name ${PROJECT_NAME}-site --region us-east-1 || true
fi

# Delete routing layer
echo -e "\n${YELLOW}Deleting routing layer...${NC}"

# Empty admin bucket
ADMIN_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name ${PROJECT_NAME}-routing \
    --query 'Stacks[0].Outputs[?OutputKey==`AdminBucket`].OutputValue' \
    --output text 2>/dev/null || true)

if [ ! -z "$ADMIN_BUCKET" ]; then
    echo "Emptying admin bucket: ${ADMIN_BUCKET}"
    aws s3 rm s3://${ADMIN_BUCKET} --recursive || true
fi

aws cloudformation delete-stack \
    --stack-name ${PROJECT_NAME}-routing || true

# Delete global resources
echo -e "\n${YELLOW}Deleting global resources...${NC}"
aws cloudformation delete-stack \
    --stack-name ${PROJECT_NAME}-global || true

echo -e "\n${GREEN}Cleanup initiated. Stacks will be deleted in the background.${NC}"
echo "You can monitor the deletion progress in the AWS CloudFormation console."