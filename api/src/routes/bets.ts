import { Router } from "express";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { ids } from "../ids.js";
import { assertSessionAccess, requireAuth } from "../middleware/auth.js";
import { evaluateCoinFlip } from "../services/coin-flip.js";
import { evaluateHelloDice } from "../services/hello-dice.js";
import { evaluateLimbo } from "../services/limbo.js";
import { hashRequest, lookupIdempotency, saveIdempotency } from "../services/idempotency.js";
import { balanceView, reserveBet, settleBet, voidBet } from "../services/ledger.js";
import { db } from "../store/db.js";
import type { Bet, Round } from "../types.js";

export const betsRouter = Router({ mergeParams: true });

const catalogGames = new Set<string>(Object.values(config.games));
const railPfGames = new Set<string>([
  config.games.helloDice,
  config.games.limbo,
  config.games.coinFlip,
]);

function evaluateRailPf(args: {
  gameId: string;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  amount: number;
  payload?: Record<string, unknown>;
}): Record<string, unknown> | null {
  if (args.gameId === config.games.helloDice) {
    return evaluateHelloDice(args) as unknown as Record<string, unknown>;
  }
  if (args.gameId === config.games.limbo) {
    return evaluateLimbo(args) as unknown as Record<string, unknown>;
  }
  if (args.gameId === config.games.coinFlip) {
    return evaluateCoinFlip(args) as unknown as Record<string, unknown>;
  }
  return null;
}

function requireIdempotencyKey(req: { header(name: string): string | undefined }): string {
  const key = req.header("Idempotency-Key");
  if (!key || !key.trim()) {
    throw new ApiError("INVALID_REQUEST", "Idempotency-Key header is required");
  }
  return key.trim();
}

function assertIntegerAmount(amount: unknown, field = "amount"): number {
  if (typeof amount !== "number" || !Number.isInteger(amount)) {
    throw new ApiError("INVALID_AMOUNT", `${field} must be an integer minor unit`);
  }
  if (amount <= 0 && field === "amount") {
    throw new ApiError("INVALID_AMOUNT", "amount must be >= 1");
  }
  if (amount < 0) {
    throw new ApiError("INVALID_AMOUNT", `${field} must be >= 0`);
  }
  return amount;
}

function betResponse(bet: Bet, account: ReturnType<typeof balanceView>, replay = false) {
  return {
    bet_id: bet.betId,
    round_id: bet.roundId,
    status: bet.status,
    amount: bet.amount,
    currency: bet.currency,
    reservation_id: bet.reservationId,
    payout: bet.payout,
    profit: bet.profit,
    balance_after: account,
    provably_fair: bet.provablyFair,
    outcome_preview: bet.outcomePreview,
    outcome: bet.outcome,
    ledger: bet.ledger,
    created_at: bet.createdAt,
    settled_at: bet.settledAt,
    cancelled_at: bet.cancelledAt,
    idempotency_replay: replay,
  };
}

function getOrCreateRound(args: {
  roundId: string;
  sessionId: string;
  operatorId: string;
  gameId: string;
}): Round {
  const existing = db.rounds.get(args.roundId);
  if (existing) {
    if (existing.sessionId !== args.sessionId) {
      throw new ApiError("INVALID_REQUEST", "round_id belongs to another session");
    }
    return existing;
  }
  const round: Round = {
    roundId: args.roundId,
    sessionId: args.sessionId,
    operatorId: args.operatorId,
    gameId: args.gameId,
    status: "open",
    betIds: [],
    createdAt: new Date().toISOString(),
  };
  db.rounds.set(args.roundId, round);
  return round;
}

function maybeCloseRound(round: Round): void {
  const bets = round.betIds.map((id) => db.bets.get(id)!).filter(Boolean);
  if (bets.length && bets.every((b) => b.status === "settled" || b.status === "cancelled")) {
    round.status = "closed";
    round.settledAt = new Date().toISOString();
  }
}

