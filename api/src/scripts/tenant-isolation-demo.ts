/**
 * Prove multi-tenant ledger isolation (PoC step C).
 *
 * - Credits operator A, places a bet on A → B balance unchanged
 * - Cross-tenant session / header / withdraw access → HTTP 403
 *
 * Usage:
 *   npm run tenant-isolation-demo
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
import {
  getOrCreateAccount,
  reserveBet,
  settleBet,
  creditDeposit,
  balanceView,
} from "../services/ledger.js";
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
    idempotencyKey?: string;
  } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Rail-Env": "sandbox",
    "X-Request-Id": randomBytes(8).toString("hex"),
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.operatorId) headers["X-Operator-Id"] = opts.operatorId;
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const res = await fetch(`${base}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

async function studioToken(
  base: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const { status, body } = await jsonFetch(base, "/v1/auth/token", {
    method: "POST",
    body: {
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "games:play games:admin",
    },
  });
  assert(status === 200, `token for ${clientId} failed: ${status}`);
  assert(typeof body.access_token === "string", "access_token missing");
  return body.access_token as string;
}

async function main() {
  // Fresh in-memory store for this process.
  seedDemoData();

  const tenantA = config.tenants.A;
  const tenantB = config.tenants.B;

  const balA0 = getOrCreateAccount(tenantA.operatorId, tenantA.playerId, config.currency);
  const balB0 = getOrCreateAccount(tenantB.operatorId, tenantB.playerId, config.currency);
  const aAvailableSeed = balA0.available;
  const bAvailableBefore = balB0.available;

  console.log(
    JSON.stringify(
      {
        step: "seed",
        A: {
          operator_id: tenantA.operatorId,
          player_id: tenantA.playerId,
          available: aAvailableSeed,
        },
        B: {
          operator_id: tenantB.operatorId,
          player_id: tenantB.playerId,
          available: bAvailableBefore,
        },
      },
      null,
      2,
    ),
  );

  // --- 1) Credit A only ---
  const creditAmount = 5_000;
  creditDeposit({
    operatorId: tenantA.operatorId,
    playerId: tenantA.playerId,
    amount: creditAmount,
    currency: config.currency,
    idempotencyKey: `iso_credit_A_${randomBytes(4).toString("hex")}`,
    txId: `iso_tx_A_${randomBytes(4).toString("hex")}`,
    actorId: "tenant-isolation-demo",
  });
  const aAfterCredit = getOrCreateAccount(
    tenantA.operatorId,
    tenantA.playerId,
    config.currency,
  ).available;
  const bAfterCredit = getOrCreateAccount(
    tenantB.operatorId,
    tenantB.playerId,
    config.currency,
  ).available;
  assert(aAfterCredit === aAvailableSeed + creditAmount, "A should gain credit");
  assert(bAfterCredit === bAvailableBefore, "B must be unchanged after A credit");
  console.log(
    JSON.stringify(
      {
        step: "credit_A",
        A_available: aAfterCredit,
        B_available: bAfterCredit,
        B_unchanged: true,
      },
      null,
      2,
    ),
  );

  // --- 2) Bet on A only (lose stake) ---
  const betAmount = 1_000;
  const betId = ids.bet();
  reserveBet({
    operatorId: tenantA.operatorId,
    playerId: tenantA.playerId,
    amount: betAmount,
    currency: config.currency,
    idempotencyKey: `iso_reserve_${betId}`,
    betId,
    actorId: tenantA.playerId,
  });
  settleBet({
    operatorId: tenantA.operatorId,
    playerId: tenantA.playerId,
    amount: betAmount,
    payout: 0,
    currency: config.currency,
    idempotencyKey: `iso_settle_${betId}`,
    betId,
    actorId: tenantA.playerId,
  });
  const aAfterBet = getOrCreateAccount(
    tenantA.operatorId,
    tenantA.playerId,
    config.currency,
  ).available;
  const bAfterBet = getOrCreateAccount(
    tenantB.operatorId,
    tenantB.playerId,
    config.currency,
  ).available;
  assert(aAfterBet === aAfterCredit - betAmount, "A should lose stake on settle payout=0");
  assert(bAfterBet === bAvailableBefore, "B must be unchanged after A bet");
  console.log(
    JSON.stringify(
      {
        step: "bet_A",
        bet_id: betId,
        A_available: aAfterBet,
        B_available: bAfterBet,
        B_unchanged: true,
      },
      null,
      2,
    ),
  );

  // Shared player_id segregation proof
  const sharedA = getOrCreateAccount(tenantA.operatorId, "player_shared_99", config.currency);
  const sharedB = getOrCreateAccount(tenantB.operatorId, "player_shared_99", config.currency);
  assert(sharedA.available !== sharedB.available, "shared player_id must have distinct balances");
  assert(sharedA.available === 25_000, "shared under A seed balance");
  assert(sharedB.available === 75_000, "shared under B seed balance");

  // Journal rows never mix operator_id
  for (const entry of db.journal) {
    assert(
      entry.operatorId === tenantA.operatorId ||
        entry.operatorId === tenantB.operatorId ||
        entry.operatorId === config.demo.operatorId,
      `journal entry missing valid operator_id: ${entry.entryId}`,
    );
  }

  // --- 3) HTTP cross-tenant denies (403) ---
  const app = createApp();
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  try {
    const tokenA = await studioToken(base, tenantA.clientId, tenantA.clientSecret);
    const tokenB = await studioToken(base, tenantB.clientId, tenantB.clientSecret);

    // Launch session under A
    const launch = await jsonFetch(base, "/v1/sessions/launch", {
      method: "POST",
      token: tokenA,
      operatorId: tenantA.operatorId,
      idempotencyKey: `iso_launch_${randomBytes(4).toString("hex")}`,
      body: {
        player_id: tenantA.playerId,
        game_id: config.games.helloDice,
        currency: config.currency,
        meta: { outcome_mode: "rail_pf" },
      },
    });
    assert(launch.status === 201, `launch A failed: ${launch.status}`);
    const sessionId = String(launch.body.session_id);

    // B token + B header against A's session → 403
    const crossSession = await jsonFetch(base, `/v1/sessions/${sessionId}/balance`, {
      token: tokenB,
      operatorId: tenantB.operatorId,
    });
    assert(crossSession.status === 403, `expected 403 cross-session, got ${crossSession.status}`);
    const crossErr = crossSession.body.error as { code?: string } | undefined;
    assert(crossErr?.code === "FORBIDDEN_SCOPE", "expected FORBIDDEN_SCOPE on cross-session");

    // B token with A's X-Operator-Id header → 403
    const crossHeader = await jsonFetch(base, "/v1/admin/players", {
      token: tokenB,
      operatorId: tenantA.operatorId,
    });
    assert(crossHeader.status === 403, `expected 403 header mismatch, got ${crossHeader.status}`);

    // B tries to credit deposit while claiming A's operator header → 403
    const crossDeposit = await jsonFetch(base, "/v1/deposits/usdc", {
      method: "POST",
      token: tokenB,
      operatorId: tenantA.operatorId,
      idempotencyKey: `iso_dep_${randomBytes(4).toString("hex")}`,
      body: {
        player_id: tenantA.playerId,
        amount: 100,
        chain: "sui-testnet",
        asset: "USDC",
        tx_id: `mock_tx_cross_${randomBytes(4).toString("hex")}`,
        mock: true,
      },
    });
    assert(crossDeposit.status === 403, `expected 403 cross-deposit, got ${crossDeposit.status}`);

    // B withdraw request for A's player is scoped to B's ledger (new account under B) —
    // prove withdraw GET/approve cannot touch A's withdrawal.
    // Create a pending withdraw under A, then B tries to approve it.
    const { requestWithdrawal } = await import("../services/withdrawals.js");
    const pending = requestWithdrawal({
      operatorId: tenantA.operatorId,
      playerId: tenantA.playerId,
      amount: 2_000,
      toAddress: "0x2222222222222222222222222222222222222222222222222222222222222222",
      idempotencyKey: `iso_wd_${randomBytes(4).toString("hex")}`,
      actorId: tenantA.playerId,
    });
    assert(pending.withdrawal.status === "pending_approval", "A withdraw should be pending");

    const crossWithdraw = await jsonFetch(
      base,
      `/v1/withdrawals/${pending.withdrawal.id}/approve`,
      {
        method: "POST",
        token: tokenB,
        operatorId: tenantB.operatorId,
        body: { note: "cross-tenant should fail" },
      },
    );
    assert(
      crossWithdraw.status === 403,
      `expected 403 cross-withdraw approve, got ${crossWithdraw.status}`,
    );

    // Tenants side-by-side admin view
    const tenantsView = await jsonFetch(base, "/v1/admin/tenants", {
      token: tokenA,
      operatorId: tenantA.operatorId,
    });
    assert(tenantsView.status === 200, `tenants view failed: ${tenantsView.status}`);
    const tenants = tenantsView.body.tenants as {
      A: { balances: { available: number }; operator_id: string };
      B: { balances: { available: number }; operator_id: string };
    };
    assert(tenants.A.operator_id === tenantA.operatorId, "tenants.A operator mismatch");
    assert(tenants.B.operator_id === tenantB.operatorId, "tenants.B operator mismatch");
    assert(tenantsView.body.never_mix === true, "never_mix flag required");
    assert(
      (tenantsView.body.shared_player_id_proof as { balances_equal?: boolean }).balances_equal ===
        false,
      "shared player proof must show unequal balances",
    );

    // B still unchanged after all A activity + HTTP probes
    const balBFinal = getOrCreateAccount(tenantB.operatorId, tenantB.playerId, config.currency);
    // A withdraw reserved 2000 from available — B untouched
    assert(balBFinal.available === bAvailableBefore, "B available must still match seed");

    const denyAudits = listAuditEvents({
      action: "tenant.isolation_deny",
      limit: 50,
    });
    assert(denyAudits.length >= 3, "expected tenant.isolation_deny audit events");
    for (const ev of denyAudits) {
      assert(typeof ev.operatorId === "string" && ev.operatorId.length > 0, "audit needs operator_id");
      assert(ev.payload && "caller_operator_id" in ev.payload, "deny payload needs caller");
    }

    const depositAudits = listAuditEvents({
      operatorId: tenantA.operatorId,
      action: "deposit.credit",
      limit: 20,
    });
    assert(depositAudits.length >= 1, "deposit.credit audit under A");
    assert(
      depositAudits.every((e) => e.operatorId === tenantA.operatorId),
      "deposit audits must carry operator_id A",
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          B_unchanged: true,
          cross_tenant_denies: {
            session_balance: crossSession.status,
            header_mismatch: crossHeader.status,
            deposit: crossDeposit.status,
            withdraw_approve: crossWithdraw.status,
          },
          isolation_deny_audits: denyAudits.length,
          A: balanceView(
            getOrCreateAccount(tenantA.operatorId, tenantA.playerId, config.currency),
          ),
          B: balanceView(balBFinal),
          credentials: {
            A: {
              operator_id: tenantA.operatorId,
              client_id: tenantA.clientId,
              client_secret: tenantA.clientSecret,
              player_id: tenantA.playerId,
            },
            B: {
              operator_id: tenantB.operatorId,
              client_id: tenantB.clientId,
              client_secret: tenantB.clientSecret,
              player_id: tenantB.playerId,
            },
          },
          confirmation:
            "A credit+bet isolated; B unchanged; cross-tenant calls returned 403; audits include operator_id",
        },
        null,
        2,
      ),
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
