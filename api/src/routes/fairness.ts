import { Router } from "express";
import { ApiError } from "../errors.js";
import { assertSessionAccess, requireAuth } from "../middleware/auth.js";
import { rotateFairness } from "../services/fairness.js";
import { db } from "../store/db.js";

export const fairnessRouter = Router({ mergeParams: true });

function fairnessDto(session: import("../types.js").Session) {
  return {
    algorithm: session.fairness.algorithm,
    server_seed_hash: session.fairness.serverSeedHash,
    client_seed: session.fairness.clientSeed,
    next_nonce: session.fairness.nextNonce,
    rotated_at: session.fairness.rotatedAt,
    previous_server_seed: session.fairness.previousServerSeed,
  };
}

function hasInFlightBets(sessionId: string): boolean {
  for (const bet of db.bets.values()) {
    if (bet.sessionId === sessionId && bet.status === "reserved") return true;
  }
  return false;
}

fairnessRouter.get("/", requireAuth(), (req, res, next) => {
  try {
    const session = assertSessionAccess(req, req.params.session_id);
    res.json(fairnessDto(session));
  } catch (err) {
    next(err);
  }
});

fairnessRouter.post("/client-seed", requireAuth(), (req, res, next) => {
  try {
    const session = assertSessionAccess(req, req.params.session_id);
    if (hasInFlightBets(session.sessionId)) {
      throw new ApiError("BET_IN_FLIGHT", "cannot change client seed while bets are reserved");
    }
    const clientSeed = String(req.body?.client_seed ?? "");
    if (!clientSeed || clientSeed.length > 64) {
      throw new ApiError("INVALID_REQUEST", "client_seed must be 1..64 chars");
    }
    session.fairness.clientSeed = clientSeed;
    res.json(fairnessDto(session));
  } catch (err) {
    next(err);
  }
});

fairnessRouter.post("/rotate", requireAuth(), (req, res, next) => {
  try {
    const session = assertSessionAccess(req, req.params.session_id);
    if (hasInFlightBets(session.sessionId)) {
      throw new ApiError("BET_IN_FLIGHT", "cannot rotate server seed while bets are reserved");
    }
    const result = rotateFairness(session.fairness);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
