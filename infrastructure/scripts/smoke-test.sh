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

# Registry rows carry each cell's own API endpoint (needed by the failover
# demo); populated on the cell's 5-minute registration heartbeat.
apiurl_ok=$(curl -sf "${ROUTING_API}/admin/cell-urls" \
    | jq -r '(.cellUrls | length > 0) and ([.cellUrls[] | has("apiUrl")] | all)' 2>/dev/null || echo "")
check "/admin/cell-urls rows include apiUrl" "$([ "$apiurl_ok" == "true" ] && echo true || echo false)" \
    "redeploy the routing stack and wait for a cell heartbeat"

# Failover demo must be DISARMED at rest (armed = paid health checks accruing).
if [ -n "$DOMAIN_NAME" ]; then
    fo_armed=$(curl -sf "${ROUTING_API}/admin/failover/status" | jq -r '.armed' 2>/dev/null || echo "")
    check "failover demo is disarmed (armed=false)" "$([ "$fo_armed" == "false" ] && echo true || echo false)" \
        "armed='${fo_armed}' — POST ${ROUTING_API}/admin/failover/disarm when the demo is done"
else
    fo_code=$(curl -s -o /dev/null -w '%{http_code}' "${ROUTING_API}/admin/failover/status")
    check "failover status reports unconfigured domain (503)" \
        "$([ "$fo_code" == "503" ] && echo true || echo false)" "got HTTP ${fo_code}"
fi

# Quorum demo must be DISARMED at rest (armed ≈ $0.12/hr: paid health checks
# PLUS ~27k checker requests/hr). These routes work without a custom domain.
q_armed=$(curl -sf "${ROUTING_API}/admin/quorum/status" | jq -r '.armed' 2>/dev/null || echo "")
check "quorum demo is disarmed (armed=false)" "$([ "$q_armed" == "false" ] && echo true || echo false)" \
    "armed='${q_armed}' — POST ${ROUTING_API}/admin/quorum/disarm when the demo is done"

# The public checker target must answer 503 (vote off) at rest. A 403/404
# would mean the route is missing/misdeployed — armed checkers would then
# read every voter as permanently down.
vs_code=$(curl -s -o /dev/null -w '%{http_code}' "${ROUTING_API}/vote-status/1")
check "/vote-status/1 answers 503 at rest (vote off, route present)" \
    "$([ "$vs_code" == "503" ] && echo true || echo false)" "got HTTP ${vs_code}"

# --- Idempotency demo (skips cleanly when the idem stacks aren't deployed) ---
idem_status=$(curl -s "${ROUTING_API}/admin/idem/status" 2>/dev/null)
idem_configured=$(echo "$idem_status" | jq -r '.configured' 2>/dev/null || echo "")
if [ "$idem_configured" == "true" ]; then
    echo -e "\n${YELLOW}Idempotency demo${NC}"

    idem_regions=$(echo "$idem_status" | jq -r '.regions | length' 2>/dev/null || echo 0)
    check "idem status lists both regions (${idem_regions})" \
        "$([ "$idem_regions" -ge 2 ] && echo true || echo false)"

    idem_healthy=$(echo "$idem_status" \
        | jq -r '[.regions[] | (.health.status? // .health)] | all(. == "healthy")' 2>/dev/null || echo "")
    check "idem regions report healthy" "$([ "$idem_healthy" == "true" ] && echo true || echo false)" \
        "kill switches must be off outside a live demo (POST ${ROUTING_API}/admin/idem/chaos)"

    # Dedupe proof: the same orderId paid twice (shared mode) must return the
    # SAME chargeId — the second call is served from the idempotency store.
    idem_order="smoke-idem-$(date +%s)"
    idem_region=$(echo "$idem_status" | jq -r '.regions[0].region' 2>/dev/null || echo "")
    idem_pay() {
        curl -s -X POST "${ROUTING_API}/admin/idem/pay" \
            -H 'Content-Type: application/json' \
            -d "{\"region\":\"${idem_region}\",\"orderId\":\"${idem_order}\",\"amount\":42,\"mode\":\"shared\"}" \
            | jq -r '.chargeId // .receipt.chargeId // empty' 2>/dev/null
    }
    charge1=$(idem_pay)
    charge2=$(idem_pay)
    check "idempotent dedupe: retried pay returns the same chargeId" \
        "$([ -n "$charge1" ] && [ "$charge1" == "$charge2" ] && echo true || echo false)" \
        "got '${charge1}' then '${charge2}'"
else
    echo -e "\n${YELLOW}Idempotency demo not configured (needs >= 2 regions) - skipping idem checks.${NC}"
fi

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

    chaos_enabled=$(curl -sf "${api}/chaos" | jq -r '.chaos.enabled' 2>/dev/null || echo "")
    check "GET /chaos reports disabled" "$([ "$chaos_enabled" == "false" ] && echo true || echo false)" \
        "got '${chaos_enabled}' — chaos must be off outside a live failover demo"
done

