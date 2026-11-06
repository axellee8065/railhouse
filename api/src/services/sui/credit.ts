import { config } from "../../config.js";
import { ApiError } from "../../errors.js";
import { balanceView, creditDeposit, getOrCreateAccount } from "../ledger.js";
import type { DetectedUsdcDeposit } from "./detect.js";

export type CreditFromDetectionResult = {
  credited: boolean;
  replay: boolean;
  skipped?: "unconfirmed";
  deposit: DetectedUsdcDeposit;
  player_id: string;
  operator_id: string;
  balance: ReturnType<typeof balanceView>;
  ledger_entry_id: string;
  note: string;
};

function serializeDeposit(deposit: DetectedUsdcDeposit) {
  return {
    digest: deposit.digest,
    receive_address: deposit.receiveAddress,
    sender_address: deposit.senderAddress,
    amount_atomic: deposit.amountAtomic.toString(),
    amount_ledger_minor: deposit.amountLedgerMinor,
    usdc_decimals: config.sui.usdcDecimals,
    ledger_minor_unit: config.minorUnit,
    checkpoint: deposit.checkpoint,
    confirmations: deposit.confirmations,
    confirmed: deposit.confirmed,
    status: deposit.status,
    timestamp: deposit.timestamp,
    source: deposit.source,
    dry_run: deposit.dryRun,
  };
}

export function creditFromDetection(
  deposit: DetectedUsdcDeposit,
  opts: {
    operatorId: string;
    playerId: string;
    requireConfirmed?: boolean;
  },
): CreditFromDetectionResult {
  const accountPeek = getOrCreateAccount(opts.operatorId, opts.playerId, config.currency);

  if (opts.requireConfirmed !== false && !deposit.confirmed) {
    return {
      credited: false,
      replay: false,
      skipped: "unconfirmed",
      deposit,
      player_id: opts.playerId,
      operator_id: opts.operatorId,
      balance: balanceView(accountPeek),
      ledger_entry_id: "",
      note: `Waiting for confirmations (${deposit.confirmations}/${config.sui.requiredConfirmations}).`,
    };
  }

  if (!deposit.confirmed) {
    throw new ApiError("INVALID_REQUEST", "deposit not yet confirmed", {
      confirmations: deposit.confirmations,
      required: config.sui.requiredConfirmations,
    });
  }

  const { account, entry, replay } = creditDeposit({
    operatorId: opts.operatorId,
    playerId: opts.playerId,
    amount: deposit.amountLedgerMinor,
    currency: config.currency,
    idempotencyKey: `deposit:${deposit.digest}`,
    txId: deposit.digest,
  });

  return {
    credited: !replay,
    replay,
    deposit,
    player_id: opts.playerId,
    operator_id: opts.operatorId,
    balance: balanceView(account),
    ledger_entry_id: entry.entryId,
    note: deposit.dryRun
      ? "Dry-run / fixture credit — sandbox ledger only. Operator self-custody; Railhouse never sole-signs withdrawals."
      : "On-chain Sui testnet USDC deposit credited to sandbox ledger. Operator self-custody; Railhouse never sole-signs withdrawals.",
  };
}

export { serializeDeposit };
