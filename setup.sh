#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

CONFIG_FILE="config.json"
AUTO_APPROVE=false

# Parse command line arguments
while getopts "y" opt; do
  case $opt in
    y)
      AUTO_APPROVE=true
      ;;
    \?)
      echo "Invalid option: -$OPTARG" >&2
      exit 1
      ;;
  esac
done

echo -e "${BLUE}AWS Cell Architecture Demo - Setup Script${NC}"
echo "================================================"

# Check if config file exists
if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${YELLOW}Config file not found. Creating from example...${NC}"
    cp config.example.json config.json
    echo -e "${RED}Please edit config.json with your settings and run this script again.${NC}"
    echo -e "${GREEN}Example configuration created at: config.json${NC}"
    exit 1
fi

# Read configuration
PROJECT_NAME=$(jq -r '.projectName' $CONFIG_FILE)
SAM_BUCKET=$(jq -r '.samBucket' $CONFIG_FILE)
DOMAIN_NAME=$(jq -r '.domainName' $CONFIG_FILE)
HOSTED_ZONE_ID=$(jq -r '.hostedZoneId' $CONFIG_FILE)
REGIONS=$(jq -r '.regions | join(",")' $CONFIG_FILE)
AZS_PER_REGION=$(jq -r '.azsPerRegion' $CONFIG_FILE)
AUTO_CREATE_BUCKET=$(jq -r '.deployment.autoCreateSamBucket' $CONFIG_FILE)
VALIDATE_DOMAIN=$(jq -r '.deployment.validateDomain' $CONFIG_FILE)
AWS_PROFILE_CONFIG=$(jq -r '.deployment.awsProfile // empty' $CONFIG_FILE)

# Set AWS profile if specified
if [ ! -z "$AWS_PROFILE_CONFIG" ] && [ "$AWS_PROFILE_CONFIG" != "null" ]; then
    export AWS_PROFILE="$AWS_PROFILE_CONFIG"
    echo -e "${GREEN}Using AWS Profile: $AWS_PROFILE${NC}"
fi

echo -e "${GREEN}Configuration loaded:${NC}"
echo "  Project Name: $PROJECT_NAME"
echo "  SAM Bucket: $SAM_BUCKET"
echo "  Domain Name: $DOMAIN_NAME"
echo "  Hosted Zone ID: $HOSTED_ZONE_ID"
echo "  Regions: $REGIONS"
echo "  AZs per Region: $AZS_PER_REGION"
echo ""

# Validate required fields
if [ -z "$PROJECT_NAME" ] || [ "$PROJECT_NAME" = "null" ]; then
    echo -e "${RED}Error: projectName is required in config.json${NC}"
    exit 1
fi

if [ -z "$SAM_BUCKET" ] || [ "$SAM_BUCKET" = "null" ]; then
    echo -e "${RED}Error: samBucket is required in config.json${NC}"
    exit 1
fi

# Validate domain configuration
if [ "$DOMAIN_NAME" != "null" ] && [ ! -z "$DOMAIN_NAME" ]; then
    if [ -z "$HOSTED_ZONE_ID" ] || [ "$HOSTED_ZONE_ID" = "null" ]; then
        echo -e "${RED}Error: hostedZoneId is required when domainName is specified${NC}"
        exit 1
    fi
    
    if [ "$VALIDATE_DOMAIN" = "true" ]; then
        echo -e "${YELLOW}Validating hosted zone...${NC}"
        if ! aws route53 get-hosted-zone --id "$HOSTED_ZONE_ID" >/dev/null 2>&1; then
            echo -e "${RED}Error: Hosted zone $HOSTED_ZONE_ID not found or not accessible${NC}"
            exit 1
        fi
        echo -e "${GREEN}✓ Hosted zone validated${NC}"
    fi
fi

