# Railhouse — Casino Rail demo frontend

Own-brand PoC shell for **Casino Rail**. Not affiliated with Stake or Easygo.

- **Brand:** Railhouse  
- **Stack:** Vite + React + TypeScript  
- **Chain/asset (PoC):** Sui testnet / USDC (ledger currency code `USD` minor units per sandbox API)  
- **Custody messaging:** operator self-custody (Rail never sole-signs withdrawals)  
- **Games:** Hello Dice (in-house PF) + Neon Switch / `rgs_mock_slots` (RGS mock tile)

## Run

```bash
cd /cursor/stores/self/apps/casino-rail-demo
npm install
npm run dev
```

Open the printed local URL (default `http://127.0.0.1:5173`).

If `npm install` fails or is incomplete on the Project store FUSE mount, install on a local-disk copy (e.g. `/tmp` or `/agent`) and keep sources under this path — same pattern as `casino-rail-api/scripts/dev-local.sh`.

## API base URL

| Env | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Sandbox API origin including `/v1`. **Empty (default)** → in-browser MSW mocks matching `docs/game-integration-api.md`. |
| `VITE_FORCE_MSW=1` | Force MSW even if `VITE_API_BASE_URL` is set. |

Copy `.env.example` to `.env` as needed.

When the API worker at `apps/casino-rail-api` is ready (default port **8787**):

```bash
VITE_API_BASE_URL=http://127.0.0.1:8787/v1 npm run dev
```

The client bootstraps sandbox studio credentials via `GET /v1/demo/credentials` (or MSW equivalent), then `POST /v1/auth/token` before `sessions/launch`.

## Screens

- `/` — Lobby (brand hero + game tiles)  
- `/play/hello-dice` — Hello Dice bet/settle loop  
- `/play/rgs-mock` — RGS placeholder + mock spin  
- `/wallet` — USDC balance + mock deposit (`/v1/deposits/usdc` with MSW fallback)  
- `/fairness` — seeds / rotate / verify  
- `/account` — demo profile + recent rounds  

Bets send `Idempotency-Key` on place and settle via `src/lib/api/client.ts`.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Dev server + MSW (when no API URL) |
| `npm run build` | Typecheck + production build |
| `npm run preview` | Preview production build |
| `npm run lint` | Oxlint |

## Notes

- Amounts are integer minor units (`minor_unit = 2` in sandbox; UI labels **USDC**).  
- Mock deposit is demo-only; withdrawals are intentionally out of scope (operator self-custody).
