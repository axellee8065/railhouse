import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { config } from "./config.js";
import { ApiError, errorEnvelope } from "./errors.js";
import { requireSandboxEnv } from "./middleware/env.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { authRouter } from "./routes/auth.js";
import { betsRouter } from "./routes/bets.js";
import { depositsRouter } from "./routes/deposits.js";
import { fairnessRouter } from "./routes/fairness.js";
import { roundsRouter } from "./routes/rounds.js";
import { sessionsRouter } from "./routes/sessions.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { withdrawalsRouter } from "./routes/withdrawals.js";
import { demoCredentials } from "./seed.js";

export type CreateAppOptions = {
  /** Absolute path to Vite `dist` — when set, serves SPA + same-origin /v1. */
  staticDir?: string;
};

function isAllowedOrigin(origin: string | undefined, req: Request): boolean {
  if (!origin) return true;
  if (config.corsOrigins.includes("*")) return true;
  if (config.corsOrigins.includes(origin)) return true;
  // Local demos / preview loopback
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  // Same-origin (combined SPA + API): Origin host must match request Host
  try {
    const host = req.headers.host;
    if (host && new URL(origin).host === host) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));
  app.use((req, res, next) => {
    cors({
      origin: (origin, cb) => {
        cb(null, isAllowedOrigin(origin, req));
      },
      exposedHeaders: ["X-Request-Id", "Idempotency-Key"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "Idempotency-Key",
        "X-Rail-Env",
        "X-Request-Id",
        "X-Operator-Id",
      ],
    })(req, res, next);
  });
  app.use(requestIdMiddleware);

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "railhouse",
      env: config.env,
      chain: config.chain,
      asset: config.asset,
      brand: "Railhouse",
      disclaimer: "Demo / not affiliated with Stake or Easygo",
    });
  });

  app.get("/v1/demo/credentials", (_req, res) => {
    res.json(demoCredentials());
  });

  const v1 = express.Router();
  v1.use(requireSandboxEnv);
  v1.use("/auth", authRouter);
  v1.use("/sessions", sessionsRouter);
  v1.use("/sessions/:session_id/bets", betsRouter);
  v1.use("/sessions/:session_id/rounds", roundsRouter);
  v1.use("/sessions/:session_id/fairness", fairnessRouter);
  v1.use("/webhooks", webhooksRouter);
  v1.use("/deposits", depositsRouter);
  v1.use("/withdrawals", withdrawalsRouter);

  app.use("/v1", v1);

  if (options.staticDir) {
    const staticDir = path.resolve(options.staticDir);
    app.use(express.static(staticDir, { index: false, fallthrough: true }));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/v1") || req.path === "/health") {
        next();
        return;
      }
      res.sendFile(path.join(staticDir, "index.html"), (err) => {
        if (err) next(err);
      });
    });
  }

  app.use((_req, _res, next) => {
    next(new ApiError("INVALID_REQUEST", "route not found"));
  });

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.status).json(errorEnvelope(err, req.requestId));
      return;
    }
    console.error(err);
    const internal = new ApiError("INTERNAL_ERROR", "unexpected server error");
    res.status(500).json(errorEnvelope(internal, req.requestId ?? "unknown"));
  });

  return app;
}