# Check if SAM bucket exists, create if needed
echo -e "${YELLOW}Checking SAM bucket...${NC}"
if ! aws s3 ls "s3://$SAM_BUCKET" >/dev/null 2>&1; then
    if [ "$AUTO_CREATE_BUCKET" = "true" ]; then
        echo -e "${YELLOW}Creating SAM bucket: $SAM_BUCKET${NC}"
        aws s3 mb "s3://$SAM_BUCKET" || {
            echo -e "${RED}Failed to create SAM bucket. Please create it manually or use a different name.${NC}"
            exit 1
        }
        
        # Enable versioning for SAM bucket
        aws s3api put-bucket-versioning \
            --bucket "$SAM_BUCKET" \
            --versioning-configuration Status=Enabled
        
        echo -e "${GREEN}✓ SAM bucket created and configured${NC}"
    else
        echo -e "${RED}Error: SAM bucket $SAM_BUCKET does not exist${NC}"
        echo -e "${YELLOW}Set deployment.autoCreateSamBucket to true in config.json to auto-create${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ SAM bucket exists${NC}"
fi

# Check AWS CLI and permissions
echo -e "${YELLOW}Checking AWS permissions...${NC}"
if ! aws sts get-caller-identity >/dev/null 2>&1; then
    echo -e "${RED}Error: AWS CLI not configured or no permissions${NC}"
    exit 1
fi
echo -e "${GREEN}✓ AWS permissions verified${NC}"

# Check required tools
echo -e "${YELLOW}Checking required tools...${NC}"
for tool in sam node npm jq; do
    if ! command -v $tool >/dev/null 2>&1; then
        echo -e "${RED}Error: $tool is not installed${NC}"
        exit 1
    fi
done
echo -e "${GREEN}✓ All required tools available${NC}"

echo ""
echo -e "${GREEN}Setup validation completed successfully!${NC}"
echo -e "${BLUE}Ready to deploy with the following configuration:${NC}"
echo ""
echo "  🏗️  Project: $PROJECT_NAME"
echo "  📦 SAM Bucket: $SAM_BUCKET"
if [ "$DOMAIN_NAME" != "null" ] && [ ! -z "$DOMAIN_NAME" ]; then
    echo "  🌐 Domain: $DOMAIN_NAME"
    echo "  📍 URLs will be:"
    echo "     • Admin: https://celladmin.$DOMAIN_NAME"
    echo "     • API: https://cellapi.$DOMAIN_NAME"
    echo "     • Cells: https://cell-{cell-id}.$DOMAIN_NAME"
else
    echo "  🌐 Domain: Using AWS-generated URLs"
fi
echo "  🌍 Regions: $REGIONS"
echo ""

if [ "$AUTO_APPROVE" = true ]; then
    echo -e "${GREEN}Auto-approval enabled (-y flag)${NC}"
    REPLY="y"
else
    read -p "Proceed with deployment? (y/N): " -n 1 -r
    echo
fi

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${GREEN}Starting deployment...${NC}"
    echo ""
    
    # Export configuration for deployment scripts
    export PROJECT_NAME="$PROJECT_NAME"
    export SAM_BUCKET="$SAM_BUCKET"
    export REGIONS="$REGIONS"
    export AZS_PER_REGION="$AZS_PER_REGION"
    
    if [ "$DOMAIN_NAME" != "null" ] && [ ! -z "$DOMAIN_NAME" ]; then
        export DOMAIN_NAME="$DOMAIN_NAME"
        export HOSTED_ZONE_ID="$HOSTED_ZONE_ID"
    fi
    
    # Run deployment
    cd infrastructure/scripts
    ./deploy.sh
    
    echo ""
    echo -e "${YELLOW}Infrastructure deployed! Now deploying frontend...${NC}"
    ./deploy-frontend.sh
    
    echo ""
    echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
    echo -e "${BLUE}Your cell architecture is ready to use.${NC}"
else
    echo -e "${YELLOW}Deployment cancelled.${NC}"
fi