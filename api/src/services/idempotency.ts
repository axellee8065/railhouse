import { createHash } from "node:crypto";
import { ApiError } from "../errors.js";
import { db } from "../store/db.js";
import type { IdempotencyRecord } from "../types.js";

export function hashRequest(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}

export function lookupIdempotency(
  operatorId: string,
  route: string,
  key: string,
  requestHash: string,
): IdempotencyRecord | null {
  const rec = db.idempotency.get(db.idempotencyKey(operatorId, route, key));
  if (!rec) return null;
  if (rec.requestHash !== requestHash) {
    throw new ApiError(
      "IDEMPOTENCY_KEY_CONFLICT",
      "Idempotency-Key already used with a different request body",
    );
  }
  return rec;
}

export function saveIdempotency(args: {
  operatorId: string;
  route: string;
  key: string;
  requestHash: string;
  statusCode: number;
  body: unknown;
}): void {
  const record: IdempotencyRecord = {
    key: args.key,
    operatorId: args.operatorId,
    route: args.route,
    requestHash: args.requestHash,
    statusCode: args.statusCode,
    body: args.body,
    createdAt: new Date().toISOString(),
  };
  db.idempotency.set(
    db.idempotencyKey(args.operatorId, args.route, args.key),
    record,
  );
}
