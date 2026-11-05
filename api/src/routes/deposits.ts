import { Router } from "express";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { requireAuth } from "../middleware/auth.js";
import { balanceView, creditDeposit } from "../services/ledger.js";

/**
 * Stub Sui testnet USDC deposit webhook.
 * Credits sandbox player balance; does not verify chain signatures.
 * Rail never sole-signs withdrawals — withdraw endpoints intentionally absent.
 */
export const depositsRouter = Router();

depositsRouter.post(
  "/usdc",
  requireAuth({ scopes: ["games:admin"] }),
  (req, res, next) => {
    try {
      if (req.auth?.kind !== "access") {
        throw new ApiError("FORBIDDEN_SCOPE", "access_token required");
      }
      const playerId = String(req.body?.player_id ?? "");
      const amount = req.body?.amount;
      const txId = String(req.body?.tx_id ?? req.body?.digest ?? "");
      const chain = String(req.body?.chain ?? config.chain);
      const asset = String(req.body?.asset ?? config.asset);

      if (!playerId || !txId) {
        throw new ApiError("INVALID_REQUEST", "player_id and tx_id required");
      }
      if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
        throw new ApiError("INVALID_AMOUNT", "amount must be positive integer minor units");
      }
      if (chain !== config.chain) {
        throw new ApiError("INVALID_REQUEST", `only ${config.chain} supported in PoC`);
      }
      if (asset !== config.asset) {
        throw new ApiError("INVALID_REQUEST", `only ${config.asset} supported in PoC`);
      }

      const { account, entry, replay } = creditDeposit({
        operatorId: req.operatorId!,
        playerId,
        amount,
        currency: config.currency,
        idempotencyKey: `deposit:${txId}`,
        txId,
      });

      res.status(replay ? 200 : 201).json({
        credited: !replay,
        replay,
        chain,
        asset,
        tx_id: txId,
        player_id: playerId,
        operator_id: req.operatorId,
        amount,
        currency: config.currency,
        minor_unit: config.minorUnit,
        balance: balanceView(account),
        ledger_entry_id: entry.entryId,
        note: "Stub credit only — no live Sui signing. Withdrawals are out of scope (operator self-custody).",
      });
    } catch (err) {
      next(err);
    }
  },
);
