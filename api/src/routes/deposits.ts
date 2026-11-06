import { Router } from "express";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { requireAuth } from "../middleware/auth.js";
import { balanceView, creditDeposit } from "../services/ledger.js";
import { creditFromDetection, serializeDeposit } from "../services/sui/credit.js";
import { detectUsdcDepositToReceiveAddress } from "../services/sui/detect.js";
import { getWatcherStatus, runDepositWatcherOnce } from "../services/sui/watcher.js";

/**
 * Sui testnet USDC deposits.
 * - Live / GraphQL detection → sandbox ledger credit
 * - Dry-run fixture digest replay when faucet USDC is hard to obtain
 * - Legacy mock stub retained for UI demos
 *
 * Rail never sole-signs withdrawals — withdraw endpoints intentionally absent.
 */
export const depositsRouter = Router();

depositsRouter.get("/address", (_req, res) => {
  res.json({
    chain: config.chain,
    asset: config.asset,
    receive_address: config.sui.receiveAddress,
    usdc_coin_type: config.sui.usdcCoinType,
    usdc_decimals: config.sui.usdcDecimals,
    ledger_minor_unit: config.minorUnit,
    ledger_currency: config.currency,
    required_confirmations: config.sui.requiredConfirmations,
    graphql_url: config.sui.graphqlUrl,
    dry_run_enabled: config.sui.dryRun,
    default_player_id: config.sui.defaultPlayerId,
    custody: "operator-self",
    explorer_account_url: `${config.sui.explorerAccountBase}${config.sui.receiveAddress}`,
    faucet_url: config.sui.faucetUrl,
    instructions: [
      "Get Sui testnet gas (SUI) from a public faucet / wallet faucet.",
      `Get Circle testnet USDC from ${config.sui.faucetUrl} (availability varies).`,
      `Send Circle USDC (${config.sui.usdcCoinType}) on Sui testnet to the receive address below.`,
      "Wait for confirmations; the deposit watcher credits the sandbox ledger (default demo player).",
      "Or POST /v1/deposits/usdc/detect with a tx digest (dry_run fixture supported).",
      "Withdrawals are out of scope — operator self-custody; Railhouse never sole-signs.",
    ],
    conversion_note:
      "On-chain USDC uses 6 decimals; sandbox ledger stores minor_unit=2 (divide atomic by 10^4).",
  });
});

depositsRouter.get("/watcher", (_req, res) => {
  res.json(getWatcherStatus());
});

depositsRouter.post(
  "/watcher/poll",
  requireAuth({ scopes: ["games:admin"] }),
  async (_req, res, next) => {
    try {
      const status = await runDepositWatcherOnce();
      res.json(status);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Detect an on-chain (or dry-run fixture) USDC transfer to the operator receive address
 * and credit the sandbox ledger after confirmations.
 */
depositsRouter.post(
  "/usdc/detect",
  requireAuth({ scopes: ["games:admin"] }),
  async (req, res, next) => {
    try {
      if (req.auth?.kind !== "access") {
        throw new ApiError("FORBIDDEN_SCOPE", "access_token required");
      }
      const digest = String(req.body?.digest ?? req.body?.tx_id ?? "");
      const playerId = String(req.body?.player_id ?? config.sui.defaultPlayerId);
      const dryRun =
        req.body?.dry_run === true ||
        req.body?.dry_run === "true" ||
        (req.body?.dry_run === undefined && config.sui.dryRun);

      if (!digest) {
        throw new ApiError("INVALID_REQUEST", "digest required");
      }

      const detected = await detectUsdcDepositToReceiveAddress(digest, { dryRun });
      const result = creditFromDetection(detected, {
        operatorId: req.operatorId!,
        playerId,
        requireConfirmed: true,
      });

      const status = result.skipped === "unconfirmed" ? 202 : result.replay ? 200 : 201;
      res.status(status).json({
        credited: result.credited,
        replay: result.replay,
        skipped: result.skipped,
        chain: config.chain,
        asset: config.asset,
        player_id: result.player_id,
        operator_id: result.operator_id,
        amount: result.deposit.amountLedgerMinor,
        currency: config.currency,
        minor_unit: config.minorUnit,
        balance: result.balance,
        ledger_entry_id: result.ledger_entry_id || null,
        deposit: serializeDeposit(result.deposit),
        explorer_tx_url: `${config.sui.explorerTxBase}${result.deposit.digest.replace(/^dryrun_/, "")}`,
        note: result.note,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Stub / mock Sui testnet USDC deposit webhook (no chain verification).
 * Prefer POST /usdc/detect for real or dry-run fixture credits.
 */
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
      const isMock = req.body?.mock === true || req.body?.mock === "true";

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

      // If caller passes a real-looking digest without mock flag, nudge toward detect.
      if (!isMock && !txId.startsWith("mock_tx_") && !txId.startsWith("sui_testnet_")) {
        throw new ApiError(
          "INVALID_REQUEST",
          "for on-chain digests use POST /v1/deposits/usdc/detect (or set mock:true for sandbox stub)",
          { hint: "/v1/deposits/usdc/detect", digest: txId },
        );
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
        mock: true,
        note: "Mock/stub credit only — no chain verification. Prefer /usdc/detect. Withdrawals out of scope (operator self-custody).",
      });
    } catch (err) {
      next(err);
    }
  },
);
