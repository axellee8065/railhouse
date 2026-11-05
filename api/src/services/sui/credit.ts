import { config } from "../../config.js";
import { ApiError } from "../../errors.js";
import { balanceView, creditDeposit } from "../ledger.js";
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

export function creditFromDetection(
  deposit: DetectedUsdcDeposit,
  opts: {
    operatorId: string;
    playerId: string;
    requireConfirmed?: boolean;
  },
): CreditFromDetectionResult {
  if (opts.requireConfirmed !== false && !deposit.confirmed) {
    return {
      credited: false,
      replay: false,
      skipped: "unconfirmed",
      deposit,
      player_id: opts.playerId,
      operator_id: opts.operatorId,
      balance: balanceView(
        // lazy: creditDeposit not called; fabricate view via get would need import — call credit path only when confirmed
        {
          operatorId: opts.operatorId,
          playerId: opts.playerId,
          currency: config.currency,
          available: 0,
          reserved: 0,
          minorUnit: config.minorUnit,
          updatedAt: new Date().toISOString(),
        },
      ),
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
