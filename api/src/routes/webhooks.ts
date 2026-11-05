import { Router } from "express";
import { ApiError } from "../errors.js";
import { ids } from "../ids.js";
import { requireAuth } from "../middleware/auth.js";
import { db } from "../store/db.js";
import type { WebhookEndpoint } from "../types.js";

export const webhooksRouter = Router();

const ALLOWED = new Set([
  "session.launched",
  "bet.placed",
  "bet.settled",
  "bet.cancelled",
  "balance.updated",
  "fairness.rotated",
  "session.closed",
]);

webhooksRouter.post(
  "/endpoints",
  requireAuth({ scopes: ["games:admin"] }),
  (req, res, next) => {
    try {
      if (req.auth?.kind !== "access") {
        throw new ApiError("FORBIDDEN_SCOPE", "access_token required");
      }
      const url = String(req.body?.url ?? "");
      const secret = String(req.body?.secret ?? "");
      const events = Array.isArray(req.body?.events) ? req.body.events.map(String) : [];
      if (!url || !secret || events.length === 0) {
        throw new ApiError("INVALID_REQUEST", "url, secret, events required");
      }
      for (const e of events) {
        if (!ALLOWED.has(e)) {
          throw new ApiError("INVALID_REQUEST", `unsupported event ${e}`);
        }
      }
      const endpoint: WebhookEndpoint = {
        endpointId: ids.webhook(),
        operatorId: req.operatorId!,
        url,
        secret,
        events,
        createdAt: new Date().toISOString(),
      };
      db.webhooks.set(endpoint.endpointId, endpoint);
      res.status(201).json({
        endpoint_id: endpoint.endpointId,
        url: endpoint.url,
        events: endpoint.events,
        created_at: endpoint.createdAt,
      });
    } catch (err) {
      next(err);
    }
  },
);

webhooksRouter.get(
  "/endpoints",
  requireAuth({ scopes: ["games:admin"] }),
  (req, res, next) => {
    try {
      const items = [...db.webhooks.values()]
        .filter((w) => w.operatorId === req.operatorId)
        .map((w) => ({
          endpoint_id: w.endpointId,
          url: w.url,
          events: w.events,
          created_at: w.createdAt,
        }));
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

webhooksRouter.delete(
  "/endpoints/:endpoint_id",
  requireAuth({ scopes: ["games:admin"] }),
  (req, res, next) => {
    try {
      const wh = db.webhooks.get(req.params.endpoint_id);
      if (!wh || wh.operatorId !== req.operatorId) {
        throw new ApiError("INVALID_REQUEST", "endpoint not found");
      }
      db.webhooks.delete(req.params.endpoint_id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);
