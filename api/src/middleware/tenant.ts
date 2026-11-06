import type { Request } from "express";
import { ApiError } from "../errors.js";
import { appendAuditEvent } from "../services/audit.js";

/**
 * Reject cross-tenant access with HTTP 403.
 * Audits every deny under the caller's operator_id.
 */
export function assertOperatorMatch(
  req: Request,
  resourceOperatorId: string,
  opts?: {
    resourceType?: string;
    resourceId?: string;
    detail?: string;
  },
): void {
  const caller = req.operatorId;
  if (!caller) {
    throw new ApiError("AUTH_REQUIRED", "operator context required");
  }
  if (caller === resourceOperatorId) return;

  appendAuditEvent({
    operatorId: caller,
    actorType: req.auth?.kind === "access" ? "admin" : "player",
    actorId:
      req.auth?.kind === "access"
        ? req.auth.claims.client_id
        : req.auth?.kind === "launch"
          ? req.auth.claims.player_id
          : "unknown",
    action: "tenant.isolation_deny",
    entityType: opts?.resourceType ?? "operator",
    entityId: opts?.resourceId ?? resourceOperatorId,
    payload: {
      caller_operator_id: caller,
      resource_operator_id: resourceOperatorId,
      detail: opts?.detail ?? "cross-tenant access denied",
      path: req.originalUrl ?? req.url,
      method: req.method,
    },
  });

  throw new ApiError("FORBIDDEN_SCOPE", "cross-tenant access denied", {
    caller_operator_id: caller,
    resource_operator_id: resourceOperatorId,
  });
}

/** Require X-Operator-Id when present to equal token; always set req.operatorId. */
export function requireOperatorHeaderMatch(req: Request): void {
  const headerOperator = req.header("X-Operator-Id")?.trim();
  if (!headerOperator) return;
  if (!req.operatorId) {
    throw new ApiError("AUTH_REQUIRED", "operator context required");
  }
  if (headerOperator !== req.operatorId) {
    appendAuditEvent({
      operatorId: req.operatorId,
      actorType: "admin",
      actorId:
        req.auth?.kind === "access" ? req.auth.claims.client_id : "unknown",
      action: "tenant.isolation_deny",
      entityType: "operator",
      entityId: headerOperator,
      payload: {
        caller_operator_id: req.operatorId,
        header_operator_id: headerOperator,
        detail: "X-Operator-Id does not match token operator_id",
      },
    });
    throw new ApiError(
      "FORBIDDEN_SCOPE",
      "X-Operator-Id does not match token operator_id",
      {
        caller_operator_id: req.operatorId,
        header_operator_id: headerOperator,
      },
    );
  }
}
