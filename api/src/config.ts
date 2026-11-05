export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? "0.0.0.0",
  jwtSecret: process.env.JWT_SECRET ?? "casino-rail-sandbox-jwt-secret-not-for-prod",
  env: "sandbox" as const,
  accessTokenTtlSec: 3600,
  launchTokenTtlSec: 5 * 60,
  sessionTtlMs: 2 * 60 * 60 * 1000,
  sessionIdleExtendMs: 30 * 60 * 1000,
  defaultPlayerBalance: 100_000,
  minorUnit: 2,
  currency: "USD" as string,
  asset: "USDC" as string,
  chain: "sui-testnet" as string,
  maxPayoutMultiplier: 100_000,
  houseEdge: 0.01,
  // Explicit allowlist via CORS_ORIGINS. Combined SPA+API also permits same-origin
  // and localhost (see app.ts). Never default to "*".
  corsOrigins: (process.env.CORS_ORIGINS ??
    "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  demo: {
    operatorId: "op_demo_01",
    clientId: "studio_demo_01",
    clientSecret: "sk_sandbox_demo_secret",
    playerId: "player_demo_42",
    scope: "games:play games:admin",
  },
  games: {
    helloDice: "hello_dice",
    rgsMock: "rgs_mock_slots",
  },
} as const;
