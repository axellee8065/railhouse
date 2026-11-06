import { Router, type Request } from "express";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { requireAuth } from "../middleware/auth.js";
import {
  AUDIT_ACTION_TYPES,
  listAuditEvents,
  serializeAuditEvent,
} from "../services/audit.js";
import { balanceView, getOrCreateAccount } from "../services/ledger.js";
import { getPlayerPolicy } from "../services/policy.js";
import { listWithdrawals, serializeWithdrawal } from "../services/withdrawals.js";
import { db } from "../store/db.js";
import type { AuditAction, Bet, JournalEntry, Round } from "../types.js";

/**
 * Admin console API (PoC step B) — SANDBOX / DEMO.
 * Reads are not audited; mutating admin actions (withdraw approve/reject,
 * policy stub) append to the immutable audit stream.
 */
export const adminRouter = Router();

adminRouter.use(requireAuth({ scopes: ["games:admin"] }));

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

function serializeBet(b: Bet) {
  return {
    bet_id: b.betId,
    session_id: b.sessionId,
    operator_id: b.operatorId,
    player_id: b.playerId,
    game_id: b.gameId,
    round_id: b.roundId,
    status: b.status,
    amount: b.amount,
    currency: b.currency,
    bet_type: b.betType ?? null,
    payout: b.payout ?? null,
    profit: b.profit ?? null,
    outcome: b.outcome ?? null,
    created_at: b.createdAt,
    settled_at: b.settledAt ?? null,
    cancelled_at: b.cancelledAt ?? null,
  };
}

function serializeRound(r: Round) {
  return {
    round_id: r.roundId,
    session_id: r.sessionId,
    operator_id: r.operatorId,
    game_id: r.gameId,
    status: r.status,
    bet_ids: r.betIds,
    created_at: r.createdAt,
    settled_at: r.settledAt ?? null,
  };
}

function serializeDeposit(entry: JournalEntry) {
  const creditLine = entry.lines.find(
    (l) => l.direction === "credit" && l.account.startsWith("liability.player"),
  );
  const amount =
    creditLine?.amount ??
    entry.lines.find((l) => l.direction === "debit")?.amount ??
    0;
  const playerMatch = /liability\.player\.(.+)$/.exec(creditLine?.account ?? "");
  return {
    entry_id: entry.entryId,
    operator_id: entry.operatorId,
    tx_id: entry.referenceId,
    player_id: playerMatch?.[1] ?? null,
    amount,
    currency: creditLine?.currency ?? config.currency,
    entry_type: entry.entryType,
    posted_at: entry.postedAt,
    idempotency_key: entry.idempotencyKey,
  };
}

function tenantSnapshot(operatorId: string, label: string, playerId: string) {
  const accounts = [...db.accounts.values()].filter((a) => a.operatorId === operatorId);
  const bets = [...db.bets.values()].filter((b) => b.operatorId === operatorId);
  const journal = db.journal.filter((j) => j.operatorId === operatorId);
  const withdrawals = listWithdrawals({ operatorId });
  const audit = listAuditEvents({ operatorId, limit: 5 });
  const primary = getOrCreateAccount(operatorId, playerId, config.currency);
  const available = accounts.reduce((s, a) => s + a.available, 0);
  const reserved = accounts.reduce((s, a) => s + a.reserved, 0);
  return {
    label,
    operator_id: operatorId,
    primary_player_id: playerId,
    primary_balance: balanceView(primary),
    players: accounts.map((a) => ({
      player_id: a.playerId,
      balance: balanceView(a),
    })),
    counts: {
      players: accounts.length,
      bets: bets.length,
      journal_entries: journal.length,
      deposits: journal.filter((j) => j.entryType === "deposit_credit").length,
      withdrawals: withdrawals.length,
      audit_events: db.auditEvents.filter((e) => e.operatorId === operatorId).length,
    },
    balances: {
      available,
      reserved,
      total: available + reserved,
      currency: config.currency,
      minor_unit: config.minorUnit,
      asset: config.asset,
    },
    recent_audit: audit.map(serializeAuditEvent),
  };
}

/**
 * Side-by-side multi-tenant isolation view (PoC step C).
 * Shows op_demo_A vs op_demo_B balances — never mixed.
 * Readable with any seeded games:admin studio token.
 */
