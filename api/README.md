# Casino Rail API Sandbox

Runnable **game-integration API** stub for the Casino Rail PoC.

- Spec: `docs/game-integration-api.md` + OpenAPI companion
- Stack: Node.js 20+ · TypeScript · Express · in-memory ledger
- Chain/asset stance: **Sui testnet USDC** deposit detection via GraphQL (no live signing / no Rail sole-sign withdrawals)
- Games: **Hello Dice**, **Horizon Limbo**, **Twin Face** (`outcome_mode: rail_pf`) + **RGS mock** (`rgs_mock_slots`)
- Multi-tenant: `operator_id` in JWT (+ optional `X-Operator-Id`); fund segregation per operator (`op_demo_A` / `op_demo_B` isolation demo)
- Amounts: integer **minor units** only · `X-Rail-Env: sandbox` required
- CORS: open to `localhost` / `127.0.0.1` for parallel frontend demos

## Quick start

```bash
cd /cursor/stores/self/apps/casino-rail-api
npm install
npm run dev
```

Server listens on **`http://127.0.0.1:8787`** (`PORT` / `HOST` override).

### Cloud Agent / FUSE store note

If `npm install` into this Project store path is slow or incomplete (FUSE), use the local-disk mirror helper:

```bash
bash /cursor/stores/self/apps/casino-rail-api/scripts/dev-local.sh
# mirrors to /tmp/casino-rail-api (override with CASINO_RAIL_MIRROR), then npm run dev
```

| Path | Purpose |
|---|---|
| `GET /health` | Liveness |
| `GET /v1/demo/credentials` | Seeded studio/player credentials |
| `POST /v1/auth/token` | Studio access token |
| `POST /v1/sessions/launch` | Session + launch_token |
| `GET /v1/deposits/address` | Operator receive address + USDC instructions |
| `GET /v1/deposits/watcher` | Deposit poller status |
| `POST /v1/deposits/usdc/detect` | Detect on-chain / dry-run fixture USDC credit |
| `POST /v1/deposits/usdc` | Mock stub credit (`mock:true`) |
| `npm run rgs-mock` | External RGS-style place→settle against a running server |

### Demo credentials (seeded on boot)

| Field | Value |
|---|---|
| `client_id` | `studio_demo_01` |
| `client_secret` | `sk_sandbox_demo_secret` |
| `operator_id` | `op_demo_01` |
| `player_id` | `player_demo_42` |
| starting balance | `100000` minor USD (= $1,000.00) |

Isolation tenants (PoC step C):

| | A | B |
|---|---|---|
| `operator_id` | `op_demo_A` | `op_demo_B` |
| `client_id` | `studio_demo_A` | `studio_demo_B` |
| `client_secret` | `sk_sandbox_demo_secret_A` | `sk_sandbox_demo_secret_B` |
| `player_id` | `player_A_01` | `player_B_01` |
| starting | `200000` | `150000` |

```bash
npm run tenant-isolation-demo
```

Credits A, bets on A, asserts B unchanged; cross-tenant HTTP calls expect **403**. Admin UI: `/admin/tenants` · API: `GET /v1/admin/tenants`.

### 3-way reconciliation (PoC step D)

```bash
npm run recon-demo
```

Injects missing/duplicate anomalies across game · Rail · chain/fixture legs, asserts **100%** detection and open tickets, then clears → resolve. Admin UI: `/admin/reconciliation`.

| Method | Path |
|---|---|
| `GET` | `/v1/admin/reconciliation` |
| `POST` | `/v1/admin/reconciliation/run` |
| `POST` | `/v1/admin/reconciliation/inject` |
| `GET` | `/v1/admin/reconciliation/tickets` |

## Hello Dice curl sequence

