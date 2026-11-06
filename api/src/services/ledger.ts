import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { ids } from "../ids.js";
import { db } from "../store/db.js";
import type { JournalEntry, PlayerAccount } from "../types.js";
import { appendAuditEvent } from "./audit.js";

function now(): string {
  return new Date().toISOString();
}

function depositSeenKey(operatorId: string, txId: string): string {
  return `${operatorId}:${txId}`;
}

function assertBalanced(lines: JournalEntry["lines"]): void {
  const byCurrency = new Map<string, { debit: number; credit: number }>();
  for (const line of lines) {
    const cur = byCurrency.get(line.currency) ?? { debit: 0, credit: 0 };
    if (line.direction === "debit") cur.debit += line.amount;
    else cur.credit += line.amount;
    byCurrency.set(line.currency, cur);
  }
  for (const [currency, { debit, credit }] of byCurrency) {
    if (debit !== credit) {
      throw new ApiError("LEDGER_UNAVAILABLE", "unbalanced journal entry", {
        currency,
        debit,
        credit,
      });
    }
  }
}

function post(entry: Omit<JournalEntry, "entryId" | "postedAt">): JournalEntry {
  assertBalanced(entry.lines);
  const full: JournalEntry = {
    ...entry,
    entryId: ids.ledger(),
    postedAt: now(),
  };
  db.journal.push(full);
  return full;
}

export function getOrCreateAccount(
  operatorId: string,
  playerId: string,
  currency = config.currency,
): PlayerAccount {
  const key = db.accountKey(operatorId, playerId, currency);
  let acc = db.accounts.get(key);
  if (!acc) {
    acc = {
      operatorId,
      playerId,
      currency,
      available: 0,
      reserved: 0,
      minorUnit: config.minorUnit,
      updatedAt: now(),
    };
    db.accounts.set(key, acc);
  }
  return acc;
}

export function balanceView(acc: PlayerAccount) {
  return {
    currency: acc.currency,
    available: acc.available,
    reserved: acc.reserved,
    total: acc.available + acc.reserved,
    minor_unit: acc.minorUnit,
  };
}

export function creditDeposit(args: {
  operatorId: string;
  playerId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
  txId: string;
  actorId?: string;
  skipAudit?: boolean;
}): { account: PlayerAccount; entry: JournalEntry; replay: boolean } {
  if (!Number.isInteger(args.amount) || args.amount <= 0) {
    throw new ApiError("INVALID_AMOUNT", "deposit amount must be positive integer");
  }
  const seenKey = depositSeenKey(args.operatorId, args.txId);
  if (db.depositsSeen.has(seenKey)) {
    const account = getOrCreateAccount(args.operatorId, args.playerId, args.currency);
    return {
      account,
      entry: db.journal.find(
        (j) =>
          j.operatorId === args.operatorId &&
          j.idempotencyKey === args.idempotencyKey,
      ) ?? {
        entryId: "replay",
        operatorId: args.operatorId,
        entryType: "deposit_credit",
        idempotencyKey: args.idempotencyKey,
        referenceType: "deposit",
        referenceId: args.txId,
        postedAt: now(),
        lines: [],
      },
      replay: true,
    };
  }

  const account = getOrCreateAccount(args.operatorId, args.playerId, args.currency);
  account.available += args.amount;
  account.updatedAt = now();
  db.depositsSeen.add(seenKey);

  const entry = post({
    operatorId: args.operatorId,
    entryType: "deposit_credit",
    idempotencyKey: args.idempotencyKey,
    referenceType: "deposit",
    referenceId: args.txId,
    lines: [
      {
        account: "asset.crypto_hot.usdc",
        direction: "debit",
        amount: args.amount,
        currency: args.currency,
      },
      {
        account: `liability.player.${args.playerId}`,
        direction: "credit",
        amount: args.amount,
        currency: args.currency,
      },
    ],
  });

  if (!args.skipAudit) {
    appendAuditEvent({
      operatorId: args.operatorId,
      actorType: "system",
      actorId: args.actorId ?? "ledger",
      action: "deposit.credit",
      entityType: "deposit",
      entityId: args.txId,
      payload: {
        operator_id: args.operatorId,
        player_id: args.playerId,
        amount: args.amount,
        currency: args.currency,
        ledger_entry_id: entry.entryId,
      },
    });
  }

  return { account, entry, replay: false };
}

export function reserveBet(args: {
  operatorId: string;
  playerId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
  betId: string;
  actorId?: string;
  skipAudit?: boolean;
}): { account: PlayerAccount; entry: JournalEntry } {
  const account = getOrCreateAccount(args.operatorId, args.playerId, args.currency);
  if (account.available < args.amount) {
    throw new ApiError("INSUFFICIENT_FUNDS", "available balance is less than bet amount", {
      available: account.available,
      requested: args.amount,
    });
  }
  account.available -= args.amount;
  account.reserved += args.amount;
  account.updatedAt = now();

  const entry = post({
    operatorId: args.operatorId,
    entryType: "bet_reserve",
    idempotencyKey: args.idempotencyKey,
    referenceType: "bet",
    referenceId: args.betId,
    lines: [
      {
        account: `player.available.${args.playerId}`,
        direction: "debit",
        amount: args.amount,
        currency: args.currency,
      },
      {
        account: `player.reserved.${args.playerId}`,
        direction: "credit",
        amount: args.amount,
        currency: args.currency,
      },
    ],
  });

  if (!args.skipAudit) {
    appendAuditEvent({
      operatorId: args.operatorId,
      actorType: "player",
      actorId: args.actorId ?? args.playerId,
      action: "bet.reserve",
      entityType: "bet",
      entityId: args.betId,
      payload: {
        operator_id: args.operatorId,
        player_id: args.playerId,
        amount: args.amount,
        currency: args.currency,
        ledger_entry_id: entry.entryId,
      },
    });
  }

  return { account, entry };
}

