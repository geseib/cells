"""Idempotency-across-failover demo: the per-region payment API.

One Lambda, five routes:

  POST /pay      {orderId, amount, mode: shared|isolated} -> receipt
  GET  /records  bounded scans (arrays) of the shared-table replica, the
                 local idempotency store, and the real charge rows
  GET  /health   200 healthy / 503 while the KILL flag is active
  GET  /chaos    current KILL flag state
  POST /chaos    {enabled, durationMinutes} -> set/clear the KILL flag

Powertools binds ONE persistence store to a decorated function at import
time, so per-request store switching is impossible by design. The demo
therefore ships two module-level wrappers around the same _do_charge:

  charge_shared   -> {project}-idem-shared  (DynamoDB GLOBAL table: the
                     idempotency record replicates to the other region, so a
                     retry there returns THIS region's stored receipt - the
                     receipt's `region` field is the visual proof)
  charge_isolated -> {project}-idem-local   (region-local table: the retry in
                     the other region finds no record and charges AGAIN)

Dedupe is proven honestly, not with a synthetic "idempotentHit" flag: a
deduped retry returns the IDENTICAL chargeId/executionId, and the count of
real CHARGE#{orderId}#... rows in the local table shows how many times money
actually moved (1 = deduped, 2 = double charge).
"""

import json
import os
import time
import traceback
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from aws_lambda_powertools.utilities.idempotency import (
    DynamoDBPersistenceLayer,
    IdempotencyConfig,
    idempotent_function,
)
from aws_lambda_powertools.utilities.idempotency.exceptions import (
    IdempotencyAlreadyInProgressError,
)

REGION = os.environ.get("AWS_REGION", "unknown")
SHARED_TABLE_NAME = os.environ.get("SHARED_TABLE_NAME", "")
LOCAL_TABLE_NAME = os.environ.get("LOCAL_TABLE_NAME", "")

# KILL flag: mirrors the cell chaos semantics (cell-health.ts). The expiry is
# code-honored - the KILL item's `expiresAt` (epoch millis) is checked on
# every read, so a forgotten flag can never wedge the demo region for longer
# than KILL_MAX_MINUTES, even though nothing ever deletes the item.
KILL_DEFAULT_MINUTES = 30
KILL_MAX_MINUTES = 120
KILL_ITEM_ID = "KILL"

SCAN_LIMIT = 50  # /records is a bounded under-the-covers peek, not an export

# --- Cold start --------------------------------------------------------------
# Everything below runs once per Lambda container. Both persistence layers and
# both boto3 table handles are module-level: constructing them makes no
# network calls, and reusing them across invocations is what keeps the warm
# path to a single-digit-millisecond DynamoDB round trip. The first request
# after a region "recovers" pays the usual cold-start price - that is real and
# the demo does not hide it.
_dynamodb = boto3.resource("dynamodb")
_local_table = _dynamodb.Table(LOCAL_TABLE_NAME)
_shared_table = _dynamodb.Table(SHARED_TABLE_NAME)

_shared_store = DynamoDBPersistenceLayer(table_name=SHARED_TABLE_NAME)
_local_store = DynamoDBPersistenceLayer(table_name=LOCAL_TABLE_NAME)

# How long a COMPLETED idempotency record keeps deduping (Powertools writes
# now + expires_after_seconds into the `expiration` attr; the tables' TTL
# garbage-collects it afterwards). One hour is plenty for a live demo.
IDEM_CONFIG = IdempotencyConfig(expires_after_seconds=3600)

HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}


