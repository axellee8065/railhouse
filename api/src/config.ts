import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSuiAddress } from "./services/sui/addresses.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_USDC =
  "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";
const DEFAULT_RECEIVE =
  "0x3aa824c37d8f570837b073f0acc09a1936c590c4ab3a990493c8e808a342d1c1";
const DEFAULT_GRAPHQL = "https://graphql.testnet.sui.io/graphql";

function loadBundledReceiveAddress(): string {
  try {
    const p = path.resolve(here, "../config/sui-deposit.address.json");
    const raw = JSON.parse(readFileSync(p, "utf8")) as { receive_address?: string };
    if (raw.receive_address) return normalizeSuiAddress(raw.receive_address);
  } catch {
    /* fall through */
  }
  return normalizeSuiAddress(DEFAULT_RECEIVE);
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultValue;
  return !["0", "false", "off", "no"].includes(v.toLowerCase());
}

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
    limbo: "limbo",
    coinFlip: "coin_flip",
    rgsMock: "rgs_mock_slots",
  },
  sui: {
    graphqlUrl: process.env.SUI_GRAPHQL_URL ?? DEFAULT_GRAPHQL,
    receiveAddress: normalizeSuiAddress(
      process.env.SUI_DEPOSIT_RECEIVE_ADDRESS ?? loadBundledReceiveAddress(),
    ),
    usdcCoinType: process.env.SUI_USDC_COIN_TYPE ?? DEFAULT_USDC,
    usdcDecimals: 6,
    requiredConfirmations: Number(process.env.SUI_DEPOSIT_CONFIRMATIONS ?? 1),
    pollIntervalMs: Number(process.env.SUI_DEPOSIT_POLL_MS ?? 15_000),
    watcherEnabled: envFlag("SUI_DEPOSIT_WATCHER", true),
    /** Prefer live GraphQL; dry-run enables fixture digest replay when faucet USDC is hard to get. */
    dryRun: envFlag("SUI_DEPOSIT_DRY_RUN", true),
    defaultOperatorId: process.env.SUI_DEPOSIT_OPERATOR_ID ?? "op_demo_01",
    defaultPlayerId: process.env.SUI_DEPOSIT_PLAYER_ID ?? "player_demo_42",
    faucetUrl: "https://faucet.circle.com",
    explorerTxBase: "https://testnet.suivision.xyz/txblock/",
    explorerAccountBase: "https://testnet.suivision.xyz/account/",
  },
} as const;
