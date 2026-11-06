import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { ids } from "../ids.js";
import { db } from "../store/db.js";
import type { UnsignedPayoutIntent, Withdrawal } from "../types.js";
import { appendAuditEvent } from "./audit.js";
import {
  balanceView,
  getOrCreateAccount,
  releaseWithdrawHold,
  reserveWithdraw,
} from "./ledger.js";
import { evaluateWithdrawPolicy, getPlayerPolicy } from "./policy.js";

function nowIso(): string {
  return new Date().toISOString();
}

export function serializeWithdrawal(w: Withdrawal) {
  return {
    id: w.id,
    operator_id: w.operatorId,
    player_id: w.playerId,
    amount: w.amount,
    currency: w.currency,
    asset: w.asset,
    chain: w.chain,
    to_address: w.toAddress,
    status: w.status,
    fail_reason: w.failReason ?? null,
    fail_codes: w.failCodes ?? [],
    policy_snapshot: w.policySnapshot,
    unsigned_payout_intent: w.unsignedPayoutIntent ?? null,
    reserve_entry_id: w.reserveEntryId ?? null,
    release_entry_id: w.releaseEntryId ?? null,
    requested_at: w.requestedAt,
    decided_at: w.decidedAt ?? null,
    decided_by: w.decidedBy ?? null,
    decision_note: w.decisionNote ?? null,
    signing: "operator_self_custody" as const,
    rail_signs: false,
    note:
      w.status === "approved"
        ? "Approved — unsigned payout intent stored for operator. Rail never loads keys or broadcasts."
        : w.status === "policy_denied"
          ? "Denied by fail-closed policy gates."
          : w.status === "rejected"
            ? "Rejected by admin — reserved funds released."
            : "Pending operator approval — funds reserved; no on-chain broadcast.",
  };
}

function findByIdempotency(
  operatorId: string,
  idempotencyKey: string,
): Withdrawal | undefined {
  for (const w of db.withdrawals.values()) {
    if (w.operatorId === operatorId && w.idempotencyKey === idempotencyKey) {
      return w;
    }
  }
  return undefined;
}

export function requestWithdrawal(args: {
  operatorId: string;
  playerId: string;
  amount: number;
  toAddress: string;
  chain?: string;
  asset?: string;
  idempotencyKey: string;
  actorId: string;
}): { withdrawal: Withdrawal; replay: boolean; balance: ReturnType<typeof balanceView> } {
  const existing = findByIdempotency(args.operatorId, args.idempotencyKey);
  if (existing) {
    const account = getOrCreateAccount(args.operatorId, args.playerId, config.currency);
    return { withdrawal: existing, replay: true, balance: balanceView(account) };
  }

  const policy = evaluateWithdrawPolicy({
    operatorId: args.operatorId,
    playerId: args.playerId,
    amount: args.amount,
    toAddress: args.toAddress,
    chain: args.chain,
    asset: args.asset,
  });

  const withdrawalId = ids.withdrawal();
  const requestedAt = nowIso();

  if (!policy.allowed) {
    const denied: Withdrawal = {
      id: withdrawalId,
      operatorId: args.operatorId,
      playerId: args.playerId,
      amount: args.amount,
      currency: config.currency,
      asset: "USDC",
      chain: "sui-testnet",
      toAddress: String(args.toAddress ?? "").trim(),
      status: "policy_denied",
      idempotencyKey: args.idempotencyKey,
      policySnapshot: policy.snapshot,
      failReason: policy.reasons.join("; "),
      failCodes: policy.codes,
      requestedAt,
      decidedAt: requestedAt,
      decidedBy: "policy",
    };
    db.withdrawals.set(denied.id, denied);

    appendAuditEvent({
      operatorId: args.operatorId,
      actorType: "player",
      actorId: args.actorId,
      action: "withdraw.request",
      entityType: "withdrawal",
      entityId: denied.id,
      payload: {
        amount: args.amount,
        to_address: denied.toAddress,
        status: "policy_denied",
      },
    });
    appendAuditEvent({
      operatorId: args.operatorId,
      actorType: "system",
      actorId: "policy",
      action: "withdraw.policy_deny",
      entityType: "withdrawal",
      entityId: denied.id,
      payload: {
        codes: policy.codes,
        reasons: policy.reasons,
        snapshot: policy.snapshot,
      },
    });

    const account = getOrCreateAccount(args.operatorId, args.playerId, config.currency);
    return { withdrawal: denied, replay: false, balance: balanceView(account) };
  }

  const { account, entry } = reserveWithdraw({
    operatorId: args.operatorId,
    playerId: args.playerId,
    amount: args.amount,
    currency: config.currency,
    idempotencyKey: `withdraw_reserve:${args.idempotencyKey}`,
    withdrawalId,
  });

  const pending: Withdrawal = {
    id: withdrawalId,
    operatorId: args.operatorId,
    playerId: args.playerId,
    amount: args.amount,
    currency: config.currency,
    asset: "USDC",
    chain: "sui-testnet",
    toAddress: args.toAddress.trim(),
    status: "pending_approval",
    idempotencyKey: args.idempotencyKey,
    policySnapshot: policy.snapshot,
    reserveEntryId: entry.entryId,
    requestedAt,
  };
  db.withdrawals.set(pending.id, pending);

  appendAuditEvent({
    operatorId: args.operatorId,
    actorType: "player",
    actorId: args.actorId,
    action: "withdraw.request",
    entityType: "withdrawal",
    entityId: pending.id,
    payload: {
      amount: pending.amount,
      to_address: pending.toAddress,
      status: "pending_approval",
      reserve_entry_id: entry.entryId,
    },
  });

  return { withdrawal: pending, replay: false, balance: balanceView(account) };
}

