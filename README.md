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
| `/` | Railhouse lobby (Hello Dice + RGS mock) |
| `/health` | Liveness |
| `/v1/*` | Sandbox game-integration API |
| `/v1/demo/credentials` | Labeled sandbox studio credentials |

### Sandbox credentials (seeded)

| Field | Value |
|---|---|
| `client_id` | `studio_demo_01` |
| `client_secret` | `sk_sandbox_demo_secret` (sandbox label only) |
| `operator_id` | `op_demo_01` |
| `player_id` | `player_demo_42` |

JWT secret: `JWT_SECRET` env (sandbox fallback in code — not for production).

## Layout

- `web/` — Vite + React SPA (Railhouse brand)
- `api/` — Express sandbox API (in-memory ledger)
- `server/` — production entry: static `web/dist` + `/v1`