```bash
BASE=http://127.0.0.1:8787/v1
HDR=(-H "Content-Type: application/json" -H "X-Rail-Env: sandbox")

# 1) Studio token
TOKEN=$(curl -s "$BASE/auth/token" "${HDR[@]}" -d '{
  "grant_type":"client_credentials",
  "client_id":"studio_demo_01",
  "client_secret":"sk_sandbox_demo_secret",
  "scope":"games:play games:admin"
}' | jq -r .access_token)

# 2) Launch session (rail_pf)
LAUNCH=$(curl -s "$BASE/sessions/launch" "${HDR[@]}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "X-Operator-Id: op_demo_01" \
  -d '{
    "player_id":"player_demo_42",
    "game_id":"hello_dice",
    "currency":"USD",
    "locale":"ko",
    "meta":{"outcome_mode":"rail_pf"}
  }')
echo "$LAUNCH" | jq .
SESSION=$(echo "$LAUNCH" | jq -r .session_id)

# 3) Optional client seed
curl -s "$BASE/sessions/$SESSION/fairness/client-seed" "${HDR[@]}" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"client_seed":"hello-day-1"}' | jq .

# 4) Place bet ($10.00 → amount 1000)
PLACE=$(curl -s "$BASE/sessions/$SESSION/bets" "${HDR[@]}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "game_id":"hello_dice",
    "round_id":"round_1001",
    "amount":1000,
    "currency":"USD",
    "bet_type":"roll_over",
    "payload":{"target":50.5,"condition":"over"}
  }')
echo "$PLACE" | jq .
BET=$(echo "$PLACE" | jq -r .bet_id)
PAYOUT=$(echo "$PLACE" | jq -r .outcome_preview.payout)

# 5) Settle using rail_pf preview payout
curl -s "$BASE/sessions/$SESSION/bets/$BET/settle" "${HDR[@]}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d "{\"payout\":$PAYOUT,\"outcome\":$(echo "$PLACE" | jq -c .outcome_preview)}" | jq .

# 6) History + fairness rotate (reveal previous server seed)
curl -s "$BASE/sessions/$SESSION/rounds" "${HDR[@]}" \
  -H "Authorization: Bearer $TOKEN" | jq .
curl -s -X POST "$BASE/sessions/$SESSION/fairness/rotate" "${HDR[@]}" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

## RGS mock

With the server running:

```bash
npm run rgs-mock
```

Uses `game_id: rgs_mock_slots`, `outcome_mode: studio`, places a spin, then settles with a mock symbol outcome.

## Sui testnet USDC deposits

Receive address (operator self-custody; key **not** in repo):

`0x3aa824c37d8f570837b073f0acc09a1936c590c4ab3a990493c8e808a342d1c1`

Watcher starts with the API process (disable with `SUI_DEPOSIT_WATCHER=0`). Detection uses GraphQL because Foundation JSON-RPC is deprecated.

```bash
# Address + instructions (no auth)
curl -s http://127.0.0.1:8787/v1/deposits/address | jq .

# Dry-run fixture replay (no faucet needed)
npx tsx src/scripts/deposit-detect.ts --fixture

# Or HTTP detect
curl -s http://127.0.0.1:8787/v1/deposits/usdc/detect \
  -H "Content-Type: application/json" \
  -H "X-Rail-Env: sandbox" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Operator-Id: op_demo_01" \
  -d '{"digest":"dryrun_B5F7Be1srK6nARNzB9YqnipvYnEq5XCZW12WSTi2BjJj","player_id":"player_demo_42","dry_run":true}' | jq .

# Legacy mock stub
curl -s http://127.0.0.1:8787/v1/deposits/usdc \
  -H "Content-Type: application/json" \
  -H "X-Rail-Env: sandbox" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "player_id":"player_demo_42",
    "amount":5000,
    "tx_id":"mock_tx_abc",
    "mock": true,
    "chain":"sui-testnet",
    "asset":"USDC"
  }' | jq .
```

Credits sandbox ledger only. Withdrawals: fail-closed policy + admin approve → **unsigned** payout intent (Rail never sole-signs / never loads keys).

## Admin console API (SANDBOX)

Requires studio `access_token` with `games:admin`. Reads are not audited; mutating admin actions append to the immutable audit stream.

| Path | Purpose |
|---|---|
| `GET /v1/admin/dashboard` | Counts + balances + recent audit |
| `GET /v1/admin/players` | Player accounts + policy stubs |
| `GET /v1/admin/bets` · `/rounds` | Bets / rounds |
| `GET /v1/admin/deposits` | `deposit_credit` journal rows |
| `GET /v1/admin/withdrawals` | Withdrawal queue |
| `GET /v1/admin/audit/events` | Append-only stream (`?type=` / `?action_prefix=`) |

Audit events are frozen after append; there is no update/delete route.

## Deviations from OpenAPI

1. **Extra** `GET/POST /v1/deposits/*` — Sui USDC address, watcher, detect, mock stub (not in OpenAPI path list).
2. **Extra** `GET /v1/demo/credentials` and `GET /health` — local DX helpers.
3. **Extra** `/v1/withdrawals*` · `/v1/admin/*` — PoC withdraw policy + admin console / audit.
4. **Extra** response fields: `operator_id`, `outcome_mode` on launch; deposit note.
5. **WebSocket `/v1/ws`** — not implemented (REST is ledger source of truth per spec).
6. **Webhook delivery** — endpoints can be registered; outbound HMAC delivery/retries are stubbed (no live HTTP fan-out).
7. **`AUTH_TOKEN_REUSED`** — launch token binds once per session; same-session reuse for subsequent calls is allowed (studio `access_token` still preferred for play).
8. **Currency** — sandbox locked to `USD` minor units representing USDC sandbox balance (PoC preference: Sui USDC only).
9. **Error code** `PAYOUT_CAP_EXCEEDED` / `OPERATOR_NOT_FOUND` — sandbox additions beyond the OpenAPI enum.

## Ledger invariants (sandbox)

- Idempotent place/settle/cancel via `Idempotency-Key` (replay returns prior body; conflicting body → `409 IDEMPOTENCY_KEY_CONFLICT`)
- No double settle; cancel only from `reserved`
- Available balance never goes negative
- Operator fund segregation via `operator_id` account keys
