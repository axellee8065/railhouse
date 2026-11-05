import { Router } from "express";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { ids } from "../ids.js";
import { assertSessionAccess, requireAuth } from "../middleware/auth.js";
import { newFairnessState } from "../services/fairness.js";
import { hashRequest, lookupIdempotency, saveIdempotency } from "../services/idempotency.js";
import { balanceView, getOrCreateAccount } from "../services/ledger.js";
import { signLaunchToken } from "../services/tokens.js";
import { db } from "../store/db.js";
import type { OutcomeMode, Session } from "../types.js";

export const sessionsRouter = Router();

function sessionDto(s: Session) {
  return {
    session_id: s.sessionId,
    player_id: s.playerId,
    operator_id: s.operatorId,
    game_id: s.gameId,
    status: s.status,
    currency: s.currency,
    expires_at: s.expiresAt,
    env: s.env,
    outcome_mode: s.outcomeMode,
  };
}

sessionsRouter.post(
  "/launch",
  requireAuth({ scopes: ["games:play"] }),
  async (req, res, next) => {
    try {
      if (req.auth?.kind !== "access") {
        throw new ApiError("FORBIDDEN_SCOPE", "launch requires studio access_token");
      }
      const body = req.body ?? {};
      const playerId = String(body.player_id ?? "");
      const gameId = String(body.game_id ?? "");
      const currency = String(body.currency ?? "");
      if (!playerId || !gameId || !currency) {
        throw new ApiError(
          "INVALID_REQUEST",
          "player_id, game_id, currency are required",
        );
      }
      if (currency !== config.currency) {
        throw new ApiError(
          "CURRENCY_MISMATCH",
          `sandbox only supports ${config.currency}`,
        );
      }

      const operatorId = req.operatorId!;
      const idemKey = req.header("Idempotency-Key");
      const route = "POST /sessions/launch";
      const reqHash = hashRequest(body);
      if (idemKey) {
        const existing = lookupIdempotency(operatorId, route, idemKey, reqHash);
        if (existing) {
          res.status(existing.statusCode).json(existing.body);
          return;
        }
      }

      const meta = (body.meta ?? {}) as Record<string, unknown>;
      const railPfGames = new Set<string>([
        config.games.helloDice,
        config.games.limbo,
        config.games.coinFlip,
      ]);
      const outcomeMode: OutcomeMode =
        meta.outcome_mode === "rail_pf"
          ? "rail_pf"
          : railPfGames.has(gameId)
            ? "rail_pf"
            : "studio";

      const fairness = newFairnessState();
      const sessionId = ids.session();
      const jti = ids.jti();
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + config.sessionTtlMs).toISOString();

      const { launch_token, expires_at } = await signLaunchToken({
        sub: playerId,
        operator_id: operatorId,
        session_id: sessionId,
        player_id: playerId,
        jti,
        env: config.env,
      });

      const session: Session = {
        sessionId,
        operatorId,
        playerId,
        gameId,
        currency,
        locale: body.locale ? String(body.locale) : undefined,
        returnUrl: body.return_url ? String(body.return_url) : undefined,
        walletMode: "seamless",
        status: "open",
        outcomeMode,
        meta,
        createdAt,
        expiresAt,
        launchTokenJti: jti,
        launchTokenBound: false,
        launchTokenExpiresAt: expires_at,
        fairness,
        env: config.env,
      };
      db.sessions.set(sessionId, session);

      const account = getOrCreateAccount(operatorId, playerId, currency);
      const response = {
        session_id: sessionId,
        launch_token,
        launch_token_expires_at: expires_at,
        game_url: `http://localhost:${config.port}/demo/games/${gameId}?token=${encodeURIComponent(launch_token)}`,
        balance: balanceView(account),
        provably_fair: {
          server_seed_hash: fairness.serverSeedHash,
          nonce: fairness.nextNonce,
          algorithm: fairness.algorithm,
        },
        env: config.env,
        operator_id: operatorId,
        outcome_mode: outcomeMode,
      };

      if (idemKey) {
        saveIdempotency({
          operatorId,
          route,
          key: idemKey,
          requestHash: reqHash,
          statusCode: 201,
          body: response,
        });
      }
      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  },
);

sessionsRouter.get(
  "/:session_id",
  requireAuth(),
  (req, res, next) => {
    try {
      const session = assertSessionAccess(req, req.params.session_id);
      res.json(sessionDto(session));
    } catch (err) {
      next(err);
    }
  },
);

sessionsRouter.post(
  "/:session_id/close",
  requireAuth(),
  (req, res, next) => {
    try {
      const session = assertSessionAccess(req, req.params.session_id);
      session.status = "closed";
      session.closedAt = new Date().toISOString();
      res.json(sessionDto(session));
    } catch (err) {
      next(err);
    }
  },
);

sessionsRouter.get(
  "/:session_id/balance",
  requireAuth(),
  (req, res, next) => {
    try {
      const session = assertSessionAccess(req, req.params.session_id);
      const account = getOrCreateAccount(
        session.operatorId,
        session.playerId,
        session.currency,
      );
      res.json({
        session_id: session.sessionId,
        ...balanceView(account),
        updated_at: account.updatedAt,
      });
    } catch (err) {
      next(err);
    }
  },
);
