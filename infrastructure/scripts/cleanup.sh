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