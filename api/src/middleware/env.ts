import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../errors.js";

export function requireSandboxEnv(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const env = (req.header("X-Rail-Env") ?? "").trim().toLowerCase();
  if (!env) {
    return next(
      new ApiError("INVALID_REQUEST", "X-Rail-Env header is required"),
    );
  }
  if (env === "production") {
    return next(
      new ApiError(
        "ENV_MISMATCH",
        "demo build rejects X-Rail-Env: production",
      ),
    );
  }
  if (env !== "sandbox") {
    return next(
      new ApiError("ENV_MISMATCH", `unsupported X-Rail-Env: ${env}`),
    );
  }
  req.railEnv = "sandbox";
  next();
}
