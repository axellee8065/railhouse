import { config } from "../config.js";
import { digestToRoll, hmacDigest } from "./fairness.js";

export type DiceCondition = "over" | "under";

export interface DicePayload {
  target: number;
  condition: DiceCondition;
}

export interface DiceOutcome {
  roll: number;
  won: boolean;
  multiplier: string;
  payout: number;
  digest_hex: string;
  nonce: number;
  cursor: number;
  target: number;
  condition: DiceCondition;
}

function assertPayload(payload: Record<string, unknown> | undefined): DicePayload {
  const target = Number(payload?.target);
  const condition = payload?.condition;
  if (!Number.isFinite(target) || target < 0.01 || target > 99.99) {
    throw new Error("target must be between 0.01 and 99.99");
  }
  if (condition !== "over" && condition !== "under") {
    throw new Error("condition must be over or under");
  }
  return { target, condition };
}

/** Win chance & multiplier with house edge (floor payout). */
export function computeMultiplier(target: number, condition: DiceCondition): number {
  const winChance =
    condition === "over" ? (100 - target) / 100 : target / 100;
  if (winChance <= 0 || winChance >= 1) {
    return 0;
  }
  return (1 - config.houseEdge) / winChance;
}

export function evaluateHelloDice(args: {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  cursor?: number;
  amount: number;
  payload?: Record<string, unknown>;
}): DiceOutcome {
  const { target, condition } = assertPayload(args.payload);
  const cursor = args.cursor ?? 0;
  const digest_hex = hmacDigest(
    args.serverSeed,
    args.clientSeed,
    args.nonce,
    cursor,
  );
  const roll = digestToRoll(digest_hex);
  const won =
    condition === "over" ? roll > target : roll < target;
  const mult = won ? computeMultiplier(target, condition) : 0;
  const payout = won
    ? Math.floor(args.amount * Math.min(mult, config.maxPayoutMultiplier))
    : 0;
  return {
    roll,
    won,
    multiplier: mult.toFixed(4),
    payout,
    digest_hex,
    nonce: args.nonce,
    cursor,
    target,
    condition,
  };
}
