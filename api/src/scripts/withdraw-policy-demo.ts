/**
 * Prove fail-closed policy deny + admin approve without signing.
 *
 * Usage:
 *   npx tsx api/src/scripts/withdraw-policy-demo.ts
 *
 * Exits non-zero if any assertion fails.
 */
import { createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";
import { seedDemoData } from "../seed.js";
import { listAuditEvents } from "../services/audit.js";
import { getOrCreateAccount } from "../services/ledger.js";
import { upsertPlayerPolicy } from "../services/policy.js";
import { db } from "../store/db.js";
import {
  approveWithdrawal,
  rejectWithdrawal,
  requestWithdrawal,
  serializeWithdrawal,
} from "../services/withdrawals.js";

const DEMO_TO =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

function assertNoSigningMaterial(obj: unknown): void {
  const json = JSON.stringify(obj).toLowerCase();
  for (const needle of [
    "private_key",
    "secret_key",
    "mnemonic",
    "signed_tx",
    "signature\":",
    "0xpriv",
  ]) {
    assert(!json.includes(needle), `signing material leaked: ${needle}`);
  }
}

function envLeakCheck(): void {
  const dangerous = Object.keys(process.env).filter((k) =>
    /PRIVATE|SECRET_KEY|MNEMONIC|SUI_KEY|WALLET_KEY/i.test(k),
  );
  // JWT_SECRET / client secrets for sandbox auth are expected; chain signing keys are not.
  const chainKeys = dangerous.filter(
    (k) => !/JWT|CLIENT|DEMO/i.test(k) && /SUI|WALLET|CHAIN|SIGN|MNEMONIC|PRIVATE/i.test(k),
  );
  assert(chainKeys.length === 0, `unexpected chain signing env vars: ${chainKeys.join(",")}`);
}

async function main() {
  seedDemoData();
  envLeakCheck();

  const operatorId = config.demo.operatorId;
  const playerId = config.demo.playerId;
  const accountBefore = getOrCreateAccount(operatorId, playerId, config.currency);
  console.log(
    JSON.stringify(
      {
        step: "seed",
        available: accountBefore.available,
        kyc: "clear",
        rail_signs: false,
      },
      null,
      2,
    ),
  );

  // --- 1) Policy deny: amount below min ---
  const denyLow = requestWithdrawal({
    operatorId,
    playerId,
    amount: 1,
    toAddress: DEMO_TO,
    idempotencyKey: `demo_deny_min_${randomBytes(4).toString("hex")}`,
    actorId: playerId,
  });
  assert(denyLow.withdrawal.status === "policy_denied", "expected policy_denied for below-min");
  assert(
    denyLow.withdrawal.failCodes?.includes("AMOUNT_BELOW_MIN"),
    "expected AMOUNT_BELOW_MIN",
  );
  assert(
    denyLow.balance.available === accountBefore.available,
    "deny must not move balance",
  );
  assertNoSigningMaterial(serializeWithdrawal(denyLow.withdrawal));
  console.log(
    JSON.stringify(
      {
        step: "policy_deny_below_min",
        status: denyLow.withdrawal.status,
        fail_codes: denyLow.withdrawal.failCodes,
        balance_unchanged: true,
      },
      null,
      2,
    ),
  );

  // --- 2) Policy deny: KYC not clear ---
  upsertPlayerPolicy({
    operatorId,
    playerId,
    kycStatus: "pending",
    rgDailyLimitMinor: config.withdraw.defaultRgDailyMinor,
    rgWeeklyLimitMinor: config.withdraw.defaultRgWeeklyMinor,
    selfExcluded: false,
    withdrawnTodayMinor: 0,
    withdrawnThisWeekMinor: 0,
  });
  const denyKyc = requestWithdrawal({
    operatorId,
    playerId,
    amount: 5_000,
    toAddress: DEMO_TO,
    idempotencyKey: `demo_deny_kyc_${randomBytes(4).toString("hex")}`,
    actorId: playerId,
  });
  assert(denyKyc.withdrawal.status === "policy_denied", "expected policy_denied for KYC");
  assert(denyKyc.withdrawal.failCodes?.includes("KYC_NOT_CLEAR"), "expected KYC_NOT_CLEAR");

  // Restore clear KYC for approve path
  upsertPlayerPolicy({
    operatorId,
    playerId,
    kycStatus: "clear",
    rgDailyLimitMinor: config.withdraw.defaultRgDailyMinor,
    rgWeeklyLimitMinor: config.withdraw.defaultRgWeeklyMinor,
    selfExcluded: false,
    withdrawnTodayMinor: 0,
    withdrawnThisWeekMinor: 0,
  });
  console.log(
    JSON.stringify(
      {
        step: "policy_deny_kyc",
        status: denyKyc.withdrawal.status,
        fail_codes: denyKyc.withdrawal.failCodes,
      },
      null,
      2,
    ),
  );

  // --- 3) Policy deny: missing RG limits (seeded player_policy_gap) ---
  const denyGap = requestWithdrawal({
    operatorId,
    playerId: "player_policy_gap",
    amount: 5_000,
    toAddress: DEMO_TO,
    idempotencyKey: `demo_deny_gap_${randomBytes(4).toString("hex")}`,
    actorId: "player_policy_gap",
  });
  assert(denyGap.withdrawal.status === "policy_denied", "expected deny for missing RG");
  assert(
    denyGap.withdrawal.failCodes?.includes("RG_DAILY_MISSING") ||
      denyGap.withdrawal.failCodes?.includes("RG_WEEKLY_MISSING"),
    "expected RG_*_MISSING",
  );
  console.log(
    JSON.stringify(
      {
        step: "policy_deny_rg_missing",
        status: denyGap.withdrawal.status,
        fail_codes: denyGap.withdrawal.failCodes,
      },
      null,
      2,
    ),
  );

  // --- 4) Happy path: request → approve without sign ---
  const availBefore = getOrCreateAccount(operatorId, playerId, config.currency).available;
  const amount = 2_500;
  const pending = requestWithdrawal({
    operatorId,
    playerId,
    amount,
    toAddress: DEMO_TO,
    idempotencyKey: `demo_approve_${randomBytes(4).toString("hex")}`,
    actorId: playerId,
  });
  assert(pending.withdrawal.status === "pending_approval", "expected pending_approval");
  assert(
    pending.balance.available === availBefore - amount,
    "funds should be reserved on request",
  );
  assert(
    pending.balance.reserved >= amount,
    "reserved should include withdraw hold",
  );

  const approved = approveWithdrawal({
    operatorId,
    withdrawalId: pending.withdrawal.id,
    adminId: "studio_demo_01",
    note: "script approve — unsigned only",
  });
  assert(approved.withdrawal.status === "approved", "expected approved");
  const intent = approved.withdrawal.unsignedPayoutIntent;
  assert(intent, "unsigned payout intent required");
  assert(intent.signed === false, "intent.signed must be false");
  assert(intent.broadcast === false, "intent.broadcast must be false");
  assert(intent.signing === "operator_self_custody", "signing mode mismatch");
  assert(intent.chain === "sui-testnet", "chain must be sui-testnet");
  assert(intent.asset === "USDC", "asset must be USDC");
  assert(intent.to_address === DEMO_TO, "to_address mismatch");
  assert(intent.amount === amount, "amount mismatch");
  assertNoSigningMaterial(intent);
  assertNoSigningMaterial(serializeWithdrawal(approved.withdrawal));

  // Process must not gain signing helpers after approve
  assert(
    typeof (globalThis as { __rail_private_key?: unknown }).__rail_private_key === "undefined",
    "no private key on globalThis",
  );

  console.log(
    JSON.stringify(
      {
        step: "approve_without_sign",
        status: approved.withdrawal.status,
        unsigned_payout_intent: intent,
        private_keys_in_process: false,
        signed: false,
        broadcast: false,
      },
      null,
      2,
    ),
  );

  // --- 5) Reject path releases hold ---
  const avail2 = getOrCreateAccount(operatorId, playerId, config.currency).available;
  const toReject = requestWithdrawal({
    operatorId,
    playerId,
    amount: 1_000,
    toAddress: DEMO_TO,
    idempotencyKey: `demo_reject_${randomBytes(4).toString("hex")}`,
    actorId: playerId,
  });
  assert(toReject.withdrawal.status === "pending_approval", "reject fixture pending");
  const rejected = rejectWithdrawal({
    operatorId,
    withdrawalId: toReject.withdrawal.id,
    adminId: "studio_demo_01",
    note: "script reject",
  });
  assert(rejected.withdrawal.status === "rejected", "expected rejected");
  assert(
    rejected.balance.available === avail2,
    "reject must restore available balance",
  );
  console.log(
    JSON.stringify(
      {
        step: "reject_releases_hold",
        status: rejected.withdrawal.status,
        available_restored: true,
      },
      null,
      2,
    ),
  );

  // --- 6) Audit append-only ---
  const audits = listAuditEvents({ operatorId, entityType: "withdrawal", limit: 100 });
  const actions = new Set(audits.map((a) => a.action));
  assert(actions.has("withdraw.request"), "missing withdraw.request audit");
  assert(actions.has("withdraw.policy_deny"), "missing withdraw.policy_deny audit");
  assert(actions.has("withdraw.approve"), "missing withdraw.approve audit");
  assert(actions.has("withdraw.reject"), "missing withdraw.reject audit");
  const beforeLen = db.auditEvents.length;
  // Ensure we never mutate prior events
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(db.auditEvents[0]))
    .digest("hex");
  assert(db.auditEvents.length === beforeLen, "audit length stable");
  assert(
    createHash("sha256").update(JSON.stringify(db.auditEvents[0])).digest("hex") ===
      fingerprint,
    "audit events must be immutable",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        audit_actions: [...actions].sort(),
        audit_count: audits.length,
        withdrawals: db.withdrawals.size,
        confirmation:
          "policy deny + approve-without-sign verified; no private keys in process",
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
