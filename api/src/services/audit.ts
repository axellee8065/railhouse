import { ids } from "../ids.js";
import { db } from "../store/db.js";
import type { AuditAction, AuditEvent } from "../types.js";

/**
 * Append-only audit log.
 * - Entries are pushed once and never updated or deleted.
 * - Stored objects are frozen so in-process mutation cannot rewrite history.
 * - No public API mutates or truncates this array.
 */
export function appendAuditEvent(args: {
  operatorId: string;
  actorType: AuditEvent["actorType"];
  actorId: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
}): AuditEvent {
  const event: AuditEvent = Object.freeze({
    id: ids.audit(),
    operatorId: args.operatorId,
    actorType: args.actorType,
    actorId: args.actorId,
    action: args.action,
    entityType: args.entityType,
    entityId: args.entityId,
    payload: Object.freeze({ ...args.payload }),
    createdAt: new Date().toISOString(),
  });
  db.auditEvents.push(event);
  return event;
}

export function listAuditEvents(opts?: {
  operatorId?: string;
  entityType?: string;
  entityId?: string;
  action?: AuditAction | string;
  /** Match action prefix, e.g. `withdraw.` → all withdraw.* events. */
  actionPrefix?: string;
  limit?: number;
}): AuditEvent[] {
  let items = db.auditEvents.slice();
  if (opts?.operatorId) {
    items = items.filter((e) => e.operatorId === opts.operatorId);
  }
  if (opts?.entityType) {
    items = items.filter((e) => e.entityType === opts.entityType);
  }
  if (opts?.entityId) {
    items = items.filter((e) => e.entityId === opts.entityId);
  }
  if (opts?.action) {
    items = items.filter((e) => e.action === opts.action);
  }
  if (opts?.actionPrefix) {
    const prefix = opts.actionPrefix;
    items = items.filter((e) => e.action.startsWith(prefix));
  }
  const limit = opts?.limit ?? 100;
  return items.slice(-limit).reverse();
}

/** Known action types for admin filter UI (append-only catalog). */
export const AUDIT_ACTION_TYPES: AuditAction[] = [
  "withdraw.request",
  "withdraw.policy_deny",
  "withdraw.approve",
  "withdraw.reject",
  "policy.update",
];

export function serializeAuditEvent(e: AuditEvent) {
  return {
    id: e.id,
    operator_id: e.operatorId,
    actor_type: e.actorType,
    actor_id: e.actorId,
    action: e.action,
    entity_type: e.entityType,
    entity_id: e.entityId,
    payload: e.payload,
    created_at: e.createdAt,
  };
}
