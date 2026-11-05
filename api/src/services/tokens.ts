import * as jose from "jose";
import { config } from "../config.js";
import type { AccessTokenClaims, LaunchTokenClaims } from "../types.js";

const secret = () => new TextEncoder().encode(config.jwtSecret);

export async function signAccessToken(
  claims: Omit<AccessTokenClaims, "typ"> & { typ?: "access" },
): Promise<{ access_token: string; expires_in: number }> {
  const expires_in = config.accessTokenTtlSec;
  const access_token = await new jose.SignJWT({
    typ: "access",
    operator_id: claims.operator_id,
    client_id: claims.client_id,
    scope: claims.scope,
    env: claims.env,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${expires_in}s`)
    .sign(secret());
  return { access_token, expires_in };
}

export async function signLaunchToken(
  claims: Omit<LaunchTokenClaims, "typ"> & { typ?: "launch" },
): Promise<{ launch_token: string; expires_at: string }> {
  const expires_in = config.launchTokenTtlSec;
  const expires_at = new Date(Date.now() + expires_in * 1000).toISOString();
  const launch_token = await new jose.SignJWT({
    typ: "launch",
    operator_id: claims.operator_id,
    session_id: claims.session_id,
    player_id: claims.player_id,
    jti: claims.jti,
    env: claims.env,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setJti(claims.jti)
    .setIssuedAt()
    .setExpirationTime(`${expires_in}s`)
    .sign(secret());
  return { launch_token, expires_at };
}

export async function verifyToken(token: string): Promise<AccessTokenClaims | LaunchTokenClaims> {
  try {
    const { payload } = await jose.jwtVerify(token, secret());
    const typ = payload.typ;
    if (typ === "access") {
      return {
        typ: "access",
        sub: String(payload.sub),
        operator_id: String(payload.operator_id),
        client_id: String(payload.client_id),
        scope: String(payload.scope ?? ""),
        env: payload.env === "production" ? "production" : "sandbox",
      };
    }
    if (typ === "launch") {
      return {
        typ: "launch",
        sub: String(payload.sub),
        operator_id: String(payload.operator_id),
        session_id: String(payload.session_id),
        player_id: String(payload.player_id),
        jti: String(payload.jti ?? payload.jti),
        env: payload.env === "production" ? "production" : "sandbox",
      };
    }
    throw new Error("unknown token typ");
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "JWTExpired") {
      const e = new Error("token expired");
      (e as Error & { code: string }).code = "AUTH_TOKEN_EXPIRED";
      throw e;
    }
    const e = new Error("invalid token");
    (e as Error & { code: string }).code = "AUTH_REQUIRED";
    throw e;
  }
}
