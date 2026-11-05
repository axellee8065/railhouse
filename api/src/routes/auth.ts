import { Router } from "express";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { signAccessToken } from "../services/tokens.js";
import { db } from "../store/db.js";

export const authRouter = Router();

authRouter.post("/token", async (req, res, next) => {
  try {
    const body = req.body ?? {};
    if (body.grant_type !== "client_credentials") {
      throw new ApiError("INVALID_REQUEST", "grant_type must be client_credentials");
    }
    const clientId = String(body.client_id ?? "");
    const clientSecret = String(body.client_secret ?? "");
    if (!clientId || !clientSecret) {
      throw new ApiError("INVALID_REQUEST", "client_id and client_secret required");
    }
    if (clientSecret.startsWith("sk_live_")) {
      throw new ApiError("ENV_MISMATCH", "sk_live_ secrets are not issued in demo");
    }
    if (!clientSecret.startsWith("sk_sandbox_")) {
      throw new ApiError("OPERATOR_NOT_FOUND", "sandbox secrets must use sk_sandbox_ prefix");
    }
    const op = db.operatorsByClientId.get(clientId);
    if (!op || op.clientSecret !== clientSecret) {
      throw new ApiError("OPERATOR_NOT_FOUND", "invalid client credentials");
    }
    const scope = String(body.scope ?? op.scope);
    const { access_token, expires_in } = await signAccessToken({
      sub: op.clientId,
      operator_id: op.id,
      client_id: op.clientId,
      scope,
      env: config.env,
    });
    res.json({
      access_token,
      token_type: "Bearer",
      expires_in,
      scope,
      operator_id: op.id,
    });
  } catch (err) {
    next(err);
  }
});
