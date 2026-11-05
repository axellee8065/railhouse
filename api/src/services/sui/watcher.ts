import { config } from "../../config.js";
import { creditFromDetection } from "./credit.js";
import { detectUsdcDepositToReceiveAddress, extractUsdcCredit } from "./detect.js";
import { fetchAffectedTransactions, fetchLatestCheckpoint } from "./graphql.js";

export type WatcherStatus = {
  running: boolean;
  enabled: boolean;
  dry_run: boolean;
  receive_address: string;
  usdc_coin_type: string;
  graphql_url: string;
  poll_interval_ms: number;
  required_confirmations: number;
  default_player_id: string;
  default_operator_id: string;
  last_poll_at: string | null;
  last_error: string | null;
  last_checkpoint: number | null;
  seen_digests: number;
  credited_count: number;
  skipped_unconfirmed: number;
  polls: number;
};

type WatcherState = {
  timer: NodeJS.Timeout | null;
  running: boolean;
  lastPollAt: string | null;
  lastError: string | null;
  lastCheckpoint: number | null;
  seen: Set<string>;
  creditedCount: number;
  skippedUnconfirmed: number;
  polls: number;
  startedCursor: string | null;
};

const state: WatcherState = {
  timer: null,
  running: false,
  lastPollAt: null,
  lastError: null,
  lastCheckpoint: null,
  seen: new Set(),
  creditedCount: 0,
  skippedUnconfirmed: 0,
  polls: 0,
  startedCursor: null,
};

export function getWatcherStatus(): WatcherStatus {
  return {
    running: state.running,
    enabled: config.sui.watcherEnabled,
    dry_run: config.sui.dryRun,
    receive_address: config.sui.receiveAddress,
    usdc_coin_type: config.sui.usdcCoinType,
    graphql_url: config.sui.graphqlUrl,
    poll_interval_ms: config.sui.pollIntervalMs,
    required_confirmations: config.sui.requiredConfirmations,
    default_player_id: config.sui.defaultPlayerId,
    default_operator_id: config.sui.defaultOperatorId,
    last_poll_at: state.lastPollAt,
    last_error: state.lastError,
    last_checkpoint: state.lastCheckpoint,
    seen_digests: state.seen.size,
    credited_count: state.creditedCount,
    skipped_unconfirmed: state.skippedUnconfirmed,
    polls: state.polls,
  };
}

async function pollOnce(): Promise<void> {
  state.polls += 1;
  state.lastPollAt = new Date().toISOString();
  try {
    state.lastCheckpoint = await fetchLatestCheckpoint();
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
    return;
  }

  let after: string | null = null;
  let pages = 0;
  const maxPages = 4;

  while (pages < maxPages) {
    pages += 1;
    let page;
    try {
      page = await fetchAffectedTransactions(config.sui.receiveAddress, {
        first: 25,
        after,
      });
    } catch (err) {
      state.lastError = err instanceof Error ? err.message : String(err);
      return;
    }

    for (const tx of page.nodes) {
      if (state.seen.has(tx.digest)) continue;
      const extracted = extractUsdcCredit(tx, config.sui.receiveAddress);
      if (!extracted) {
        state.seen.add(tx.digest);
        continue;
      }

      try {
        const detected = await detectUsdcDepositToReceiveAddress(tx.digest);
        const result = creditFromDetection(detected, {
          operatorId: config.sui.defaultOperatorId,
          playerId: config.sui.defaultPlayerId,
          requireConfirmed: true,
        });
        state.seen.add(tx.digest);
        if (result.skipped === "unconfirmed") {
          state.skippedUnconfirmed += 1;
          // Allow retry once confirmations catch up.
          state.seen.delete(tx.digest);
          continue;
        }
        if (result.credited) {
          state.creditedCount += 1;
          console.log(
            `[sui-deposit-watcher] credited digest=${tx.digest} ledger_minor=${detected.amountLedgerMinor} player=${config.sui.defaultPlayerId}`,
          );
        }
      } catch (err) {
        state.lastError = err instanceof Error ? err.message : String(err);
        // Don't mark seen on hard failures so a transient GraphQL blip can retry.
      }
    }

    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
    // For PoC we only walk recent pages (newest-first is GraphQL default for some filters;
    // if oldest-first, cursor still advances). Stop after a few pages to bound work.
  }

  state.lastError = null;
}

export function startDepositWatcher(): void {
  if (!config.sui.watcherEnabled) {
    console.log("[sui-deposit-watcher] disabled (SUI_DEPOSIT_WATCHER=0)");
    return;
  }
  if (state.running) return;
  state.running = true;
  console.log(
    `[sui-deposit-watcher] starting poll=${config.sui.pollIntervalMs}ms receive=${config.sui.receiveAddress} dry_run=${config.sui.dryRun}`,
  );
  void pollOnce();
  state.timer = setInterval(() => {
    void pollOnce();
  }, config.sui.pollIntervalMs);
  // Don't keep the process alive solely because of the watcher in tests.
  state.timer.unref?.();
}

export function stopDepositWatcher(): void {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.running = false;
}

/** Manual single poll (admin / scripts). */
export async function runDepositWatcherOnce(): Promise<WatcherStatus> {
  await pollOnce();
  return getWatcherStatus();
}
