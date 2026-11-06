import { config } from "./config.js";
import { creditDeposit, getOrCreateAccount } from "./services/ledger.js";
import { upsertPlayerPolicy } from "./services/policy.js";
import { db } from "./store/db.js";
import type { Operator } from "./types.js";

function seedOperator(op: Operator): void {
  db.operators.set(op.id, op);
  db.operatorsByClientId.set(op.clientId, op);
}

function seedPlayer(args: {
  operatorId: string;
  playerId: string;
  amount: number;
  idempotencyKey: string;
  txId: string;
  withPolicy?: boolean;
}): void {
  getOrCreateAccount(args.operatorId, args.playerId, config.currency);
  creditDeposit({
    operatorId: args.operatorId,
    playerId: args.playerId,
    amount: args.amount,
    currency: config.currency,
    idempotencyKey: args.idempotencyKey,
    txId: args.txId,
    actorId: "seed",
    skipAudit: true,
  });
  if (args.withPolicy !== false) {
    upsertPlayerPolicy({
      operatorId: args.operatorId,
      playerId: args.playerId,
      kycStatus: "clear",
      rgDailyLimitMinor: config.withdraw.defaultRgDailyMinor,
      rgWeeklyLimitMinor: config.withdraw.defaultRgWeeklyMinor,
      selfExcluded: false,
      withdrawnTodayMinor: 0,
      withdrawnThisWeekMinor: 0,
    });
  }
}

export function seedDemoData(): void {
  // Default lobby / studio operator (existing demo paths).
  seedOperator({
    id: config.demo.operatorId,
    code: "demo",
    clientId: config.demo.clientId,
    clientSecret: config.demo.clientSecret,
    scope: config.demo.scope,
  });

  // Multi-tenant isolation pair (PoC step C).
  seedOperator({
    id: config.tenants.A.operatorId,
    code: config.tenants.A.code,
    clientId: config.tenants.A.clientId,
    clientSecret: config.tenants.A.clientSecret,
    scope: config.demo.scope,
  });
  seedOperator({
    id: config.tenants.B.operatorId,
    code: config.tenants.B.code,
    clientId: config.tenants.B.clientId,
    clientSecret: config.tenants.B.clientSecret,
    scope: config.demo.scope,
  });

  seedPlayer({
    operatorId: config.demo.operatorId,
    playerId: config.demo.playerId,
    amount: config.defaultPlayerBalance,
    idempotencyKey: "seed_deposit_player_demo_42",
    txId: "sui_testnet_seed_tx_001",
  });

  seedPlayer({
    operatorId: config.tenants.A.operatorId,
    playerId: config.tenants.A.playerId,
    amount: config.tenants.A.startingBalance,
    idempotencyKey: "seed_deposit_player_A_01",
    txId: "sui_testnet_seed_tx_A",
  });

  seedPlayer({
    operatorId: config.tenants.B.operatorId,
    playerId: config.tenants.B.playerId,
    amount: config.tenants.B.startingBalance,
    idempotencyKey: "seed_deposit_player_B_01",
    txId: "sui_testnet_seed_tx_B",
  });

  // Same external player_id under both tenants proves ledger key includes operator_id.
  seedPlayer({
    operatorId: config.tenants.A.operatorId,
    playerId: "player_shared_99",
    amount: 25_000,
    idempotencyKey: "seed_deposit_A_player_shared_99",
    txId: "sui_testnet_seed_tx_A_shared",
  });
  seedPlayer({
    operatorId: config.tenants.B.operatorId,
    playerId: "player_shared_99",
    amount: 75_000,
    idempotencyKey: "seed_deposit_B_player_shared_99",
    txId: "sui_testnet_seed_tx_B_shared",
  });

  // Player with missing RG limits → fail-closed deny demos (default operator).
  getOrCreateAccount(config.demo.operatorId, "player_policy_gap", config.currency);
  upsertPlayerPolicy({
    operatorId: config.demo.operatorId,
    playerId: "player_policy_gap",
    kycStatus: "clear",
    rgDailyLimitMinor: null,
    rgWeeklyLimitMinor: null,
    selfExcluded: false,
    withdrawnTodayMinor: 0,
    withdrawnThisWeekMinor: 0,
  });
  creditDeposit({
    operatorId: config.demo.operatorId,
    playerId: "player_policy_gap",
    amount: 10_000,
    currency: config.currency,
    idempotencyKey: "seed_deposit_player_policy_gap",
    txId: "sui_testnet_seed_tx_policy_gap",
    actorId: "seed",
    skipAudit: true,
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
    tenants: {
      A: {
        operator_id: config.tenants.A.operatorId,
        client_id: config.tenants.A.clientId,
        client_secret: config.tenants.A.clientSecret,
        player_id: config.tenants.A.playerId,
        starting_balance_minor: config.tenants.A.startingBalance,
      },
      B: {
        operator_id: config.tenants.B.operatorId,
        client_id: config.tenants.B.clientId,
        client_secret: config.tenants.B.clientSecret,
        player_id: config.tenants.B.playerId,
        starting_balance_minor: config.tenants.B.startingBalance,
      },
    },
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
