import { config } from "./config.js";
import { creditDeposit, getOrCreateAccount } from "./services/ledger.js";
import { upsertPlayerPolicy } from "./services/policy.js";
import { db } from "./store/db.js";
import type { Operator } from "./types.js";

export function seedDemoData(): void {
  const op: Operator = {
    id: config.demo.operatorId,
    code: "demo",
    clientId: config.demo.clientId,
    clientSecret: config.demo.clientSecret,
    scope: config.demo.scope,
  };
  db.operators.set(op.id, op);
  db.operatorsByClientId.set(op.clientId, op);

  // Second tenant to prove fund segregation
  const op2: Operator = {
    id: "op_demo_02",
    code: "demo_b",
    clientId: "studio_demo_02",
    clientSecret: "sk_sandbox_demo_secret_b",
    scope: config.demo.scope,
  };
  db.operators.set(op2.id, op2);
  db.operatorsByClientId.set(op2.clientId, op2);

  getOrCreateAccount(op.id, config.demo.playerId, config.currency);
  creditDeposit({
    operatorId: op.id,
    playerId: config.demo.playerId,
    amount: config.defaultPlayerBalance,
    currency: config.currency,
    idempotencyKey: "seed_deposit_player_demo_42",
    txId: "sui_testnet_seed_tx_001",
  });

  getOrCreateAccount(op2.id, config.demo.playerId, config.currency);
  creditDeposit({
    operatorId: op2.id,
    playerId: config.demo.playerId,
    amount: 50_000,
    currency: config.currency,
    idempotencyKey: "seed_deposit_op2_player_demo_42",
    txId: "sui_testnet_seed_tx_002",
  });

  // Default demo player: KYC clear + RG limits set (can request withdraws that pass policy).
  upsertPlayerPolicy({
    operatorId: op.id,
    playerId: config.demo.playerId,
    kycStatus: "clear",
    rgDailyLimitMinor: config.withdraw.defaultRgDailyMinor,
    rgWeeklyLimitMinor: config.withdraw.defaultRgWeeklyMinor,
    selfExcluded: false,
    withdrawnTodayMinor: 0,
    withdrawnThisWeekMinor: 0,
  });

  // Same player under op2 — also clear for tenant demos.
  upsertPlayerPolicy({
    operatorId: op2.id,
    playerId: config.demo.playerId,
    kycStatus: "clear",
    rgDailyLimitMinor: config.withdraw.defaultRgDailyMinor,
    rgWeeklyLimitMinor: config.withdraw.defaultRgWeeklyMinor,
    selfExcluded: false,
    withdrawnTodayMinor: 0,
    withdrawnThisWeekMinor: 0,
  });

  // Player with missing RG limits → fail-closed deny demos.
  getOrCreateAccount(op.id, "player_policy_gap", config.currency);
  upsertPlayerPolicy({
    operatorId: op.id,
    playerId: "player_policy_gap",
    kycStatus: "clear",
    rgDailyLimitMinor: null,
    rgWeeklyLimitMinor: null,
    selfExcluded: false,
    withdrawnTodayMinor: 0,
    withdrawnThisWeekMinor: 0,
  });
  creditDeposit({
    operatorId: op.id,
    playerId: "player_policy_gap",
    amount: 10_000,
    currency: config.currency,
    idempotencyKey: "seed_deposit_player_policy_gap",
    txId: "sui_testnet_seed_tx_policy_gap",
  });
}

export function demoCredentials() {
  return {
    operator_id: config.demo.operatorId,
    client_id: config.demo.clientId,
    client_secret: config.demo.clientSecret,
    player_id: config.demo.playerId,
    default_balance_minor: config.defaultPlayerBalance,
    currency: config.currency,
    asset: config.asset,
    chain: config.chain,
    games: [
      config.games.helloDice,
      config.games.limbo,
      config.games.coinFlip,
      config.games.rgsMock,
    ],
    deposit: {
      receive_address: config.sui.receiveAddress,
      usdc_coin_type: config.sui.usdcCoinType,
      usdc_decimals: config.sui.usdcDecimals,
      graphql_url: config.sui.graphqlUrl,
      dry_run_enabled: config.sui.dryRun,
      faucet_url: config.sui.faucetUrl,
      custody: "operator-self" as const,
    },
  };
}
