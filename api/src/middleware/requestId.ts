import type { NextFunction, Request, Response } from "express";
import { ids } from "../ids.js";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      railEnv?: "sandbox" | "production";
      auth?: import("../types.js").AuthContext;
      operatorId?: string;
    }
  }
}

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header("X-Request-Id");
  req.requestId = incoming && incoming.trim() ? incoming.trim() : ids.request();
  res.setHeader("X-Request-Id", req.requestId);
  next();
}