betsRouter.post("/", requireAuth(), (req, res, next) => {
  try {
    const session = assertSessionAccess(req, req.params.session_id);
    const idemKey = requireIdempotencyKey(req);
    const body = req.body ?? {};
    const route = `POST /sessions/${session.sessionId}/bets`;
    const reqHash = hashRequest(body);

    const existing = lookupIdempotency(session.operatorId, route, idemKey, reqHash);
    if (existing) {
      const replayBody = { ...(existing.body as object), idempotency_replay: true };
      res.status(200).json(replayBody);
      return;
    }

    const gameId = String(body.game_id ?? "");
    const roundId = String(body.round_id ?? "");
    const currency = String(body.currency ?? "");
    const amount = assertIntegerAmount(body.amount);

    if (!gameId || !roundId || !currency) {
      throw new ApiError("INVALID_REQUEST", "game_id, round_id, currency, amount required");
    }
    if (currency !== session.currency) {
      throw new ApiError("CURRENCY_MISMATCH", "bet currency must match session currency");
    }
    if (!catalogGames.has(gameId)) {
      throw new ApiError("INVALID_REQUEST", "unknown game_id", { game_id: gameId });
    }
    // PoC lobby: one wallet session can place across catalog tiles (PF + RGS mock).
    if (gameId !== session.gameId && !catalogGames.has(session.gameId)) {
      throw new ApiError("INVALID_REQUEST", "game_id must match session game_id");
    }

    const clientSeed =
      typeof body.client_seed === "string" && body.client_seed.length
        ? body.client_seed
        : session.fairness.clientSeed;

    let nonce: number;
    if (typeof body.nonce === "number") {
      if (!Number.isInteger(body.nonce) || body.nonce !== session.fairness.nextNonce) {
        throw new ApiError(
          "INVALID_REQUEST",
          `nonce must equal next_nonce (${session.fairness.nextNonce})`,
          { next_nonce: session.fairness.nextNonce },
        );
      }
      nonce = body.nonce;
    } else {
      nonce = session.fairness.nextNonce;
    }

    const betId = ids.bet();
    const reservationId = ids.reservation();
    const { account, entry } = reserveBet({
      operatorId: session.operatorId,
      playerId: session.playerId,
      amount,
      currency,
      idempotencyKey: `place:${idemKey}`,
      betId,
    });

    session.fairness.clientSeed = clientSeed;
    session.fairness.nextNonce = nonce + 1;

    const bet: Bet = {
      betId,
      sessionId: session.sessionId,
      operatorId: session.operatorId,
      playerId: session.playerId,
      gameId,
      roundId,
      status: "reserved",
      amount,
      currency,
      betType: body.bet_type ? String(body.bet_type) : undefined,
      payload: body.payload && typeof body.payload === "object"
        ? (body.payload as Record<string, unknown>)
        : undefined,
      reservationId,
      provablyFair: {
        server_seed_hash: session.fairness.serverSeedHash,
        client_seed: clientSeed,
        nonce,
        cursor: 0,
        algorithm: session.fairness.algorithm,
      },
      ledger: { reserve_entry_id: entry.entryId },
      createdAt: new Date().toISOString(),
      placeIdempotencyKey: idemKey,
    };

    const useRailPf =
      session.outcomeMode === "rail_pf" || railPfGames.has(gameId);
    if (useRailPf && railPfGames.has(gameId)) {
      try {
        const outcome = evaluateRailPf({
          gameId,
          serverSeed: session.fairness.serverSeed,
          clientSeed,
          nonce,
          amount,
          payload: bet.payload,
        });
        if (outcome) {
          bet.outcomePreview = outcome;
          bet.provablyFair = {
            ...bet.provablyFair!,
            digest_hex: String(outcome.digest_hex ?? ""),
          };
        }
      } catch (e) {
        throw new ApiError(
          "INVALID_REQUEST",
          e instanceof Error ? e.message : "invalid game payload",
        );
      }
    }

    const round = getOrCreateRound({
      roundId,
      sessionId: session.sessionId,
      operatorId: session.operatorId,
      gameId,
    });
    round.betIds.push(betId);
    round.provablyFair = bet.provablyFair;
    db.bets.set(betId, bet);

    const response = betResponse(bet, balanceView(account), false);
    saveIdempotency({
      operatorId: session.operatorId,
      route,
      key: idemKey,
      requestHash: reqHash,
      statusCode: 201,
      body: response,
    });
    res.status(201).json(response);
  } catch (err) {
    next(err);
  }
});