# --- Failover demo (opt-in: mutates DNS and creates paid health checks) -------
# SMOKE_FAILOVER=1 runs a live arm → verify → disarm cycle and asserts zero
# leftovers. Only run against a deployment you own, with a custom domain.
if [ "${SMOKE_FAILOVER:-0}" == "1" ]; then
    echo -e "\n${YELLOW}Failover demo (SMOKE_FAILOVER=1 — real Route 53 mutations)${NC}"

    cell_count=$(echo "$CELL_IDS" | tr ',' '\n' | grep -c .)
    if [ -z "$DOMAIN_NAME" ]; then
        check "failover smoke requires a custom domain" false "set domainName in config.json or unset SMOKE_FAILOVER"
    elif [ "$cell_count" -lt 2 ]; then
        check "failover smoke requires at least 2 cells (found ${cell_count})" false
    else
        primary_id=$(echo "$CELL_IDS" | cut -d',' -f1)
        secondary_id=$(echo "$CELL_IDS" | cut -d',' -f2)

        arm_resp=$(curl -s -X POST "${ROUTING_API}/admin/failover/arm" \
            -H 'Content-Type: application/json' \
            -d "{\"primaryCellId\":\"${primary_id}\",\"secondaryCellId\":\"${secondary_id}\"}")
        arm_ok=$(echo "$arm_resp" | jq -r '.armed' 2>/dev/null || echo "")
        check "arm (primary=${primary_id}, secondary=${secondary_id})" \
            "$([ "$arm_ok" == "true" ] && echo true || echo false)" \
            "$(echo "$arm_resp" | jq -r '.error // empty' 2>/dev/null) (422? cells register apiUrl on their 5-minute heartbeat)"

        if [ "$arm_ok" == "true" ]; then
            fo_status=$(curl -sf "${ROUTING_API}/admin/failover/status")

            # .healthChecks is an ARRAY ordered primary-first (never a keyed object)
            hc_count=$(echo "$fo_status" | jq -r \
                '[.healthChecks[]?.healthCheckId | select(. != null and . != "")] | length' \
                2>/dev/null || echo 0)
            check "status shows 2 health checks" "$([ "$hc_count" == "2" ] && echo true || echo false)" "got ${hc_count}"

            cname_count=$(echo "$fo_status" | jq -r \
                '[.records[] | select(.type == "CNAME")] | length' 2>/dev/null || echo 0)
            check "2 failover CNAME record sets live" "$([ "$cname_count" == "2" ] && echo true || echo false)" "got ${cname_count}"

            probe_fqdn=$(curl -sf "${ROUTING_API}/admin/failover/probe" | jq -r '.fqdn' 2>/dev/null || echo "")
            check "probe answers for failover.${DOMAIN_NAME}" \
                "$([ "$probe_fqdn" == "failover.${DOMAIN_NAME}" ] && echo true || echo false)"
        fi

        disarm_resp=$(curl -s -X POST "${ROUTING_API}/admin/failover/disarm")
        disarm_ok=$(echo "$disarm_resp" | jq -r '.armed' 2>/dev/null || echo "")
        check "disarm (armed=false)" "$([ "$disarm_ok" == "false" ] && echo true || echo false)"

        # Zero leftovers: no failover.* record sets (route53-info lists A+CNAME
        # at that name) and no health checks created under our CallerReference
        # prefix (arm always uses {project}-failover-{cellId}-{timestamp}).
        leftover_records=$(curl -sf "${ROUTING_API}/route53-info" | jq -r '.records | length' 2>/dev/null || echo "?")
        check "no leftover failover.* record sets" "$([ "$leftover_records" == "0" ] && echo true || echo false)" \
            "found ${leftover_records}"

        leftover_checks=$(aws route53 list-health-checks \
            --query "HealthChecks[?starts_with(CallerReference, '${PROJECT_NAME}-failover-')]" \
            --output json 2>/dev/null | jq -r 'length' 2>/dev/null || echo "?")
        check "no leftover failover health checks" "$([ "$leftover_checks" == "0" ] && echo true || echo false)" \
            "found ${leftover_checks} tagged ${PROJECT_NAME}-failover-*"
    fi
else
    echo -e "\n${YELLOW}Failover live checks skipped (set SMOKE_FAILOVER=1 to arm/verify/disarm for real).${NC}"
fi

