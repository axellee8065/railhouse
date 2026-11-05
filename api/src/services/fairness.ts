import { createHash, createHmac, randomBytes } from "node:crypto";
import type { FairnessState } from "../types.js";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function createServerSeed(): { serverSeed: string; serverSeedHash: string } {
  const serverSeed = randomBytes(32).toString("hex");
  return { serverSeed, serverSeedHash: sha256Hex(serverSeed) };
}

export function defaultClientSeed(): string {
  return `client_${randomBytes(8).toString("hex")}`;
}

export function newFairnessState(): FairnessState {
  const { serverSeed, serverSeedHash } = createServerSeed();
  return {
    algorithm: "hmac-sha256",
    serverSeed,
    serverSeedHash,
    clientSeed: defaultClientSeed(),
    nextNonce: 0,
    rotatedAt: null,
    previousServerSeed: null,
  };
}

export function hmacDigest(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  cursor = 0,
): string {
  const msg = `${clientSeed}:${nonce}:${cursor}`;
  return createHmac("sha256", serverSeed).update(msg).digest("hex");
}

/** Map first 4 bytes of digest → float in [0, 100). */
export function digestToRoll(digestHex: string): number {
  const slice = digestHex.slice(0, 8);
  const int = Number.parseInt(slice, 16);
  // Use 2^32 range → [0, 100)
  const roll = (int / 0x1_0000_0000) * 100;
  return Math.floor(roll * 100) / 100; // 2 decimal places
}

/** Map first 4 bytes of digest → (0, 1] for limbo / continuous games. */
export function digestToUnitInterval(digestHex: string): number {
  const slice = digestHex.slice(0, 8);
  const int = Number.parseInt(slice, 16);
  const u = int / 0x1_0000_0000;
  return Math.max(u, Number.EPSILON);
}

export function rotateFairness(state: FairnessState): {
  previous_server_seed: string;
  previous_server_seed_hash: string;
  new_server_seed_hash: string;
  next_nonce: number;
} {
  const previous = state.serverSeed;
  const previousHash = state.serverSeedHash;
  const next = createServerSeed();
  state.previousServerSeed = previous;
  state.serverSeed = next.serverSeed;
  state.serverSeedHash = next.serverSeedHash;
  state.nextNonce = 0;
  state.rotatedAt = new Date().toISOString();
  return {
    previous_server_seed: previous,
    previous_server_seed_hash: previousHash,
    new_server_seed_hash: next.serverSeedHash,
    next_nonce: 0,
  };
}
