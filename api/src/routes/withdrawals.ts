import { Router, type Request } from "express";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { requireAuth } from "../middleware/auth.js";
import {
  appendAuditEvent,
  listAuditEvents,
  serializeAuditEvent,
} from "../services/audit.js";
import { getPlayerPolicy, upsertPlayerPolicy } from "../services/policy.js";
import {
  approveWithdrawal,
  getWithdrawal,
  listWithdrawals,
  rejectWithdrawal,
  requestWithdrawal,
  serializeWithdrawal,
} from "../services/withdrawals.js";

/**
 * Withdrawal policy + operator approval (PoC step A).
 *
 * Flow: request → fail-closed KYC/RG/limits → pending_approval →
 * admin approve → **unsigned** payout intent (no keys / no broadcast).
 */
export const withdrawalsRouter = Router();

function requireAccessAdmin(req: Request): {
  operatorId: string;
  adminId: string;
} {
  if (req.auth?.kind !== "access") {
    throw new ApiError("FORBIDDEN_SCOPE", "access_token required");
  }
  return {
    operatorId: req.operatorId!,
    adminId: req.auth.claims.client_id,
  };
}

withdrawalsRouter.get("/policy", requireAuth({ scopes: ["games:play"] }), (req, res, next) => {
  try {
    const playerId = String(req.query.player_id ?? config.demo.playerId);
    const operatorId = req.operatorId!;
    const profile = getPlayerPolicy(operatorId, playerId);
    res.json({
      operator_id: operatorId,
      player_id: playerId,
      kyc_status: profile?.kycStatus ?? null,
      rg_daily_limit_minor: profile?.rgDailyLimitMinor ?? null,
      rg_weekly_limit_minor: profile?.rgWeeklyLimitMinor ?? null,
      self_excluded: profile?.selfExcluded ?? null,
      withdrawn_today_minor: profile?.withdrawnTodayMinor ?? 0,
      withdrawn_this_week_minor: profile?.withdrawnThisWeekMinor ?? 0,
      min_amount_minor: config.withdraw.minAmountMinor,
      max_amount_minor: config.withdraw.maxAmountMinor,
      chain: config.chain,
      asset: config.asset,
      usdc_coin_type: config.sui.usdcCoinType,
      fail_closed: true,
      rail_signs: false,
      custody: "operator-self",
      sandbox: true,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Sandbox-only: mutate KYC/RG stub for demo deny paths.
 * Labeled sandbox — not a production compliance API.
 */
withdrawalsRouter.post(
  "/policy/sandbox",
  requireAuth({ scopes: ["games:admin"] }),
  (req, res, next) => {
    try {
      const { operatorId, adminId } = requireAccessAdmin(req);
      const playerId = String(req.body?.player_id ?? "");
      if (!playerId) {
        throw new ApiError("INVALID_REQUEST", "player_id required");
      }
      const existing = getPlayerPolicy(operatorId, playerId);
      const before = existing
        ? {
            kyc_status: existing.kycStatus,
            rg_daily_limit_minor: existing.rgDailyLimitMinor,
            rg_weekly_limit_minor: existing.rgWeeklyLimitMinor,
            self_excluded: existing.selfExcluded,
            withdrawn_today_minor: existing.withdrawnTodayMinor,
            withdrawn_this_week_minor: existing.withdrawnThisWeekMinor,
          }
        : null;
      const nextProfile = upsertPlayerPolicy({
        operatorId,
        playerId,
        kycStatus:
          req.body?.kyc_status !== undefined
            ? req.body.kyc_status
            : (existing?.kycStatus ?? null),
        rgDailyLimitMinor:
          req.body?.rg_daily_limit_minor !== undefined
            ? req.body.rg_daily_limit_minor
            : (existing?.rgDailyLimitMinor ?? null),
        rgWeeklyLimitMinor:
          req.body?.rg_weekly_limit_minor !== undefined
            ? req.body.rg_weekly_limit_minor
            : (existing?.rgWeeklyLimitMinor ?? null),
        selfExcluded:
          req.body?.self_excluded !== undefined
            ? Boolean(req.body.self_excluded)
            : (existing?.selfExcluded ?? false),
        withdrawnTodayMinor:
          req.body?.withdrawn_today_minor !== undefined
            ? Number(req.body.withdrawn_today_minor)
            : (existing?.withdrawnTodayMinor ?? 0),
        withdrawnThisWeekMinor:
          req.body?.withdrawn_this_week_minor !== undefined
            ? Number(req.body.withdrawn_this_week_minor)
            : (existing?.withdrawnThisWeekMinor ?? 0),
      });

      appendAuditEvent({
        operatorId,
        actorType: "admin",
        actorId: adminId,
        action: "policy.update",
        entityType: "player_policy",
        entityId: playerId,
        payload: {
          sandbox: true,
          before,
          after: {
            kyc_status: nextProfile.kycStatus,
            rg_daily_limit_minor: nextProfile.rgDailyLimitMinor,
            rg_weekly_limit_minor: nextProfile.rgWeeklyLimitMinor,
            self_excluded: nextProfile.selfExcluded,
            withdrawn_today_minor: nextProfile.withdrawnTodayMinor,
            withdrawn_this_week_minor: nextProfile.withdrawnThisWeekMinor,
          },
        },
      });

      res.json({
        sandbox: true,
        label: "SANDBOX policy stub — not production KYC/RG",
        updated_by: adminId,
        audited: true,
        policy: {
          operator_id: nextProfile.operatorId,
          player_id: nextProfile.playerId,
          kyc_status: nextProfile.kycStatus,
          rg_daily_limit_minor: nextProfile.rgDailyLimitMinor,
          rg_weekly_limit_minor: nextProfile.rgWeeklyLimitMinor,
          self_excluded: nextProfile.selfExcluded,
          withdrawn_today_minor: nextProfile.withdrawnTodayMinor,
          withdrawn_this_week_minor: nextProfile.withdrawnThisWeekMinor,
          updated_at: nextProfile.updatedAt,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

/** Lightweight audit feed scoped to withdrawals (full admin console = step B). */
withdrawalsRouter.get(
  "/audit/events",
  requireAuth({ scopes: ["games:admin"] }),
  (req, res, next) => {
    try {
      requireAccessAdmin(req);
      const entityId = req.query.entity_id ? String(req.query.entity_id) : undefined;
      const items = listAuditEvents({
        operatorId: req.operatorId!,
        entityType: "withdrawal",
        entityId,
        limit: Number(req.query.limit ?? 50),
      });
      res.json({
        items: items.map(serializeAuditEvent),
        append_only: true,
        sandbox: true,
      });
    } catch (err) {
      next(err);
    }
  },
);

withdrawalsRouter.post("/", requireAuth({ scopes: ["games:play"] }), (req, res, next) => {
  try {
    if (!req.auth) {
      throw new ApiError("AUTH_REQUIRED", "Bearer token required");
    }
    const operatorId = req.operatorId!;
    const playerId = String(req.body?.player_id ?? "");
    const amount = req.body?.amount;
    const toAddress = String(req.body?.to_address ?? "");
    const chain = req.body?.chain !== undefined ? String(req.body.chain) : config.chain;
    const asset = req.body?.asset !== undefined ? String(req.body.asset) : config.asset;
    const idempotencyKey =
      req.header("Idempotency-Key")?.trim() ||
      String(req.body?.idempotency_key ?? "").trim();

    if (!playerId) {
      throw new ApiError("INVALID_REQUEST", "player_id required");
    }
    if (!idempotencyKey) {
      throw new ApiError("INVALID_REQUEST", "Idempotency-Key header (or body) required");
    }
    if (typeof amount !== "number" || !Number.isInteger(amount)) {
      throw new ApiError("INVALID_AMOUNT", "amount must be integer minor units");
    }

    // Launch tokens may only withdraw for their bound player.
    if (req.auth.kind === "launch" && req.auth.claims.player_id !== playerId) {
      throw new ApiError("FORBIDDEN_SCOPE", "launch token player mismatch");
    }

    const actorId =
      req.auth.kind === "launch" ? req.auth.claims.player_id : req.auth.claims.client_id;

    const result = requestWithdrawal({
      operatorId,
      playerId,
      amount,
      toAddress,
      chain,
      asset,
      idempotencyKey,
      actorId,
    });

    const status =
      result.withdrawal.status === "policy_denied"
        ? result.replay
          ? 200
          : 403
        : result.replay
          ? 200
          : 201;

    res.status(status).json({
      ...serializeWithdrawal(result.withdrawal),
      balance: result.balance,
      idempotency_replay: result.replay,
      sandbox: true,
    });
  } catch (err) {
    next(err);
  }
});

withdrawalsRouter.get("/", requireAuth({ scopes: ["games:play"] }), (req, res, next) => {
  try {
    const operatorId = req.operatorId!;
    const playerId = req.query.player_id ? String(req.query.player_id) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;

    if (req.auth?.kind === "launch" && playerId && req.auth.claims.player_id !== playerId) {
      throw new ApiError("FORBIDDEN_SCOPE", "launch token player mismatch");
    }
    const scopedPlayer =
      req.auth?.kind === "launch" ? req.auth.claims.player_id : playerId;

    const items = listWithdrawals({
      operatorId,
      playerId: scopedPlayer,
      status,
    }).map(serializeWithdrawal);

    res.json({
      items,
      count: items.length,
      rail_signs: false,
      sandbox: true,
    });
  } catch (err) {
    next(err);
  }
});

withdrawalsRouter.post(
  "/:id/approve",
  requireAuth({ scopes: ["games:admin"] }),
  (req, res, next) => {
    try {
      const { operatorId, adminId } = requireAccessAdmin(req);
      const result = approveWithdrawal({
        operatorId,
        withdrawalId: req.params.id,
        adminId,
        note: req.body?.note !== undefined ? String(req.body.note) : undefined,
      });

      const intent = result.withdrawal.unsignedPayoutIntent;
      res.json({
        ...serializeWithdrawal(result.withdrawal),
        balance: result.balance,
        sandbox: true,
        sandbox_admin: true,
        label: "SANDBOX admin approve — unsigned payout intent only",
        confirmation: {
          signed: false,
          broadcast: false,
          private_keys_in_process: false,
          unsigned_payout_intent: intent,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

withdrawalsRouter.post(
  "/:id/reject",
  requireAuth({ scopes: ["games:admin"] }),
  (req, res, next) => {
    try {
      const { operatorId, adminId } = requireAccessAdmin(req);
      const result = rejectWithdrawal({
        operatorId,
        withdrawalId: req.params.id,
        adminId,
        note: req.body?.note !== undefined ? String(req.body.note) : undefined,
      });
      res.json({
        ...serializeWithdrawal(result.withdrawal),
        balance: result.balance,
        sandbox: true,
        sandbox_admin: true,
        label: "SANDBOX admin reject",
      });
    } catch (err) {
      next(err);
    }
  },
);

withdrawalsRouter.get("/:id", requireAuth({ scopes: ["games:play"] }), (req, res, next) => {
  try {
    const w = getWithdrawal(req.operatorId!, req.params.id);
    if (req.auth?.kind === "launch" && req.auth.claims.player_id !== w.playerId) {
      throw new ApiError("WITHDRAWAL_NOT_FOUND", "withdrawal not found");
    }
    res.json({ ...serializeWithdrawal(w), sandbox: true });
  } catch (err) {
    next(err);
  }
});