# --- Quorum demo (opt-in: creates paid health checks, ~$0.12/hr while armed) --
# SMOKE_QUORUM=1 runs a live arm → verify → below-threshold flip → disarm
# cycle and asserts zero leftovers. Works with or without a custom domain.
if [ "${SMOKE_QUORUM:-0}" == "1" ]; then
    echo -e "\n${YELLOW}Quorum demo (SMOKE_QUORUM=1 — real Route 53 health checks)${NC}"

    q_arm_resp=$(curl -s -X POST "${ROUTING_API}/admin/quorum/arm" \
        -H 'Content-Type: application/json' -d '{}')
    q_arm_ok=$(echo "$q_arm_resp" | jq -r '.armed' 2>/dev/null || echo "")
    check "quorum arm (threshold 3 of 5)" "$([ "$q_arm_ok" == "true" ] && echo true || echo false)" \
        "$(echo "$q_arm_resp" | jq -r '.error // empty' 2>/dev/null)"

    if [ "$q_arm_ok" == "true" ]; then
        q_status=$(curl -sf "${ROUTING_API}/admin/quorum/status")

        voter_count=$(echo "$q_status" | jq -r '.voters | length' 2>/dev/null || echo 0)
        check "status shows 5 voters (array)" "$([ "$voter_count" == "5" ] && echo true || echo false)" "got ${voter_count}"

        q_threshold=$(echo "$q_status" | jq -r '.parent.threshold' 2>/dev/null || echo "")
        check "parent HealthThreshold is 3" "$([ "$q_threshold" == "3" ] && echo true || echo false)" "got '${q_threshold}'"

        seed_version=$(echo "$q_status" | jq -r '[.decisionLog[].version] | min' 2>/dev/null || echo "")
        check "decision log seeded at v126" "$([ "$seed_version" == "126" ] && echo true || echo false)" "got '${seed_version}'"

        cost_ok=$(echo "$q_status" | jq -r \
            '.estimatedCost | has("healthChecksPerHourUsd") and has("checkerTrafficPerHourUsd")' 2>/dev/null || echo "")
        check "cost reports BOTH components (checks + checker traffic)" \
            "$([ "$cost_ok" == "true" ] && echo true || echo false)"

        vs_armed_code=$(curl -s -o /dev/null -w '%{http_code}' "${ROUTING_API}/vote-status/1")
        check "/vote-status/1 answers 200 while armed (vote on)" \
            "$([ "$vs_armed_code" == "200" ] && echo true || echo false)" "got HTTP ${vs_armed_code}"

        # Checkers need a couple of observation rounds to see the votes and
        # cross the threshold; poll up to ~3 minutes.
        parent_status=""
        for i in $(seq 1 18); do
            parent_status=$(curl -sf "${ROUTING_API}/admin/quorum/status" | jq -r '.parent.status' 2>/dev/null || echo "")
            [ "$parent_status" == "healthy" ] && break
            sleep 10
        done
        check "parent reaches healthy (quorum met)" \
            "$([ "$parent_status" == "healthy" ] && echo true || echo false)" "got '${parent_status}' after 3 min"

        stored_version=$(curl -sf "${ROUTING_API}/admin/quorum/status" | jq -r '.storedControl.version' 2>/dev/null || echo 0)
        check "stored control committed v127 (Routing = Enabled)" \
            "$([ "$stored_version" -ge 127 ] 2>/dev/null && echo true || echo false)" "got v${stored_version}"

        # Below-threshold flip: turn 3 votes off → 2 healthy < 3.
        for i in 1 2 3; do
            curl -s -X POST "${ROUTING_API}/admin/quorum/vote" \
                -H 'Content-Type: application/json' -d "{\"i\":${i},\"on\":false}" >/dev/null
        done
        parent_after=""
        for i in $(seq 1 18); do
            parent_after=$(curl -sf "${ROUTING_API}/admin/quorum/status" | jq -r '.parent.status' 2>/dev/null || echo "")
            [ "$parent_after" == "unhealthy" ] && break
            sleep 10
        done
        check "parent drops below threshold after 3 no-votes" \
            "$([ "$parent_after" == "unhealthy" ] && echo true || echo false)" "got '${parent_after}' after 3 min"

        flip_version=$(curl -sf "${ROUTING_API}/admin/quorum/status" | jq -r '.storedControl.version' 2>/dev/null || echo 0)
        check "decision log recorded the flip (version advanced)" \
            "$([ "$flip_version" -gt "$stored_version" ] 2>/dev/null && echo true || echo false)" \
            "still v${flip_version}"
    fi

    q_disarm_ok=$(curl -s -X POST "${ROUTING_API}/admin/quorum/disarm" | jq -r '.armed' 2>/dev/null || echo "")
    check "quorum disarm (armed=false)" "$([ "$q_disarm_ok" == "false" ] && echo true || echo false)"

    leftover_quorum=$(aws route53 list-health-checks \
        --query "HealthChecks[?starts_with(CallerReference, '${PROJECT_NAME}-quorum-')]" \
        --output json 2>/dev/null | jq -r 'length' 2>/dev/null || echo "?")
    check "no leftover quorum health checks" "$([ "$leftover_quorum" == "0" ] && echo true || echo false)" \
        "found ${leftover_quorum} tagged ${PROJECT_NAME}-quorum-*"

    vs_rest_code=$(curl -s -o /dev/null -w '%{http_code}' "${ROUTING_API}/vote-status/1")
    check "/vote-status/1 back to 503 after disarm" \
        "$([ "$vs_rest_code" == "503" ] && echo true || echo false)" "got HTTP ${vs_rest_code}"
else
    echo -e "\n${YELLOW}Quorum live checks skipped (set SMOKE_QUORUM=1 to arm/verify/disarm for real).${NC}"
fi

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
