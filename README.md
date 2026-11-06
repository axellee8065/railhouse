# Railhouse

**Casino Rail PoC** — demo frontend + sandbox game-integration API.

> DEMO / NOT AFFILIATED WITH STAKE OR EASYGO. Sui testnet USDC sandbox. Operator self-custody; Railhouse never sole-signs withdrawals. No live chain signing / no private keys in this build.

## Preview (combined)

```bash
cd /agent/railhouse
npm install
npm install --prefix web
npm run build
npm start
```

Opens **http://127.0.0.1:4173** — static SPA + Express API under `/v1`.

| Path | Purpose |
|---|---|
| `/` | Railhouse lobby (Hello Dice, Horizon Limbo, Twin Face, RGS mock) |
| `/play/hello-dice` | Hello Dice — roll over/under |
| `/play/limbo` | Horizon Limbo — target multiplier (PF crash-lite) |
| `/play/coin-flip` | Twin Face — heads/tails |
| `/play/rgs-mock` | Neon Switch RGS mock embed |
| `/wallet` | Deposit address + withdraw request / status |
| `/admin/withdrawals` | SANDBOX admin approve/reject (unsigned payout intent) |
| `/health` | Liveness |
| `/v1/*` | Sandbox game-integration API |
| `/v1/demo/credentials` | Labeled sandbox studio credentials |
| `/v1/deposits/address` | Operator receive address + instructions |
| `/v1/deposits/watcher` | Deposit poller status |
| `/v1/deposits/usdc/detect` | Credit from tx digest (live GraphQL or dry-run fixture) |
| `/v1/withdrawals` | Request / list / status (fail-closed policy) |
| `/v1/withdrawals/:id/approve` | Admin approve → **unsigned** payout intent only |
| `/v1/withdrawals/:id/reject` | Admin reject → release hold |

### Demo mini-games (in-house Provably Fair)

All three use `outcome_mode: rail_pf`, HMAC-SHA256 digests, and `POST /v1/sessions/:id/bets` → settle with `Idempotency-Key`.

| Game | `game_id` | How to play |
|---|---|---|
| Hello Dice | `hello_dice` | Set target + over/under → Place bet |
| Horizon Limbo | `limbo` | Set target multiplier → Place bet (win if PF result ≥ target) |
| Twin Face | `coin_flip` | Call heads or tails → Place bet (~1.98×) |
| Neon Switch | `rgs_mock_slots` | RGS mock spin (studio-style settle) |

### Sandbox credentials (seeded)

| Field | Value |
|---|---|
| `client_id` | `studio_demo_01` |
| `client_secret` | `sk_sandbox_demo_secret` (sandbox label only) |
| `operator_id` | `op_demo_01` |
| `player_id` | `player_demo_42` |

JWT secret: `JWT_SECRET` env (sandbox fallback in code — not for production).

## Sui testnet USDC deposits

PoC watches **Circle USDC on Sui testnet** via public GraphQL (`https://graphql.testnet.sui.io/graphql`). JSON-RPC on Foundation fullnodes is deprecated.

| Item | Value |
|---|---|
| Receive address | `0x3aa824c37d8f570837b073f0acc09a1936c590c4ab3a990493c8e808a342d1c1` |
| USDC coin type | `0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC` |
| Decimals | 6 on-chain → ledger `minor_unit=2` (÷ 10⁴) |
| Custody | Operator self-custody — **private key is not in this repo / not loaded by Rail** |
| Withdrawals | Policy + admin approve → **unsigned** payout intent only (Rail never sole-signs / never loads keys) |

### How to send testnet USDC and see balance update

1. Start Railhouse (`npm start`) — the deposit watcher polls automatically.
2. Open **http://127.0.0.1:4173/wallet** (or `GET /v1/deposits/address`).
3. Get **testnet SUI** for gas from a wallet faucet.
4. Get **Circle testnet USDC** from [faucet.circle.com](https://faucet.circle.com) when available (often rate-limited / region-gated).
5. Transfer Circle USDC to the receive address above (not bridged wUSDC).
6. Wait for the watcher (~15s poll) **or** paste the tx digest in Wallet → **Detect & credit**.
7. Refresh balance — sandbox ledger credits the default demo player.

### Dry-run (no faucet USDC)

Circle’s testnet USDC faucet is frequently unavailable. Bundled fixture digest:

```bash
npx tsx api/src/scripts/deposit-detect.ts --fixture
```

Or:

```bash
# after npm start — obtain studio access token, then:
curl -s http://127.0.0.1:4173/v1/deposits/usdc/detect \
  -H "Content-Type: application/json" \
  -H "X-Rail-Env: sandbox" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Operator-Id: op_demo_01" \
  -d '{"digest":"dryrun_B5F7Be1srK6nARNzB9YqnipvYnEq5XCZW12WSTi2BjJj","player_id":"player_demo_42","dry_run":true}'
```

Fixture source: real historical testnet transfer `B5F7Be1srK6nARNzB9YqnipvYnEq5XCZW12WSTi2BjJj`, remapped to the PoC receive address for local replay only.

## Withdrawals (policy · unsigned intent)

```bash
npm run withdraw-policy-demo
```

1. **Deny:** request below min, or set KYC to `pending` via Admin → next request returns `policy_denied`.
2. **Approve without sign:** request a valid amount from `/wallet` → `/admin/withdrawals` → Approve → inspect `unsigned_payout_intent` (`signed: false`, `broadcast: false`).
3. Rail process holds **no** withdrawal private keys and does **not** broadcast.

### Watcher env

| Env | Default | Meaning |
|---|---|---|
| `SUI_DEPOSIT_WATCHER` | `1` | Set `0` to disable poller |
| `SUI_DEPOSIT_DRY_RUN` | `1` | Allow fixture digest replay |
| `SUI_DEPOSIT_POLL_MS` | `15000` | Poll interval |
| `SUI_DEPOSIT_CONFIRMATIONS` | `1` | Checkpoints after inclusion |
| `SUI_DEPOSIT_RECEIVE_ADDRESS` | bundled address | Override receive address |
| `SUI_GRAPHQL_URL` | `https://graphql.testnet.sui.io/graphql` | GraphQL endpoint |

## Layout

- `web/` — Vite + React SPA (Railhouse brand)
- `api/` — Express sandbox API (in-memory ledger + Sui deposit watcher)
- `server/` — production entry: static `web/dist` + `/v1`
- `api/config/sui-deposit.address.json` — public receive address (no secrets)
- `api/fixtures/sui-usdc-deposit-dry-run.json` — dry-run digest replay
