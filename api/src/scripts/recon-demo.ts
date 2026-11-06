/**
 * Prove 3-way reconciliation (PoC step D).
 *
 * Flow: seed → inject missing + duplicate → run recon → tickets open 100%
 *       → clear injections → re-run → tickets resolve.
 *
 * Usage:
 *   npm run recon-demo
 *
 * Exits non-zero if any assertion fails.
 */
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import { config } from "../config.js";
import { seedDemoData } from "../seed.js";
import { listAuditEvents } from "../services/audit.js";
import { creditDeposit, reserveBet, settleBet } from "../services/ledger.js";
import {
  clearInjections,
  injectAnomaly,
  listTickets,
  runReconciliation,
} from "../services/reconciliation.js";
import { db } from "../store/db.js";
import { ids } from "../ids.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

async function jsonFetch(
  base: string,
  path: string,
  opts: {
    method?: string;
    token?: string;
    operatorId?: string;
    body?: unknown;
  } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Rail-Env": "sandbox",
    "X-Request-Id": randomBytes(8).toString("hex"),
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.operatorId) headers["X-Operator-Id"] = opts.operatorId;

  const res = await fetch(`${base}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

async function studioToken(base: string): Promise<string> {
  const { status, body } = await jsonFetch(base, "/v1/auth/token", {
    method: "POST",
    body: {
      grant_type: "client_credentials",
      client_id: config.demo.clientId,
      client_secret: config.demo.clientSecret,
      scope: "games:play games:admin",
    },
  });
  assert(status === 200, `token failed: ${status}`);
  assert(typeof body.access_token === "string", "access_token missing");
  return body.access_token as string;
}

async function main() {
  seedDemoData();

  const operatorId = config.demo.operatorId;
  const playerId = config.demo.playerId;

  // Extra deposit + bet so we have rich 3-way facts beyond seed.
  const extraTx = `recon_demo_tx_${randomBytes(4).toString("hex")}`;
  creditDeposit({
    operatorId,
    playerId,
    amount: 7_500,
    currency: config.currency,
    idempotencyKey: `recon_demo_credit_${extraTx}`,
    txId: extraTx,
    actorId: "recon-demo",
  });

  const betId = ids.bet();
  const nowIso = new Date().toISOString();
  // Game-leg bet meta must exist alongside rail journal rows for a clean baseline.
  db.bets.set(betId, {
    betId,
    sessionId: "sess_recon_demo",
    operatorId,
    playerId,
    gameId: config.games.helloDice,
    roundId: "round_recon_demo",
    status: "settled",
    amount: 500,
    currency: config.currency,
    betType: "recon_demo",
    reservationId: ids.reservation(),
    payout: 0,
    profit: -500,
    createdAt: nowIso,
    settledAt: nowIso,
    placeIdempotencyKey: `recon_demo_reserve_${betId}`,
    settleIdempotencyKey: `recon_demo_settle_${betId}`,
  });
  reserveBet({
    operatorId,
    playerId,
    amount: 500,
    currency: config.currency,
    idempotencyKey: `recon_demo_reserve_${betId}`,
    betId,
    actorId: playerId,
  });
  settleBet({
    operatorId,
    playerId,
    amount: 500,
    payout: 0,
    currency: config.currency,
    idempotencyKey: `recon_demo_settle_${betId}`,
    betId,
    actorId: playerId,
  });

  // Baseline: clean state should produce zero discrepancies.
  const baseline = runReconciliation({
    operatorId,
    actorId: "recon-demo",
  });
  assert(
    baseline.run.diffSummary.total === 0,
    `baseline should be clean, got ${baseline.run.diffSummary.total} diffs: ${JSON.stringify(baseline.run.discrepancies)}`,
  );
  console.log(
    JSON.stringify(
      {
        step: "baseline",
        ok: true,
        leg_counts: baseline.run.legCounts,
        diffs: 0,
      },
      null,
      2,
    ),
  );

  // --- Inject missing on chain (deposit) ---
  const missingChain = injectAnomaly({
    operatorId,
    type: "missing",
    leg: "chain",
    targetKey: `deposit:${extraTx}`,
    note: "demo: hide deposit from chain leg",
    actorId: "recon-demo",
  });

  // --- Inject missing on game (same deposit's seed peer — use seed tx) ---
  const seedKey = "deposit:sui_testnet_seed_tx_001";
  const missingGame = injectAnomaly({
    operatorId,
    type: "missing",
    leg: "game",
    targetKey: seedKey,
    note: "demo: hide seed deposit from game leg",
    actorId: "recon-demo",
  });

  // --- Inject duplicate on rail ---
  const dupRail = injectAnomaly({
    operatorId,
    type: "duplicate",
    leg: "rail",
    targetKey: `deposit:${extraTx}`,
    note: "demo: duplicate deposit on rail journal view",
    actorId: "recon-demo",
  });

  // --- Inject missing bet on rail ---
  const missingBetRail = injectAnomaly({
    operatorId,
    type: "missing",
    leg: "rail",
    targetKey: `bet:${betId}`,
    note: "demo: hide bet from rail journal view",
    actorId: "recon-demo",
  });

  console.log(
    JSON.stringify(
      {
        step: "inject",
        injections: [
          missingChain.id,
          missingGame.id,
          dupRail.id,
          missingBetRail.id,
        ],
      },
      null,
      2,
    ),
  );

  const detected = runReconciliation({
    operatorId,
    actorId: "recon-demo",
  });

  const diffs = detected.run.discrepancies;
  const byKind = detected.run.diffSummary;

  // Expect: missing chain (extraTx), missing game (seed), duplicate rail (extraTx), missing rail (bet)
  assert(byKind.missing >= 3, `expected >=3 missing, got ${byKind.missing}`);
  assert(byKind.duplicate >= 1, `expected >=1 duplicate, got ${byKind.duplicate}`);
  assert(byKind.total >= 4, `expected >=4 total diffs, got ${byKind.total}`);

  const openTickets = listTickets({ operatorId, status: "open" });
  assert(
    openTickets.length === byKind.total,
    `open tickets (${openTickets.length}) must equal diffs (${byKind.total})`,
  );

  // 100% detection of each injected anomaly
  const fingerprints = new Set(
    diffs.map((d) => `${d.kind}|${d.leg}|${d.targetKey}`),
  );
  assert(
    fingerprints.has(`missing|chain|deposit:${extraTx}`),
    "missing chain deposit not detected",
  );
  assert(
    fingerprints.has(`missing|game|${seedKey}`),
    "missing game deposit not detected",
  );
  assert(
    fingerprints.has(`duplicate|rail|deposit:${extraTx}`),
    "duplicate rail deposit not detected",
  );
  assert(
    fingerprints.has(`missing|rail|bet:${betId}`),
    "missing rail bet not detected",
  );

  // Every injected id should be referenced by at least one discrepancy
  for (const inj of [missingChain, missingGame, dupRail, missingBetRail]) {
    assert(
      diffs.some((d) => d.injectionId === inj.id),
      `injection ${inj.id} (${inj.type}/${inj.leg}) not linked to a discrepancy`,
    );
  }

  console.log(
    JSON.stringify(
      {
        step: "detect",
        ok: true,
        detection_rate: "100%",
        diff_summary: byKind,
        open_tickets: openTickets.length,
        discrepancies: diffs.map((d) => ({
          kind: d.kind,
          leg: d.leg,
          key: d.targetKey,
          injection_id: d.injectionId,
        })),
      },
      null,
      2,
    ),
  );

  // --- HTTP API smoke ---
  const app = createApp();
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  try {
    const token = await studioToken(base);

    const ticketsRes = await jsonFetch(base, "/v1/admin/reconciliation/tickets?status=open", {
      token,
      operatorId,
    });
    assert(ticketsRes.status === 200, `tickets API failed: ${ticketsRes.status}`);
    assert(
      Number(ticketsRes.body.open_count) === openTickets.length,
      "tickets API open_count mismatch",
    );

    const injectRes = await jsonFetch(base, "/v1/admin/reconciliation/inject", {
      method: "POST",
      token,
      operatorId,
      body: {
        type: "duplicate",
        leg: "chain",
        target_key: seedKey,
        note: "http inject duplicate on chain",
      },
    });
    assert(injectRes.status === 201, `inject API failed: ${injectRes.status}`);

    const runRes = await jsonFetch(base, "/v1/admin/reconciliation/run", {
      method: "POST",
      token,
      operatorId,
      body: { mode: "dry_run_fixture" },
    });
    assert(runRes.status === 200, `run API failed: ${runRes.status}`);
    const runBody = runRes.body.run as { diff_summary?: { total?: number } };
    assert(
      (runBody.diff_summary?.total ?? 0) >= 5,
      "run after HTTP inject should add at least one more diff",
    );

    const overview = await jsonFetch(base, "/v1/admin/reconciliation", {
      token,
      operatorId,
    });
    assert(overview.status === 200, `overview API failed: ${overview.status}`);
    assert(
      Array.isArray((overview.body as { three_way?: unknown }).three_way),
      "overview needs three_way",
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }

  // Clear injections → re-run → tickets resolve
  const cleared = clearInjections(operatorId);
  assert(cleared >= 4, `expected to clear >=4 injections, cleared ${cleared}`);

  const healed = runReconciliation({
    operatorId,
    actorId: "recon-demo",
  });
  assert(
    healed.run.diffSummary.total === 0,
    `after clear, diffs should be 0, got ${healed.run.diffSummary.total}`,
  );
  assert(
    healed.run.ticketsResolved.length > 0,
    "expected tickets to auto-resolve after clear",
  );
  const stillOpen = listTickets({ operatorId, status: "open" });
  assert(stillOpen.length === 0, `expected 0 open tickets, got ${stillOpen.length}`);

  const runAudits = listAuditEvents({
    operatorId,
    action: "recon.run",
    limit: 20,
  });
  const injectAudits = listAuditEvents({
    operatorId,
    action: "recon.inject",
    limit: 50,
  });
  const openAudits = listAuditEvents({
    operatorId,
    action: "recon.ticket_open",
    limit: 50,
  });
  const resolveAudits = listAuditEvents({
    operatorId,
    action: "recon.ticket_resolve",
    limit: 50,
  });

  assert(runAudits.length >= 2, "expected recon.run audit events");
  assert(injectAudits.length >= 4, "expected recon.inject audit events");
  assert(openAudits.length >= 4, "expected recon.ticket_open audit events");
  assert(resolveAudits.length >= 4, "expected recon.ticket_resolve audit events");

  console.log(
    JSON.stringify(
      {
        ok: true,
        detection_rate: "100%",
        injections_cleared: cleared,
        tickets_resolved: healed.run.ticketsResolved.length,
        open_tickets_after_heal: stillOpen.length,
        audit_counts: {
          recon_run: runAudits.length,
          recon_inject: injectAudits.length,
          recon_ticket_open: openAudits.length,
          recon_ticket_resolve: resolveAudits.length,
        },
        journal_entries: db.journal.filter((j) => j.operatorId === operatorId).length,
        confirmation:
          "inject missing+duplicate → detect 100% → open tickets → clear → resolve; HTTP APIs OK; audits written",
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
