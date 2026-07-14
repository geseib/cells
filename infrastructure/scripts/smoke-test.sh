#!/bin/bash
# Post-deploy smoke test for the AWS cell demo.
# Verifies the routing layer, cell registration, consistent-hash parity with
# the unit-test golden value, and each cell's API (including per-cell client
# tracking). Prints the env-var line for the Playwright E2E suite on success.
set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

CONFIG_FILE="$(dirname "$0")/../../config.json"
if [ -f "$CONFIG_FILE" ] && command -v jq >/dev/null 2>&1; then
    PROJECT_NAME="${PROJECT_NAME:-$(jq -r '.projectName // "cell-demo"' "$CONFIG_FILE")}"
    REGIONS="${REGIONS:-$(jq -r '.regions | join(",") // "us-east-1,us-west-2"' "$CONFIG_FILE")}"
    DOMAIN_NAME="${DOMAIN_NAME:-$(jq -r '.domainName // empty' "$CONFIG_FILE")}"
    EDGE_DOMAIN="${EDGE_DOMAIN:-$(jq -r '.edgeDomain // empty' "$CONFIG_FILE")}"
    AWS_PROFILE_CONFIG=$(jq -r '.deployment.awsProfile // empty' "$CONFIG_FILE")
    if [ -n "$AWS_PROFILE_CONFIG" ] && [ "$AWS_PROFILE_CONFIG" != "null" ]; then
        export AWS_PROFILE="$AWS_PROFILE_CONFIG"
    fi
else
    PROJECT_NAME="${PROJECT_NAME:-cell-demo}"
    REGIONS="${REGIONS:-us-east-1,us-west-2}"
    DOMAIN_NAME="${DOMAIN_NAME:-}"
    EDGE_DOMAIN="${EDGE_DOMAIN:-}"
fi

PASS=0
FAIL=0

check() {
    local label="$1" ok="$2" detail="${3:-}"
    if [ "$ok" = "true" ]; then
        PASS=$((PASS + 1))
        echo -e "  ${GREEN}✓${NC} ${label}"
    else
        FAIL=$((FAIL + 1))
        echo -e "  ${RED}✗ ${label}${detail:+ — $detail}${NC}"
    fi
}

stack_output() {
    local stack="$1" key="$2" region="$3"
    aws cloudformation describe-stacks \
        --stack-name "$stack" --region "$region" \
        --query "Stacks[0].Outputs[?OutputKey==\`$key\`].OutputValue" \
        --output text 2>/dev/null
}

echo -e "${YELLOW}Cell demo smoke test — project '${PROJECT_NAME}'${NC}"
echo "================================================"

# --- Resolve endpoints -------------------------------------------------------
ROUTING_API=$(stack_output "${PROJECT_NAME}-routing" RoutingApiEndpoint us-east-1)
ADMIN_URL=$(stack_output "${PROJECT_NAME}-routing" AdminUrl us-east-1)
if [ -n "$DOMAIN_NAME" ]; then
    ROUTING_API="https://api.${DOMAIN_NAME}"
    ADMIN_URL="https://admin.${DOMAIN_NAME}"
fi

if [ -z "$ROUTING_API" ] || [ "$ROUTING_API" == "None" ]; then
    echo -e "${RED}Could not resolve the routing stack (${PROJECT_NAME}-routing in us-east-1). Is the demo deployed?${NC}"
    exit 1
fi
echo "Routing API: $ROUTING_API"
echo "Admin URL:   $ADMIN_URL"

CELL_URLS=""
CELL_API_URLS=""
CELL_IDS=""
IFS=',' read -ra REGION_ARRAY <<< "$REGIONS"
for region in "${REGION_ARRAY[@]}"; do
    CELL_STACKS=$(aws cloudformation list-stacks \
        --region "$region" \
        --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
        --query "StackSummaries[?starts_with(StackName, '${PROJECT_NAME}-cell-')].StackName" \
        --output text)
    for stack in $CELL_STACKS; do
        cell_id="${stack#${PROJECT_NAME}-cell-}"
        api=$(stack_output "$stack" ApiEndpoint "$region")
        cf=$(stack_output "$stack" CloudFrontUrl "$region")
        [ -z "$api" ] || [ "$api" == "None" ] && continue
        CELL_IDS="${CELL_IDS:+$CELL_IDS,}$cell_id"
        CELL_API_URLS="${CELL_API_URLS:+$CELL_API_URLS,}$api"
        CELL_URLS="${CELL_URLS:+$CELL_URLS,}$cf"
        echo "Cell $cell_id: $cf (api: $api)"
    done
done

if [ -z "$CELL_API_URLS" ]; then
    echo -e "${RED}No cell stacks found in regions: ${REGIONS}${NC}"
    exit 1
fi

# --- Routing layer -----------------------------------------------------------
echo -e "\n${YELLOW}Routing layer${NC}"

# Cells self-register on a 5-minute schedule; poll up to ~6 minutes.
registered=0
for i in $(seq 1 24); do
    registered=$(curl -sf "${ROUTING_API}/admin/cells" | jq '.cells | length' 2>/dev/null || echo 0)
    [ "$registered" -ge 1 ] && break
    [ "$i" -eq 1 ] && echo "  waiting for first cell registration (runs on a 5-minute schedule)..."
    sleep 15
done
check "cells registered in the registry (${registered})" "$([ "$registered" -ge 1 ] && echo true || echo false)" \
    "no cells after 6 min — check the ${PROJECT_NAME}-*-registration Lambda logs"