/**
 * Admin approve → store **unsigned** payout intent only.
 * Intentionally does not import, load, or use any private key material.
 * Intentionally does not broadcast to any chain RPC.
 */
export function approveWithdrawal(args: {
  operatorId: string;
  withdrawalId: string;
  adminId: string;
  note?: string;
}): { withdrawal: Withdrawal; balance: ReturnType<typeof balanceView> } {
  const w = db.withdrawals.get(args.withdrawalId);
  if (!w || w.operatorId !== args.operatorId) {
    throw new ApiError("WITHDRAWAL_NOT_FOUND", "withdrawal not found");
  }
  if (w.status !== "pending_approval") {
    throw new ApiError("WITHDRAWAL_NOT_PENDING", `withdrawal status is ${w.status}`);
  }

  const intent: UnsignedPayoutIntent = {
    intent_id: ids.payoutIntent(),
    withdrawal_id: w.id,
    operator_id: w.operatorId,
    player_id: w.playerId,
    to_address: w.toAddress,
    amount: w.amount,
    currency: w.currency,
    asset: "USDC",
    chain: "sui-testnet",
    usdc_coin_type: config.sui.usdcCoinType,
    usdc_decimals: config.sui.usdcDecimals,
    ledger_minor_unit: config.minorUnit,
    signing: "operator_self_custody",
    signed: false,
    broadcast: false,
    created_at: nowIso(),
  };

  // Soft invariant: never attach signature / private key fields.
  const forbidden = ["private_key", "secret_key", "signature", "signed_tx", "mnemonic"];
  const intentJson = JSON.stringify(intent);
  for (const key of forbidden) {
    if (intentJson.toLowerCase().includes(key)) {
      throw new ApiError("INTERNAL_ERROR", "payout intent must not contain signing material");
    }
  }

  w.status = "approved";
  w.unsignedPayoutIntent = intent;
  w.decidedAt = nowIso();
  w.decidedBy = args.adminId;
  w.decisionNote = args.note?.trim() || "sandbox admin approve — unsigned intent only";

  // Count toward RG usage once approved (still awaiting operator broadcast).
  const profile = getPlayerPolicy(w.operatorId, w.playerId);
  if (profile) {
    profile.withdrawnTodayMinor += w.amount;
    profile.withdrawnThisWeekMinor += w.amount;
    profile.updatedAt = nowIso();
  }

  appendAuditEvent({
    operatorId: w.operatorId,
    actorType: "admin",
    actorId: args.adminId,
    action: "withdraw.approve",
    entityType: "withdrawal",
    entityId: w.id,
    payload: {
      unsigned_payout_intent_id: intent.intent_id,
      signed: false,
      broadcast: false,
      to_address: intent.to_address,
      amount: intent.amount,
      chain: intent.chain,
      usdc_coin_type: intent.usdc_coin_type,
      note: w.decisionNote,
    },
  });

  const account = getOrCreateAccount(w.operatorId, w.playerId, config.currency);
  return { withdrawal: w, balance: balanceView(account) };
}

export function rejectWithdrawal(args: {
  operatorId: string;
  withdrawalId: string;
  adminId: string;
  note?: string;
}): { withdrawal: Withdrawal; balance: ReturnType<typeof balanceView> } {
  const w = db.withdrawals.get(args.withdrawalId);
  if (!w || w.operatorId !== args.operatorId) {
    throw new ApiError("WITHDRAWAL_NOT_FOUND", "withdrawal not found");
  }
  if (w.status !== "pending_approval") {
    throw new ApiError("WITHDRAWAL_NOT_PENDING", `withdrawal status is ${w.status}`);
  }

  const { account, entry } = releaseWithdrawHold({
    operatorId: w.operatorId,
    playerId: w.playerId,
    amount: w.amount,
    currency: w.currency,
    idempotencyKey: `withdraw_release:${w.id}`,
    withdrawalId: w.id,
  });

  w.status = "rejected";
  w.releaseEntryId = entry.entryId;
  w.decidedAt = nowIso();
  w.decidedBy = args.adminId;
  w.decisionNote = args.note?.trim() || "sandbox admin reject";

  appendAuditEvent({
    operatorId: w.operatorId,
    actorType: "admin",
    actorId: args.adminId,
    action: "withdraw.reject",
    entityType: "withdrawal",
    entityId: w.id,
    payload: {
      release_entry_id: entry.entryId,
      note: w.decisionNote,
      amount: w.amount,
    },
  });

  return { withdrawal: w, balance: balanceView(account) };
}

export function getWithdrawal(
  operatorId: string,
  withdrawalId: string,
): Withdrawal {
  const w = db.withdrawals.get(withdrawalId);
  if (!w || w.operatorId !== operatorId) {
    throw new ApiError("WITHDRAWAL_NOT_FOUND", "withdrawal not found");
  }
  return w;
}

export function listWithdrawals(opts: {
  operatorId: string;
  playerId?: string;
  status?: string;
}): Withdrawal[] {
  const items: Withdrawal[] = [];
  for (const w of db.withdrawals.values()) {
    if (w.operatorId !== opts.operatorId) continue;
    if (opts.playerId && w.playerId !== opts.playerId) continue;
    if (opts.status && w.status !== opts.status) continue;
    items.push(w);
  }
  items.sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
  return items;
}
