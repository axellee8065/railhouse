import { ids } from "../ids.js";
import { db } from "../store/db.js";
import type { AuditAction, AuditEvent } from "../types.js";

/**
 * Append-only audit log. Entries are never updated or deleted.
 * (Step B will add admin UI over the same stream.)
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
  const event: AuditEvent = {
    id: ids.audit(),
    operatorId: args.operatorId,
    actorType: args.actorType,
    actorId: args.actorId,
    action: args.action,
    entityType: args.entityType,
    entityId: args.entityId,
    payload: { ...args.payload },
    createdAt: new Date().toISOString(),
  };
  db.auditEvents.push(event);
  return event;
}

export function listAuditEvents(opts?: {
  operatorId?: string;
  entityType?: string;
  entityId?: string;
  action?: AuditAction;
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
  const limit = opts?.limit ?? 100;
  return items.slice(-limit).reverse();
}