# Golden value from backend/lib/__tests__/consistent-hash.test.ts — proves the
# deployed router runs the same MD5 ring as the unit tests and the site.
hash_value=$(curl -sf "${ROUTING_API}/admin/client-route/user123" | jq -r '.hashValue' 2>/dev/null || echo "")
check "consistent-hash parity (md5('user123') → 1792101289)" \
    "$([ "$hash_value" == "1792101289" ] && echo true || echo false)" "got '${hash_value}'"

target1=$(curl -sf "${ROUTING_API}/admin/client-route/user123" | jq -r '.targetCell.cellId' 2>/dev/null || echo "")
target2=$(curl -sf "${ROUTING_API}/admin/client-route/user123" | jq -r '.targetCell.cellId' 2>/dev/null || echo "x")
check "routing is deterministic (user123 → ${target1})" \
    "$([ -n "$target1" ] && [ "$target1" == "$target2" ] && echo true || echo false)"

ring_total=$(curl -sf "${ROUTING_API}/admin/hash-ring" | jq -r '.totalVirtualNodes // 0' 2>/dev/null || echo 0)
check "hash ring populated (${ring_total} virtual nodes)" "$([ "$ring_total" -ge 1 ] && echo true || echo false)"

# --- Each cell ---------------------------------------------------------------
IFS=',' read -ra APIS <<< "$CELL_API_URLS"
IFS=',' read -ra IDS <<< "$CELL_IDS"
for i in "${!APIS[@]}"; do
    api="${APIS[$i]}"
    cid="${IDS[$i]}"
    echo -e "\n${YELLOW}Cell ${cid}${NC}"

    info_cell=$(curl -sf "${api}/info" | jq -r '.cellId' 2>/dev/null || echo "")
    check "/info returns cellId (${info_cell})" "$([ "$info_cell" == "$cid" ] && echo true || echo false)"

    health_code=$(curl -s -o /dev/null -w '%{http_code}' "${api}/health")
    check "/health responds (${health_code})" \
        "$([ "$health_code" == "200" ] || [ "$health_code" == "503" ] && echo true || echo false)"

    track_ok=$(curl -sf -X POST "${api}/track-client" \
        -H 'Content-Type: application/json' \
        -d "{\"clientId\":\"smoke-test-${cid}\",\"cellId\":\"${cid}\",\"sourceIp\":\"127.0.0.1\"}" \
        | jq -r '.success' 2>/dev/null || echo "")
    check "POST /track-client (per-cell tracking)" "$([ "$track_ok" == "true" ] && echo true || echo false)"

    seen=$(curl -sf "${api}/clients/cell/${cid}" \
        | jq -r "[.clients[].clientId] | index(\"smoke-test-${cid}\") != null" 2>/dev/null || echo "")
    check "GET /clients/cell/${cid} shows the tracked visit" "$([ "$seen" == "true" ] && echo true || echo false)"
done

# --- Optional single-hostname edge mode ---------------------------------------
# Skips cleanly when edgeDomain is not configured.
if [ -n "$EDGE_DOMAIN" ] && [ -n "$DOMAIN_NAME" ]; then
    EDGE_URL="https://${EDGE_DOMAIN}.${DOMAIN_NAME}"
    echo -e "\n${YELLOW}Edge mode (${EDGE_URL})${NC}"

    edge_root_code=$(curl -s -o /dev/null -w '%{http_code}' "${EDGE_URL}/")
    check "edge / serves the router page (${edge_root_code})" \
        "$([ "$edge_root_code" == "200" ] && echo true || echo false)"

    edge_router=$(curl -sf "${EDGE_URL}/" | grep -c "Cell Architecture Router" || echo 0)
    check "edge / contains the router markup" "$([ "$edge_root_code" == "200" ] && [ "$edge_router" -ge 1 ] && echo true || echo false)"

    edge_hash=$(curl -sf "${EDGE_URL}/api/admin/client-route/user123" | jq -r '.hashValue' 2>/dev/null || echo "")
    check "edge /api reaches the routing API (md5('user123') → 1792101289)" \
        "$([ "$edge_hash" == "1792101289" ] && echo true || echo false)" "got '${edge_hash}'"

    IFS=',' read -ra EDGE_IDS <<< "$CELL_IDS"
    for cid in "${EDGE_IDS[@]}"; do
        page_code=$(curl -s -o /dev/null -w '%{http_code}' "${EDGE_URL}/${cid}/")
        check "edge /${cid}/ serves the cell page (${page_code})" \
            "$([ "$page_code" == "200" ] && echo true || echo false)"

        edge_cell=$(curl -sf "${EDGE_URL}/${cid}/api/info" | jq -r '.cellId' 2>/dev/null || echo "")
        check "edge /${cid}/api/info returns cellId (${edge_cell})" \
            "$([ "$edge_cell" == "$cid" ] && echo true || echo false)"
    done
else
    echo -e "\n${YELLOW}Edge mode not configured - skipping edge checks.${NC}"
fi

# --- Summary -----------------------------------------------------------------
echo -e "\n================================================"
if [ "$FAIL" -eq 0 ]; then
    echo -e "${GREEN}All ${PASS} checks passed.${NC}"
else
    echo -e "${RED}${FAIL} of $((PASS + FAIL)) checks failed.${NC}"
fi

echo -e "\nRun the full E2E suite with:"
echo "  cd tests && \\"
echo "  ADMIN_BASE_URL=${ADMIN_URL} \\"
echo "  ROUTING_API_URL=${ROUTING_API} \\"
echo "  CELL_URLS=${CELL_URLS} \\"
echo "  CELL_API_URLS=${CELL_API_URLS} \\"
echo "  npm test"

exit "$([ "$FAIL" -eq 0 ] && echo 0 || echo 1)"
