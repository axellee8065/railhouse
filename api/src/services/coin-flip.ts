import { config } from "../config.js";
import { digestToRoll, hmacDigest } from "./fairness.js";

export type CoinSide = "heads" | "tails";

export interface CoinFlipPayload {
  side: CoinSide;
}

export interface CoinFlipOutcome {
  side: CoinSide;
  landed: CoinSide;
  roll: number;
  won: boolean;
  multiplier: string;
  payout: number;
  digest_hex: string;
  nonce: number;
  cursor: number;
}

function assertPayload(payload: Record<string, unknown> | undefined): CoinFlipPayload {
  const side = payload?.side;
  if (side !== "heads" && side !== "tails") {
    throw new Error("side must be heads or tails");
  }
  return { side };
}

/** Even-money flip with house edge → ~1.98×. */
export function coinFlipMultiplier(): number {
  return (1 - config.houseEdge) / 0.5;
}

export function evaluateCoinFlip(args: {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  cursor?: number;
  amount: number;
  payload?: Record<string, unknown>;
}): CoinFlipOutcome {
  const { side } = assertPayload(args.payload);
  const cursor = args.cursor ?? 0;
  const digest_hex = hmacDigest(
    args.serverSeed,
    args.clientSeed,
    args.nonce,
    cursor,
  );
  const roll = digestToRoll(digest_hex);
  const landed: CoinSide = roll < 50 ? "heads" : "tails";
  const won = landed === side;
  const mult = won ? coinFlipMultiplier() : 0;
  const payout = won
    ? Math.floor(args.amount * Math.min(mult, config.maxPayoutMultiplier))
    : 0;
  return {
    side,
    landed,
    roll,
    won,
    multiplier: mult.toFixed(4),
    payout,
    digest_hex,
    nonce: args.nonce,
    cursor,
  };
}