export function settleBet(args: {
  operatorId: string;
  playerId: string;
  amount: number;
  payout: number;
  currency: string;
  idempotencyKey: string;
  betId: string;
  actorId?: string;
  skipAudit?: boolean;
}): { account: PlayerAccount; entry: JournalEntry } {
  const account = getOrCreateAccount(args.operatorId, args.playerId, args.currency);
  if (account.reserved < args.amount) {
    throw new ApiError("LEDGER_UNAVAILABLE", "reserved balance mismatch", {
      reserved: account.reserved,
      amount: args.amount,
    });
  }

  // Release reservation, confirm stake loss to house, credit payout.
  account.reserved -= args.amount;
  const netToPlayer = args.payout;
  account.available += netToPlayer;
  account.updatedAt = now();

  const houseRetain = args.amount; // stake leaves player liability toward house income
  const lines: JournalEntry["lines"] = [
    {
      account: `player.reserved.${args.playerId}`,
      direction: "debit",
      amount: args.amount,
      currency: args.currency,
    },
    {
      account: "income.house",
      direction: "credit",
      amount: houseRetain,
      currency: args.currency,
    },
  ];

  if (args.payout > 0) {
    lines.push(
      {
        account: "expense.payout",
        direction: "debit",
        amount: args.payout,
        currency: args.currency,
      },
      {
        account: `player.available.${args.playerId}`,
        direction: "credit",
        amount: args.payout,
        currency: args.currency,
      },
    );
  }

  const entry = post({
    operatorId: args.operatorId,
    entryType: "bet_settle",
    idempotencyKey: args.idempotencyKey,
    referenceType: "bet",
    referenceId: args.betId,
    lines,
  });

  if (!args.skipAudit) {
    appendAuditEvent({
      operatorId: args.operatorId,
      actorType: "player",
      actorId: args.actorId ?? args.playerId,
      action: "bet.settle",
      entityType: "bet",
      entityId: args.betId,
      payload: {
        operator_id: args.operatorId,
        player_id: args.playerId,
        amount: args.amount,
        payout: args.payout,
        currency: args.currency,
        ledger_entry_id: entry.entryId,
      },
    });
  }

  return { account, entry };
}

/** Hold funds for a pending withdrawal (available → reserved). */
export function reserveWithdraw(args: {
  operatorId: string;
  playerId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
  withdrawalId: string;
}): { account: PlayerAccount; entry: JournalEntry } {
  const account = getOrCreateAccount(args.operatorId, args.playerId, args.currency);
  if (account.available < args.amount) {
    throw new ApiError("INSUFFICIENT_FUNDS", "available balance is less than withdraw amount", {
      available: account.available,
      requested: args.amount,
    });
  }
  account.available -= args.amount;
  account.reserved += args.amount;
  account.updatedAt = now();

  const entry = post({
    operatorId: args.operatorId,
    entryType: "withdraw_reserve",
    idempotencyKey: args.idempotencyKey,
    referenceType: "withdrawal",
    referenceId: args.withdrawalId,
    lines: [
      {
        account: `player.available.${args.playerId}`,
        direction: "debit",
        amount: args.amount,
        currency: args.currency,
      },
      {
        account: `player.reserved.${args.playerId}`,
        direction: "credit",
        amount: args.amount,
        currency: args.currency,
      },
    ],
  });

  return { account, entry };
}

/** Release a withdraw hold back to available (admin reject). */
export function releaseWithdrawHold(args: {
  operatorId: string;
  playerId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
  withdrawalId: string;
}): { account: PlayerAccount; entry: JournalEntry } {
  const account = getOrCreateAccount(args.operatorId, args.playerId, args.currency);
  if (account.reserved < args.amount) {
    throw new ApiError("LEDGER_UNAVAILABLE", "reserved balance mismatch on withdraw release", {
      reserved: account.reserved,
      amount: args.amount,
    });
  }
  account.reserved -= args.amount;
  account.available += args.amount;
  account.updatedAt = now();

  const entry = post({
    operatorId: args.operatorId,
    entryType: "withdraw_release",
    idempotencyKey: args.idempotencyKey,
    referenceType: "withdrawal",
    referenceId: args.withdrawalId,
    lines: [
      {
        account: `player.reserved.${args.playerId}`,
        direction: "debit",
        amount: args.amount,
        currency: args.currency,
      },
      {
        account: `player.available.${args.playerId}`,
        direction: "credit",
        amount: args.amount,
        currency: args.currency,
      },
    ],
  });

  return { account, entry };
}

export function voidBet(args: {
  operatorId: string;
  playerId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
  betId: string;
}): { account: PlayerAccount; entry: JournalEntry } {
  const account = getOrCreateAccount(args.operatorId, args.playerId, args.currency);
  if (account.reserved < args.amount) {
    throw new ApiError("LEDGER_UNAVAILABLE", "reserved balance mismatch on void", {
      reserved: account.reserved,
      amount: args.amount,
    });
  }
  account.reserved -= args.amount;
  account.available += args.amount;
  account.updatedAt = now();

  const entry = post({
    operatorId: args.operatorId,
    entryType: "bet_void",
    idempotencyKey: args.idempotencyKey,
    referenceType: "bet",
    referenceId: args.betId,
    lines: [
      {
        account: `player.reserved.${args.playerId}`,
        direction: "debit",
        amount: args.amount,
        currency: args.currency,
      },
      {
        account: `player.available.${args.playerId}`,
        direction: "credit",
        amount: args.amount,
        currency: args.currency,
      },
    ],
  });

  return { account, entry };
}
