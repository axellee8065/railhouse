import { config } from "../config.js";
import { db } from "../store/db.js";
import type { PlayerPolicyProfile } from "../types.js";
import { getOrCreateAccount } from "./ledger.js";

export type PolicyGateCode =
  | "KYC_MISSING"
  | "KYC_NOT_CLEAR"
  | "RG_DAILY_MISSING"
  | "RG_WEEKLY_MISSING"
  | "RG_SELF_EXCLUDED"
  | "RG_DAILY_EXCEEDED"
  | "RG_WEEKLY_EXCEEDED"
  | "BALANCE_INSUFFICIENT"
  | "AMOUNT_BELOW_MIN"
  | "AMOUNT_ABOVE_MAX"
  | "AMOUNT_INVALID"
  | "CHAIN_UNSUPPORTED"
  | "ASSET_UNSUPPORTED"
  | "ADDRESS_MISSING"
  | "ADDRESS_INVALID";

export interface PolicyCheckResult {
  allowed: boolean;
  codes: PolicyGateCode[];
  reasons: string[];
  snapshot: Record<string, unknown>;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function getPlayerPolicy(
  operatorId: string,
  playerId: string,
): PlayerPolicyProfile | undefined {
  return db.playerPolicies.get(db.policyKey(operatorId, playerId));
}

export function upsertPlayerPolicy(
  profile: Omit<PlayerPolicyProfile, "updatedAt"> & { updatedAt?: string },
): PlayerPolicyProfile {
  const full: PlayerPolicyProfile = {
    ...profile,
    updatedAt: profile.updatedAt ?? nowIso(),
  };
  db.playerPolicies.set(db.policyKey(full.operatorId, full.playerId), full);
  return full;
}

/** Basic Sui address shape check (0x + 64 hex). Fail-closed on missing/invalid. */
export function isValidSuiAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(address.trim());
}

/**
 * Fail-closed withdrawal policy gates.
 * Any missing KYC/RG field, failed check, or unsupported chain/asset → deny.
 */
export function evaluateWithdrawPolicy(args: {
  operatorId: string;
  playerId: string;
  amount: number;
  toAddress: string;
  chain?: string;
  asset?: string;
}): PolicyCheckResult {
  const codes: PolicyGateCode[] = [];
  const reasons: string[] = [];
  const chain = args.chain ?? config.chain;
  const asset = args.asset ?? config.asset;
  const profile = getPlayerPolicy(args.operatorId, args.playerId);
  const account = getOrCreateAccount(args.operatorId, args.playerId, config.currency);

  const snapshot: Record<string, unknown> = {
    operator_id: args.operatorId,
    player_id: args.playerId,
    amount: args.amount,
    chain,
    asset,
    to_address: args.toAddress || null,
    min_amount: config.withdraw.minAmountMinor,
    max_amount: config.withdraw.maxAmountMinor,
    available: account.available,
    kyc_status: profile?.kycStatus ?? null,
    rg_daily_limit: profile?.rgDailyLimitMinor ?? null,
    rg_weekly_limit: profile?.rgWeeklyLimitMinor ?? null,
    rg_self_excluded: profile?.selfExcluded ?? null,
    withdrawn_today: profile?.withdrawnTodayMinor ?? null,
    withdrawn_this_week: profile?.withdrawnThisWeekMinor ?? null,
    profile_present: Boolean(profile),
    evaluated_at: nowIso(),
    fail_closed: true,
  };

  if (!Number.isInteger(args.amount) || args.amount <= 0) {
    codes.push("AMOUNT_INVALID");
    reasons.push("amount must be a positive integer in ledger minor units");
  }

  if (!args.toAddress || !String(args.toAddress).trim()) {
    codes.push("ADDRESS_MISSING");
    reasons.push("to_address is required");
  } else if (!isValidSuiAddress(args.toAddress)) {
    codes.push("ADDRESS_INVALID");
    reasons.push("to_address must be a 0x-prefixed 64-hex Sui address");
  }

  if (chain !== config.chain) {
    codes.push("CHAIN_UNSUPPORTED");
    reasons.push(`only ${config.chain} supported in PoC`);
  }
  if (asset !== config.asset) {
    codes.push("ASSET_UNSUPPORTED");
    reasons.push(`only ${config.asset} supported in PoC`);
  }

  // KYC stub — missing profile or missing/non-clear status → deny
  if (!profile || profile.kycStatus === null || profile.kycStatus === undefined) {
    codes.push("KYC_MISSING");
    reasons.push("KYC status missing — fail-closed");
  } else if (profile.kycStatus !== "clear") {
    codes.push("KYC_NOT_CLEAR");
    reasons.push(`KYC status is '${profile.kycStatus}' — must be clear`);
  }

  // RG limits — missing → deny
  if (!profile || profile.rgDailyLimitMinor === null || profile.rgDailyLimitMinor === undefined) {
    codes.push("RG_DAILY_MISSING");
    reasons.push("RG daily limit missing — fail-closed");
  }
  if (!profile || profile.rgWeeklyLimitMinor === null || profile.rgWeeklyLimitMinor === undefined) {
    codes.push("RG_WEEKLY_MISSING");
    reasons.push("RG weekly limit missing — fail-closed");
  }

  if (profile?.selfExcluded) {
    codes.push("RG_SELF_EXCLUDED");
    reasons.push("player is self-excluded");
  }

  if (
    profile &&
    profile.rgDailyLimitMinor !== null &&
    profile.rgDailyLimitMinor !== undefined &&
    Number.isInteger(args.amount) &&
    args.amount > 0
  ) {
    const projected = profile.withdrawnTodayMinor + args.amount;
    if (projected > profile.rgDailyLimitMinor) {
      codes.push("RG_DAILY_EXCEEDED");
      reasons.push(
        `daily RG limit exceeded (used ${profile.withdrawnTodayMinor} + ${args.amount} > ${profile.rgDailyLimitMinor})`,
      );
    }
  }

  if (
    profile &&
    profile.rgWeeklyLimitMinor !== null &&
    profile.rgWeeklyLimitMinor !== undefined &&
    Number.isInteger(args.amount) &&
    args.amount > 0
  ) {
    const projected = profile.withdrawnThisWeekMinor + args.amount;
    if (projected > profile.rgWeeklyLimitMinor) {
      codes.push("RG_WEEKLY_EXCEEDED");
      reasons.push(
        `weekly RG limit exceeded (used ${profile.withdrawnThisWeekMinor} + ${args.amount} > ${profile.rgWeeklyLimitMinor})`,
      );
    }
  }

  if (Number.isInteger(args.amount) && args.amount > 0) {
    if (args.amount < config.withdraw.minAmountMinor) {
      codes.push("AMOUNT_BELOW_MIN");
      reasons.push(`amount below minimum ${config.withdraw.minAmountMinor}`);
    }
    if (args.amount > config.withdraw.maxAmountMinor) {
      codes.push("AMOUNT_ABOVE_MAX");
      reasons.push(`amount above maximum ${config.withdraw.maxAmountMinor}`);
    }
    if (account.available < args.amount) {
      codes.push("BALANCE_INSUFFICIENT");
      reasons.push(
        `available balance ${account.available} is less than requested ${args.amount}`,
      );
    }
  }

  return {
    allowed: codes.length === 0,
    codes,
    reasons,
    snapshot,
  };
}
