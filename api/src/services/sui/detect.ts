import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../../config.js";
import { ApiError } from "../../errors.js";
import { sameCoinType, sameSuiAddress } from "./addresses.js";
import {
  fetchLatestCheckpoint,
  fetchTransactionByDigest,
  type GraphqlTransaction,
} from "./graphql.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(here, "../../../fixtures/sui-usdc-deposit-dry-run.json");

export type DetectedUsdcDeposit = {
  digest: string;
  receiveAddress: string;
  senderAddress: string | null;
  /** On-chain USDC atomic units (6 decimals). */
  amountAtomic: bigint;
  /** Sandbox ledger minor units (config.minorUnit, typically 2). */
  amountLedgerMinor: number;
  checkpoint: number | null;
  confirmations: number;
  confirmed: boolean;
  status: string;
  timestamp: string | null;
  source: "chain" | "dry_run_fixture";
  dryRun: boolean;
};

type DryRunFixture = {
  source_digest: string;
  transaction: GraphqlTransaction;
};

let cachedFixture: DryRunFixture | null = null;

function loadFixture(): DryRunFixture {
  if (cachedFixture) return cachedFixture;
  cachedFixture = JSON.parse(readFileSync(fixturePath, "utf8")) as DryRunFixture;
  return cachedFixture;
}

/** Convert Circle USDC atomic (6 dp) → sandbox ledger minor (config.minorUnit). */
export function usdcAtomicToLedgerMinor(atomic: bigint): number {
  const scale = 10n ** BigInt(config.sui.usdcDecimals - config.minorUnit);
  if (atomic <= 0n) return 0;
  const minor = atomic / scale;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ApiError("INVALID_AMOUNT", "deposit exceeds safe integer range");
  }
  return Number(minor);
}

export function extractUsdcCredit(
  tx: GraphqlTransaction,
  receiveAddress: string,
): { amountAtomic: bigint; senderAddress: string | null } | null {
  const effects = tx.effects;
  if (!effects || String(effects.status).toUpperCase() !== "SUCCESS") return null;

  let credit = 0n;
  for (const change of effects.balanceChanges?.nodes ?? []) {
    const coin = change.coinType?.repr;
    const owner = change.owner?.address;
    if (!coin || !owner) continue;
    if (!sameCoinType(coin, config.sui.usdcCoinType)) continue;
    if (!sameSuiAddress(owner, receiveAddress)) continue;
    const amt = BigInt(change.amount);
    if (amt > 0n) credit += amt;
  }
  if (credit <= 0n) return null;
  return {
    amountAtomic: credit,
    senderAddress: tx.sender?.address ?? null,
  };
}

export async function resolveTransaction(
  digest: string,
  opts: { dryRun?: boolean; signal?: AbortSignal } = {},
): Promise<{ tx: GraphqlTransaction; source: "chain" | "dry_run_fixture"; dryRun: boolean }> {
  const dryRun = Boolean(opts.dryRun) || config.sui.dryRun;
  const fixture = loadFixture();
  const wantsFixture =
    dryRun &&
    (digest === fixture.source_digest ||
      digest === fixture.transaction.digest ||
      digest === `dryrun_${fixture.source_digest}`);

  if (wantsFixture) {
    return { tx: fixture.transaction, source: "dry_run_fixture", dryRun: true };
  }

  const tx = await fetchTransactionByDigest(digest, opts.signal);
  if (!tx) {
    if (dryRun && digest.startsWith("dryrun_")) {
      return { tx: fixture.transaction, source: "dry_run_fixture", dryRun: true };
    }
    throw new ApiError("INVALID_REQUEST", `transaction not found: ${digest}`, { digest });
  }
  return { tx, source: "chain", dryRun };
}

export async function detectUsdcDepositToReceiveAddress(
  digest: string,
  opts: { dryRun?: boolean; receiveAddress?: string; signal?: AbortSignal } = {},
): Promise<DetectedUsdcDeposit> {
  const receiveAddress = opts.receiveAddress ?? config.sui.receiveAddress;
  const { tx, source, dryRun } = await resolveTransaction(digest, opts);
  const extracted = extractUsdcCredit(tx, receiveAddress);
  if (!extracted) {
    throw new ApiError(
      "INVALID_REQUEST",
      "no confirmed USDC credit to operator receive address in this transaction",
      {
        digest: tx.digest,
        receive_address: receiveAddress,
        usdc_coin_type: config.sui.usdcCoinType,
        dry_run: dryRun,
        source,
      },
    );
  }

  const checkpointRaw = tx.effects?.checkpoint?.sequenceNumber;
  const checkpoint = checkpointRaw === undefined || checkpointRaw === null ? null : Number(checkpointRaw);

  let confirmations = 0;
  let confirmed = source === "dry_run_fixture";
  if (checkpoint !== null && Number.isFinite(checkpoint)) {
    try {
      const latest = await fetchLatestCheckpoint(opts.signal);
      confirmations = Math.max(0, latest - checkpoint);
      confirmed = confirmations >= config.sui.requiredConfirmations;
    } catch {
      // If GraphQL checkpoint probe fails, still allow dry-run fixture credits.
      if (source === "dry_run_fixture") {
        confirmed = true;
        confirmations = config.sui.requiredConfirmations;
      }
    }
  } else if (source === "dry_run_fixture") {
    confirmed = true;
    confirmations = config.sui.requiredConfirmations;
  }

  const amountLedgerMinor = usdcAtomicToLedgerMinor(extracted.amountAtomic);
  if (amountLedgerMinor <= 0) {
    throw new ApiError(
      "INVALID_AMOUNT",
      `USDC amount too small to credit at ledger minor_unit=${config.minorUnit}`,
      { amount_atomic: extracted.amountAtomic.toString() },
    );
  }

  return {
    digest: tx.digest,
    receiveAddress,
    senderAddress: extracted.senderAddress,
    amountAtomic: extracted.amountAtomic,
    amountLedgerMinor,
    checkpoint,
    confirmations,
    confirmed,
    status: String(tx.effects?.status ?? "UNKNOWN"),
    timestamp: tx.effects?.timestamp ?? null,
    source,
    dryRun,
  };
}
