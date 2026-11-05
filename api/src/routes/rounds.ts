import { Router } from "express";
import { ApiError } from "../errors.js";
import { assertSessionAccess, requireAuth } from "../middleware/auth.js";
import { db } from "../store/db.js";
import type { Bet, Round } from "../types.js";

export const roundsRouter = Router({ mergeParams: true });

function betSummary(bet: Bet) {
  return {
    bet_id: bet.betId,
    amount: bet.amount,
    payout: bet.payout,
    status: bet.status,
  };
}

function roundDto(round: Round) {
  const bets = round.betIds
    .map((id) => db.bets.get(id))
    .filter((b): b is Bet => Boolean(b));
  return {
    round_id: round.roundId,
    game_id: round.gameId,
    status: round.status,
    bets: bets.map(betSummary),
    provably_fair: round.provablyFair,
    created_at: round.createdAt,
    settled_at: round.settledAt,
  };
}

roundsRouter.get("/", requireAuth(), (req, res, next) => {
  try {
    const session = assertSessionAccess(req, req.params.session_id);
    const limit = Math.min(Number(req.query.limit ?? 20) || 20, 100);
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;

    let items = [...db.rounds.values()]
      .filter((r) => r.sessionId === session.sessionId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    if (cursor) {
      const idx = items.findIndex((r) => r.roundId === cursor);
      if (idx >= 0) items = items.slice(idx + 1);
    }

    const page = items.slice(0, limit);
    const next = items.length > limit ? page[page.length - 1]?.roundId ?? null : null;

    res.json({
      items: page.map(roundDto),
      next_cursor: next,
    });
  } catch (err) {
    next(err);
  }
});

roundsRouter.get("/:round_id", requireAuth(), (req, res, next) => {
  try {
    const session = assertSessionAccess(req, req.params.session_id);
    const round = db.rounds.get(req.params.round_id);
    if (!round || round.sessionId !== session.sessionId) {
      throw new ApiError("ROUND_NOT_FOUND", "round not found");
    }
    res.json(roundDto(round));
  } catch (err) {
    next(err);
  }
});