adminRouter.get("/tenants", (req, res, next) => {
  try {
    requireAccessAdmin(req);
    const A = tenantSnapshot(
      config.tenants.A.operatorId,
      "Operator A",
      config.tenants.A.playerId,
    );
    const B = tenantSnapshot(
      config.tenants.B.operatorId,
      "Operator B",
      config.tenants.B.playerId,
    );

    const sharedA = getOrCreateAccount(
      config.tenants.A.operatorId,
      "player_shared_99",
      config.currency,
    );
    const sharedB = getOrCreateAccount(
      config.tenants.B.operatorId,
      "player_shared_99",
      config.currency,
    );

    res.json({
      sandbox: true,
      label: "DEMO / SANDBOX multi-tenant isolation",
      brand: "Railhouse",
      isolation: "operator_id",
      never_mix: true,
      tenants: { A, B },
      shared_player_id_proof: {
        player_id: "player_shared_99",
        note: "Same player_id under both operators — balances stay segregated by operator_id key",
        A: { operator_id: config.tenants.A.operatorId, balance: balanceView(sharedA) },
        B: { operator_id: config.tenants.B.operatorId, balance: balanceView(sharedB) },
        balances_equal: sharedA.available === sharedB.available,
      },
      credentials: {
        A: {
          operator_id: config.tenants.A.operatorId,
          client_id: config.tenants.A.clientId,
          client_secret: config.tenants.A.clientSecret,
          player_id: config.tenants.A.playerId,
        },
        B: {
          operator_id: config.tenants.B.operatorId,
          client_id: config.tenants.B.clientId,
          client_secret: config.tenants.B.clientSecret,
          player_id: config.tenants.B.playerId,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

/** Dashboard summary for the current operator (sandbox). */
adminRouter.get("/dashboard", (req, res, next) => {
  try {
    const { operatorId } = requireAccessAdmin(req);
    const accounts = [...db.accounts.values()].filter((a) => a.operatorId === operatorId);
    const bets = [...db.bets.values()].filter((b) => b.operatorId === operatorId);
    const rounds = [...db.rounds.values()].filter((r) => r.operatorId === operatorId);
    const withdrawals = listWithdrawals({ operatorId });
    const deposits = db.journal.filter(
      (j) => j.operatorId === operatorId && j.entryType === "deposit_credit",
    );
    const audit = listAuditEvents({ operatorId, limit: 8 });

    const available = accounts.reduce((s, a) => s + a.available, 0);
    const reserved = accounts.reduce((s, a) => s + a.reserved, 0);

    res.json({
      sandbox: true,
      label: "DEMO / SANDBOX admin dashboard",
      brand: "Railhouse",
      operator_id: operatorId,
      chain: config.chain,
      asset: config.asset,
      counts: {
        players: accounts.length,
        bets: bets.length,
        rounds: rounds.length,
        deposits: deposits.length,
        withdrawals: withdrawals.length,
        withdrawals_pending: withdrawals.filter((w) => w.status === "pending_approval").length,
        audit_events: db.auditEvents.filter((e) => e.operatorId === operatorId).length,
      },
      balances: {
        available,
        reserved,
        total: available + reserved,
        currency: config.currency,
        minor_unit: config.minorUnit,
        asset: config.asset,
      },
      recent_audit: audit.map(serializeAuditEvent),
      append_only_audit: true,
    });
  } catch (err) {
    next(err);
  }
});

/** List player accounts + balances + policy stubs for the operator. */
adminRouter.get("/players", (req, res, next) => {
  try {
    const { operatorId } = requireAccessAdmin(req);
    const items = [...db.accounts.values()]
      .filter((a) => a.operatorId === operatorId)
      .map((a) => {
        const policy = getPlayerPolicy(operatorId, a.playerId);
        return {
          operator_id: a.operatorId,
          player_id: a.playerId,
          currency: a.currency,
          asset: config.asset,
          balance: balanceView(a),
          updated_at: a.updatedAt,
          policy: policy
            ? {
                kyc_status: policy.kycStatus,
                rg_daily_limit_minor: policy.rgDailyLimitMinor,
                rg_weekly_limit_minor: policy.rgWeeklyLimitMinor,
                self_excluded: policy.selfExcluded,
                withdrawn_today_minor: policy.withdrawnTodayMinor,
                withdrawn_this_week_minor: policy.withdrawnThisWeekMinor,
                updated_at: policy.updatedAt,
              }
            : null,
        };
      })
      .sort((x, y) => x.player_id.localeCompare(y.player_id));

    res.json({
      items,
      count: items.length,
      sandbox: true,
      label: "DEMO / SANDBOX player balances",
    });
  } catch (err) {
    next(err);
  }
});

/** List bets (optional status / player / game filters). */
adminRouter.get("/bets", (req, res, next) => {
  try {
    const { operatorId } = requireAccessAdmin(req);
    const playerId = req.query.player_id ? String(req.query.player_id) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;
    const gameId = req.query.game_id ? String(req.query.game_id) : undefined;
    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);

    let items = [...db.bets.values()].filter((b) => b.operatorId === operatorId);
    if (playerId) items = items.filter((b) => b.playerId === playerId);
    if (status) items = items.filter((b) => b.status === status);
    if (gameId) items = items.filter((b) => b.gameId === gameId);

    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const sliced = items.slice(0, limit).map(serializeBet);

    res.json({
      items: sliced,
      count: sliced.length,
      total_matched: items.length,
      sandbox: true,
    });
  } catch (err) {
    next(err);
  }
});

/** List rounds. */
adminRouter.get("/rounds", (req, res, next) => {
  try {
    const { operatorId } = requireAccessAdmin(req);
    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
    const items = [...db.rounds.values()]
      .filter((r) => r.operatorId === operatorId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit)
      .map(serializeRound);

    res.json({ items, count: items.length, sandbox: true });
  } catch (err) {
    next(err);
  }
});

/**
 * Deposits seen in the sandbox ledger (journal deposit_credit + depositsSeen set).
 */
adminRouter.get("/deposits", (req, res, next) => {
  try {
    const { operatorId } = requireAccessAdmin(req);
    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
    const entries = db.journal
      .filter((j) => j.operatorId === operatorId && j.entryType === "deposit_credit")
      .slice()
      .reverse()
      .slice(0, limit)
      .map(serializeDeposit);

    res.json({
      items: entries,
      count: entries.length,
      deposits_seen_ids: [...db.depositsSeen]
        .filter((k) => k.startsWith(`${operatorId}:`))
        .map((k) => k.slice(operatorId.length + 1))
        .slice(-limit),
      sandbox: true,
      label: "DEMO / SANDBOX deposits credited to ledger",
    });
  } catch (err) {
    next(err);
  }
});

/** Withdrawals queue (same data as /v1/withdrawals, admin-scoped). */
adminRouter.get("/withdrawals", (req, res, next) => {
  try {
    const { operatorId } = requireAccessAdmin(req);
    const status = req.query.status ? String(req.query.status) : undefined;
    const playerId = req.query.player_id ? String(req.query.player_id) : undefined;
    const items = listWithdrawals({ operatorId, playerId, status }).map(serializeWithdrawal);
    res.json({
      items,
      count: items.length,
      rail_signs: false,
      sandbox: true,
      sandbox_admin: true,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Append-only audit event stream.
 * Filter by `type` / `action` (exact) or `action_prefix` (e.g. withdraw.).
 * No update/delete endpoints exist by design.
 */
adminRouter.get("/audit/events", (req, res, next) => {
  try {
    const { operatorId } = requireAccessAdmin(req);
    const typeOrAction = req.query.type
      ? String(req.query.type)
      : req.query.action
        ? String(req.query.action)
        : undefined;
    const actionPrefix = req.query.action_prefix
      ? String(req.query.action_prefix)
      : undefined;
    const entityType = req.query.entity_type ? String(req.query.entity_type) : undefined;
    const entityId = req.query.entity_id ? String(req.query.entity_id) : undefined;
    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);

    const items = listAuditEvents({
      operatorId,
      action: typeOrAction as AuditAction | undefined,
      actionPrefix,
      entityType,
      entityId,
      limit,
    });

    res.json({
      items: items.map(serializeAuditEvent),
      count: items.length,
      append_only: true,
      mutable: false,
      sandbox: true,
      label: "DEMO / SANDBOX append-only audit log",
      action_types: AUDIT_ACTION_TYPES,
    });
  } catch (err) {
    next(err);
  }
});