betsRouter.post("/:bet_id/settle", requireAuth(), (req, res, next) => {
  try {
    const session = assertSessionAccess(req, req.params.session_id);
    const idemKey = requireIdempotencyKey(req);
    const body = req.body ?? {};
    const route = `POST /sessions/${session.sessionId}/bets/${req.params.bet_id}/settle`;
    const reqHash = hashRequest(body);

    const existing = lookupIdempotency(session.operatorId, route, idemKey, reqHash);
    if (existing) {
      res.status(200).json({ ...(existing.body as object), idempotency_replay: true });
      return;
    }

    const bet = db.bets.get(req.params.bet_id);
    if (!bet || bet.sessionId !== session.sessionId) {
      throw new ApiError("BET_NOT_FOUND", "bet not found");
    }

    if (bet.status === "settled") {
      // Same payout idempotent via key; different body already conflicted above.
      // If somehow settled without this key:
      throw new ApiError("BET_ALREADY_SETTLED", "bet already settled", {
        bet_id: bet.betId,
        payout: bet.payout,
      });
    }
    if (bet.status !== "reserved") {
      throw new ApiError("BET_NOT_RESERVED", `bet status is ${bet.status}`);
    }

    let payout = assertIntegerAmount(body.payout, "payout");
    // Allow payout = 0
    if (typeof body.payout !== "number" || !Number.isInteger(body.payout) || body.payout < 0) {
      throw new ApiError("INVALID_AMOUNT", "payout must be integer >= 0");
    }
    payout = body.payout;

    if (payout > bet.amount * config.maxPayoutMultiplier) {
      throw new ApiError("PAYOUT_CAP_EXCEEDED", "payout exceeds sandbox max multiplier cap", {
        max_payout_multiplier: config.maxPayoutMultiplier,
      });
    }

    // rail_pf: if outcome_preview exists, prefer/validate against it when client omits mismatch
    if (bet.outcomePreview && typeof bet.outcomePreview.payout === "number") {
      if (body.payout !== bet.outcomePreview.payout) {
        // Trust rail_pf preview as source of truth for demo; ignore client mismatch by using preview
        payout = bet.outcomePreview.payout as number;
      }
    }

    const { account, entry } = settleBet({
      operatorId: session.operatorId,
      playerId: session.playerId,
      amount: bet.amount,
      payout,
      currency: bet.currency,
      idempotencyKey: `settle:${idemKey}`,
      betId: bet.betId,
    });

    bet.status = "settled";
    bet.payout = payout;
    bet.profit = payout - bet.amount;
    bet.outcome = (body.outcome as Record<string, unknown>) ?? bet.outcomePreview;
    bet.settledAt = new Date().toISOString();
    bet.settleIdempotencyKey = idemKey;
    bet.ledger = {
      ...bet.ledger,
      settle_entry_id: entry.entryId,
      debit_entry_id: entry.entryId,
      credit_entry_id: entry.entryId,
    };
    if (body.provably_fair && typeof body.provably_fair === "object") {
      bet.provablyFair = {
        ...bet.provablyFair!,
        ...(body.provably_fair as object),
      };
    }

    const round = db.rounds.get(bet.roundId);
    if (round) maybeCloseRound(round);

    const response = betResponse(bet, balanceView(account), false);
    saveIdempotency({
      operatorId: session.operatorId,
      route,
      key: idemKey,
      requestHash: reqHash,
      statusCode: 200,
      body: response,
    });
    res.status(200).json(response);
  } catch (err) {
    next(err);
  }
});

betsRouter.post("/:bet_id/cancel", requireAuth(), (req, res, next) => {
  try {
    const session = assertSessionAccess(req, req.params.session_id);
    const idemKey = requireIdempotencyKey(req);
    const body = req.body ?? {};
    const route = `POST /sessions/${session.sessionId}/bets/${req.params.bet_id}/cancel`;
    const reqHash = hashRequest(body);

    const existing = lookupIdempotency(session.operatorId, route, idemKey, reqHash);
    if (existing) {
      res.status(200).json({ ...(existing.body as object), idempotency_replay: true });
      return;
    }

    const bet = db.bets.get(req.params.bet_id);
    if (!bet || bet.sessionId !== session.sessionId) {
      throw new ApiError("BET_NOT_FOUND", "bet not found");
    }
    if (bet.status === "settled") {
      throw new ApiError("BET_NOT_CANCELLABLE", "settled bets cannot be cancelled");
    }
    if (bet.status === "cancelled") {
      throw new ApiError("BET_NOT_CANCELLABLE", "bet already cancelled");
    }
    if (bet.status !== "reserved") {
      throw new ApiError("BET_NOT_RESERVED", `bet status is ${bet.status}`);
    }

    const { account, entry } = voidBet({
      operatorId: session.operatorId,
      playerId: session.playerId,
      amount: bet.amount,
      currency: bet.currency,
      idempotencyKey: `cancel:${idemKey}`,
      betId: bet.betId,
    });

    bet.status = "cancelled";
    bet.cancelledAt = new Date().toISOString();
    bet.cancelIdempotencyKey = idemKey;
    bet.ledger = { ...bet.ledger, void_entry_id: entry.entryId };

    const round = db.rounds.get(bet.roundId);
    if (round) maybeCloseRound(round);

    const response = {
      bet_id: bet.betId,
      status: bet.status,
      balance_after: balanceView(account),
      cancelled_at: bet.cancelledAt,
      reason: body.reason ? String(body.reason) : undefined,
      idempotency_replay: false,
    };
    saveIdempotency({
      operatorId: session.operatorId,
      route,
      key: idemKey,
      requestHash: reqHash,
      statusCode: 200,
      body: response,
    });
    res.status(200).json(response);
  } catch (err) {
    next(err);
  }
});
