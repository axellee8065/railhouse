import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../errors.js";
import { appendAuditEvent } from "../services/audit.js";
import { verifyToken } from "../services/tokens.js";
import { db } from "../store/db.js";
import { assertOperatorMatch } from "./tenant.js";

export function requireAuth(opts?: { scopes?: string[] }) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const header = req.header("Authorization") ?? "";
      const match = /^Bearer\s+(.+)$/i.exec(header);
      if (!match) {
        throw new ApiError("AUTH_REQUIRED", "Bearer token required");
      }
      const token = match[1].trim();
      let claims;
      try {
        claims = await verifyToken(token);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "AUTH_TOKEN_EXPIRED") {
          throw new ApiError("AUTH_TOKEN_EXPIRED", "token expired");
        }
        throw new ApiError("AUTH_REQUIRED", "invalid token");
      }

      if (claims.env === "production") {
        throw new ApiError("ENV_MISMATCH", "production tokens not issued in demo");
      }

      const headerOperator = req.header("X-Operator-Id")?.trim();
      if (headerOperator && headerOperator !== claims.operator_id) {
        appendAuditEvent({
          operatorId: claims.operator_id,
          actorType: claims.typ === "access" ? "admin" : "player",
          actorId:
            claims.typ === "access" ? claims.client_id : claims.player_id,
          action: "tenant.isolation_deny",
          entityType: "operator",
          entityId: headerOperator,
          payload: {
            caller_operator_id: claims.operator_id,
            header_operator_id: headerOperator,
            detail: "X-Operator-Id does not match token operator_id",
            path: req.originalUrl ?? req.url,
          },
        });
        throw new ApiError(
          "FORBIDDEN_SCOPE",
          "X-Operator-Id does not match token operator_id",
          {
            caller_operator_id: claims.operator_id,
            header_operator_id: headerOperator,
          },
        );
      }

      if (claims.typ === "access") {
        if (opts?.scopes?.length) {
          const have = new Set(claims.scope.split(/\s+/).filter(Boolean));
          for (const s of opts.scopes) {
            if (!have.has(s)) {
              throw new ApiError("FORBIDDEN_SCOPE", `missing scope ${s}`);
            }
          }
        }
        req.auth = { kind: "access", claims, token };
        req.operatorId = claims.operator_id;
      } else {
        req.auth = { kind: "launch", claims, token };
        req.operatorId = claims.operator_id;

        const session = db.sessions.get(claims.session_id);
        if (session && session.launchTokenJti === claims.jti) {
          // Binding is checked on first financial use via bindLaunchToken
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Mark launch token as bound (one-time). */
export function bindLaunchTokenIfNeeded(sessionId: string, jti: string): void {
  const session = db.sessions.get(sessionId);
  if (!session) return;
  if (session.launchTokenJti !== jti) {
    throw new ApiError("AUTH_REQUIRED", "launch token does not match session");
  }
  if (session.launchTokenBound) {
    // Allow reuse of launch token for subsequent calls within session after bind
    // Spec: "1회 바인딩. 재사용 시 AUTH_TOKEN_REUSED" — interpret as re-binding
    // a *new* session with an already-consumed token. Same session reuse OK.
    return;
  }
  if (new Date(session.launchTokenExpiresAt).getTime() < Date.now()) {
    throw new ApiError("AUTH_TOKEN_EXPIRED", "launch token expired");
  }
  session.launchTokenBound = true;
}

export function assertSessionAccess(
  req: Request,
  sessionId: string,
): import("../types.js").Session {
  const session = db.sessions.get(sessionId);
  if (!session) {
    throw new ApiError("SESSION_NOT_FOUND", `session ${sessionId} not found`);
  }
  const operatorId = req.operatorId;
  if (!operatorId) {
    throw new ApiError("AUTH_REQUIRED", "operator context required");
  }
  // Cross-tenant: explicit 403 (not 404) so isolation demos can assert deny.
  if (session.operatorId !== operatorId) {
    assertOperatorMatch(req, session.operatorId, {
      resourceType: "session",
      resourceId: sessionId,
      detail: "session belongs to another operator",
    });
  }
  if (req.auth?.kind === "launch") {
    if (req.auth.claims.session_id !== sessionId) {
      throw new ApiError("FORBIDDEN_SCOPE", "launch token session mismatch");
    }
    if (session.launchTokenJti !== req.auth.claims.jti) {
      throw new ApiError("AUTH_REQUIRED", "launch token mismatch");
    }
    if (
      session.launchTokenBound === false &&
      new Date(session.launchTokenExpiresAt).getTime() < Date.now()
    ) {
      throw new ApiError("AUTH_TOKEN_EXPIRED", "launch token expired");
    }
    // First use binds; attempting to use a launch token that was already
    // bound to a *different* session is handled by jti match above.
    if (!session.launchTokenBound) {
      session.launchTokenBound = true;
    }
  }
  if (session.status === "closed" || session.status === "expired") {
    throw new ApiError("SESSION_CLOSED", "session is closed");
  }
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    session.status = "expired";
    throw new ApiError("SESSION_CLOSED", "session expired");
  }
  // idle extend
  session.expiresAt = new Date(
    Date.now() + 30 * 60 * 1000,
  ).toISOString();
  return session;
}
