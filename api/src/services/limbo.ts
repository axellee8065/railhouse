import { config } from "../config.js";
import { digestToUnitInterval, hmacDigest } from "./fairness.js";

export interface LimboPayload {
  /** Player target multiplier (e.g. 2.00). Win if PF result >= target. */
  target_multiplier: number;
}

export interface LimboOutcome {
  result: number;
  /** Echo of result for clients that read `roll` on outcome_preview. */
  roll: number;
  target_multiplier: number;
  won: boolean;
  multiplier: string;
  payout: number;
  digest_hex: string;
  nonce: number;
  cursor: number;
}

function assertPayload(payload: Record<string, unknown> | undefined): LimboPayload {
  const target = Number(payload?.target_multiplier ?? payload?.target);
  if (!Number.isFinite(target) || target < 1.01 || target > config.maxPayoutMultiplier) {
    throw new Error(`target_multiplier must be between 1.01 and ${config.maxPayoutMultiplier}`);
  }
  return { target_multiplier: Math.floor(target * 100) / 100 };
}

/** Display / settle payout multiplier equals the player's target when they win. */
export function limboPayoutMultiplier(target: number): number {
  return Math.floor(target * 100) / 100;
}

/**
 * Provably-fair limbo (crash-lite): map HMAC digest → unit interval → result multiplier.
 * result ≈ (1 - houseEdge) / u, floored to 2dp, min 1.00.
 */
export function evaluateLimbo(args: {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  cursor?: number;
  amount: number;
  payload?: Record<string, unknown>;
}): LimboOutcome {
  const { target_multiplier } = assertPayload(args.payload);
  const cursor = args.cursor ?? 0;
  const digest_hex = hmacDigest(
    args.serverSeed,
    args.clientSeed,
    args.nonce,
    cursor,
  );
  const u = digestToUnitInterval(digest_hex);
  const raw = (1 - config.houseEdge) / u;
  const result = Math.max(1, Math.floor(raw * 100) / 100);
  const won = result >= target_multiplier;
  const mult = won ? limboPayoutMultiplier(target_multiplier) : 0;
  const payout = won
    ? Math.floor(args.amount * Math.min(mult, config.maxPayoutMultiplier))
    : 0;
  return {
    result,
    roll: result,
    target_multiplier,
    won,
    multiplier: mult.toFixed(4),
    payout,
    digest_hex,
    nonce: args.nonce,
    cursor,
  };
}