def _plain(value):
    """Recursively convert boto3 Decimals so items JSON-serialize."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, dict):
        return {key: _plain(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_plain(item) for item in value]
    return value


def _response(status_code, body):
    payload = dict(_plain(body))
    payload["timestamp"] = datetime.now(timezone.utc).isoformat()
    return {"statusCode": status_code, "headers": HEADERS, "body": json.dumps(payload)}


def _now_ms():
    return int(time.time() * 1000)


def _do_charge(payment):
    """The one true 'move the money' step (pretend money, real writes).

    Runs AT MOST ONCE per idempotency key per store: writes a real
    CHARGE#{orderId}#{uuid} row into the LOCAL table (charges always live in
    the region that executed them - that is the evidence trail), then returns
    the receipt that Powertools persists as the idempotency record's data.
    """
    charge_id = f"ch_{uuid.uuid4().hex[:12]}"
    processed_at = datetime.now(timezone.utc).isoformat()
    receipt = {
        "orderId": payment["orderId"],
        "amount": payment["amount"],
        "chargeId": charge_id,
        "region": REGION,
        "processedAt": processed_at,
        "executionId": uuid.uuid4().hex[:8],
    }
    _local_table.put_item(
        Item={
            "id": f"CHARGE#{payment['orderId']}#{uuid.uuid4().hex[:8]}",
            "orderId": payment["orderId"],
            "amount": Decimal(str(payment["amount"])),
            "chargeId": charge_id,
            "region": REGION,
            "processedAt": processed_at,
        }
    )
    return receipt


# Two wrappers, not one with a switch: @idempotent_function binds its
# persistence_store when the module loads, so shared vs isolated MUST be two
# separately-decorated functions dispatched on `mode` (see module docstring).
@idempotent_function(
    data_keyword_argument="payment", persistence_store=_shared_store, config=IDEM_CONFIG
)
def charge_shared(payment):
    return _do_charge(payment)


@idempotent_function(
    data_keyword_argument="payment", persistence_store=_local_store, config=IDEM_CONFIG
)
def charge_isolated(payment):
    return _do_charge(payment)


# --- KILL flag ---------------------------------------------------------------

def _read_kill():
    return _local_table.get_item(Key={"id": KILL_ITEM_ID}).get("Item")


def _kill_active(item):
    if not item or item.get("enabled") is not True:
        return False
    expires_at = _plain(item.get("expiresAt", 0))
    return isinstance(expires_at, (int, float)) and expires_at > _now_ms()


def _kill_expires_at(duration_minutes):
    requested = (
        duration_minutes
        if isinstance(duration_minutes, (int, float))
        and not isinstance(duration_minutes, bool)
        and duration_minutes > 0
        else KILL_DEFAULT_MINUTES
    )
    return _now_ms() + int(min(requested, KILL_MAX_MINUTES) * 60_000)


# --- Routes ------------------------------------------------------------------

def _handle_pay(event):
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _response(400, {"error": "Request body must be JSON"})

    order_id = body.get("orderId")
    amount = body.get("amount")
    mode = body.get("mode")

    if not isinstance(order_id, str) or not order_id.strip():
        return _response(400, {"error": "orderId (non-empty string) is required"})
    if not isinstance(amount, (int, float)) or isinstance(amount, bool) or amount <= 0:
        return _response(400, {"error": "amount (positive number) is required"})
    if mode not in ("shared", "isolated"):
        return _response(400, {"error": "mode must be 'shared' or 'isolated'"})

    kill = _read_kill()
    if _kill_active(kill):
        return _response(503, {
            "error": "Region is killed (chaos flag active) - payment refused",
            "region": REGION,
            "killed": True,
            "chaos": {"enabled": True, "expiresAt": _plain(kill.get("expiresAt"))},
        })

    # Powertools hashes the WHOLE payment dict (md5 over its sorted JSON) into
    # the idempotency key. Same orderId + same amount = same key = dedupe.
    # Change the amount by a cent and it is a NEW key - a legitimately new
    # payment, charged again on purpose. That is the payload-hash lesson.
    payment = {"orderId": order_id.strip(), "amount": amount}

    try:
        if mode == "shared":
            receipt = charge_shared(payment=payment)
        else:
            receipt = charge_isolated(payment=payment)
    except IdempotencyAlreadyInProgressError:
        # A concurrent request holds the INPROGRESS record for this exact
        # payment (the immediate-retry race). Honest outcome: report it,
        # never fake a result.
        return _response(409, {
            "error": "A payment with this exact payload is already in progress - retry after it completes",
            "region": REGION,
            "orderId": payment["orderId"],
            "inProgress": True,
        })

    return _response(200, {**receipt, "mode": mode, "servedBy": REGION})


def _format_idem_record(item):
    """Correction 11: Powertools record ids are HASHED (module.function#md5),
    so the under-the-covers view returns the raw id AND the parsed stored
    data side by side."""
    raw = _plain(item)
    data = raw.get("data")
    parsed = None
    if isinstance(data, str):
        try:
            parsed = json.loads(data)
        except json.JSONDecodeError:
            parsed = None
    parsed_dict = parsed if isinstance(parsed, dict) else {}
    return {
        "id": raw.get("id"),
        "status": raw.get("status"),
        "expiration": raw.get("expiration"),
        "data": parsed,
        "orderId": parsed_dict.get("orderId"),
        "chargeId": parsed_dict.get("chargeId"),
        "region": parsed_dict.get("region"),
    }


def _handle_records():
    shared_items = []
    shared_error = None
    try:
        shared_items = _shared_table.scan(Limit=SCAN_LIMIT).get("Items", [])
    except Exception as error:  # noqa: BLE001 - replica may not exist yet
        shared_error = str(error)

    local_items = _local_table.scan(Limit=SCAN_LIMIT).get("Items", [])

    isolated = []
    charges = []
    for item in local_items:
        item_id = str(item.get("id", ""))
        if item_id == KILL_ITEM_ID:
            continue
        if item_id.startswith("CHARGE#"):
            charges.append(_plain(item))
        else:
            isolated.append(_format_idem_record(item))

    body = {
        "region": REGION,
        "shared": [_format_idem_record(item) for item in shared_items],
        "isolated": isolated,
        "charges": charges,
    }
    if shared_error:
        body["sharedError"] = shared_error
    return _response(200, body)


def _handle_health():
    kill = _read_kill()
    if _kill_active(kill):
        return _response(503, {
            "region": REGION,
            "status": "failing (chaos)",
            "killed": True,
            "chaos": {"enabled": True, "expiresAt": _plain(kill.get("expiresAt"))},
        })
    return _response(200, {
        "region": REGION,
        "status": "healthy",
        "killed": False,
        "chaos": {"enabled": False},
    })


def _handle_chaos(event, method):
    if method == "GET":
        kill = _read_kill()
        if _kill_active(kill):
            chaos = {"enabled": True, "expiresAt": _plain(kill.get("expiresAt"))}
        else:
            chaos = {"enabled": False}
        return _response(200, {"region": REGION, "chaos": chaos})

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _response(400, {"error": "Request body must be JSON"})

    if body.get("enabled") is True:
        expires_at = _kill_expires_at(body.get("durationMinutes"))
        _local_table.put_item(
            Item={
                "id": KILL_ITEM_ID,
                "enabled": True,
                "expiresAt": Decimal(expires_at),
                "setAt": datetime.now(timezone.utc).isoformat(),
            }
        )
        return _response(200, {"region": REGION, "chaos": {"enabled": True, "expiresAt": expires_at}})

    _local_table.delete_item(Key={"id": KILL_ITEM_ID})
    return _response(200, {"region": REGION, "chaos": {"enabled": False}})


def handler(event, context):
    # Lets Powertools honor the remaining invocation time on INPROGRESS records.
    IDEM_CONFIG.register_lambda_context(context)

    method = event.get("httpMethod", "")
    path = event.get("path") or ""

    if method == "OPTIONS":
        return {"statusCode": 200, "headers": HEADERS, "body": ""}

    try:
        if path.endswith("/pay") and method == "POST":
            return _handle_pay(event)
        if path.endswith("/records") and method == "GET":
            return _handle_records()
        if path.endswith("/health") and method == "GET":
            return _handle_health()
        if path.endswith("/chaos") and method in ("GET", "POST"):
            return _handle_chaos(event, method)
        return _response(404, {"error": "Not found"})
    except Exception:  # noqa: BLE001
        print("Unhandled error in idempotency pay handler:", traceback.format_exc())
        return _response(500, {"error": "Internal server error", "region": REGION})
