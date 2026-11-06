import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { ids } from "../ids.js";
import { db } from "../store/db.js";
import type {
  ReconDiscrepancy,
  ReconFact,
  ReconFactKind,
  ReconInjectedAnomaly,
  ReconInjectType,
  ReconLeg,
  ReconRun,
  ReconTicket,
} from "../types.js";
import { appendAuditEvent } from "./audit.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(here, "../../fixtures/sui-usdc-deposit-dry-run.json");

type FixtureMeta = {
  transaction?: { digest?: string };
  source_digest?: string;
  ledger_amount_minor_hint?: number;
};

function now(): string {
  return new Date().toISOString();
}

function factKey(kind: ReconFactKind, referenceId: string): string {
  return `${kind}:${referenceId}`;
}

function loadFixtureDigest(): { digest: string; amountHint: number } | null {
  try {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as FixtureMeta;
    const digest = raw.transaction?.digest ?? raw.source_digest;
    if (!digest) return null;
    return {
      digest,
      amountHint: raw.ledger_amount_minor_hint ?? 0,
    };
  } catch {
    return null;
  }
}

function playerFromLiability(account: string): string | undefined {
  const m = /liability\.player\.(.+)$/.exec(account);
  return m?.[1];
}

/**
 * Build canonical deposit/bet facts from the live store (pre-inject overlay).
 * - game: bet meta + deposit expectations mirrored from credits
 * - rail: journal deposit_credit + bet_reserve/bet_settle
 * - chain: depositsSeen digests (+ dry-run fixture digest when present)
 */
function buildCanonicalLegs(operatorId: string): Record<ReconLeg, ReconFact[]> {
  const game: ReconFact[] = [];
  const rail: ReconFact[] = [];
  const chain: ReconFact[] = [];

  const depositEntries = db.journal.filter(
    (j) => j.operatorId === operatorId && j.entryType === "deposit_credit",
  );

  for (const entry of depositEntries) {
    const credit = entry.lines.find(
      (l) => l.direction === "credit" && l.account.startsWith("liability.player"),
    );
    const amount =
      credit?.amount ??
      entry.lines.find((l) => l.direction === "debit")?.amount ??
      0;
    const playerId = credit ? playerFromLiability(credit.account) : undefined;
    const fact: ReconFact = {
      key: factKey("deposit", entry.referenceId),
      kind: "deposit",
      referenceId: entry.referenceId,
      amount,
      currency: credit?.currency ?? config.currency,
      playerId,
      sourceId: entry.entryId,
    };
    // Game ledger mirror expects the same deposit the operator credited.
    game.push({ ...fact });
    rail.push({ ...fact, sourceId: entry.entryId });
  }

  // Chain digests from depositsSeen (tenant-scoped).
  for (const seen of db.depositsSeen) {
    if (!seen.startsWith(`${operatorId}:`)) continue;
    const txId = seen.slice(operatorId.length + 1);
    const key = factKey("deposit", txId);
    const fromRail = rail.find((f) => f.key === key);
    chain.push({
      key,
      kind: "deposit",
      referenceId: txId,
      amount: fromRail?.amount ?? 0,
      currency: fromRail?.currency ?? config.currency,
      playerId: fromRail?.playerId,
      sourceId: seen,
    });
  }

  // Ensure dry-run fixture digest appears on chain when dry-run is enabled
  // and not already credited — still part of the chain universe for recon demos.
  if (config.sui.dryRun) {
    const fixture = loadFixtureDigest();
    if (fixture) {
      const key = factKey("deposit", fixture.digest);
      if (!chain.some((f) => f.key === key)) {
        // Only surface fixture as an expected chain fact when it was also credited
        // into rail/game — otherwise seed noise would open permanent tickets.
        const inRail = rail.some((f) => f.key === key);
        if (inRail) {
          chain.push({
            key,
            kind: "deposit",
            referenceId: fixture.digest,
            amount: fixture.amountHint,
            currency: config.currency,
            sourceId: "dry_run_fixture",
          });
        }
      }
    }
  }

  // Bets: game meta ↔ rail journal (chain does not carry bet facts).
  for (const bet of db.bets.values()) {
    if (bet.operatorId !== operatorId) continue;
    const gameFact: ReconFact = {
      key: factKey("bet", bet.betId),
      kind: "bet",
      referenceId: bet.betId,
      amount: bet.amount,
      currency: bet.currency,
      playerId: bet.playerId,
      sourceId: bet.betId,
    };
    game.push(gameFact);

    const journalBet = db.journal.filter(
      (j) =>
        j.operatorId === operatorId &&
        j.referenceType === "bet" &&
        j.referenceId === bet.betId &&
        (j.entryType === "bet_reserve" || j.entryType === "bet_settle"),
    );
    // One rail fact per bet (use settle amount if settled, else reserve).
    if (journalBet.length > 0) {
      const prefer =
        journalBet.find((j) => j.entryType === "bet_settle") ?? journalBet[0]!;
      const lineAmt =
        prefer.lines.find((l) => l.amount > 0)?.amount ?? bet.amount;
      rail.push({
        key: factKey("bet", bet.betId),
        kind: "bet",
        referenceId: bet.betId,
        amount: prefer.entryType === "bet_settle" ? bet.amount : lineAmt,
        currency: bet.currency,
        playerId: bet.playerId,
        sourceId: prefer.entryId,
      });
    }
  }

  // Orphan rail bet journal rows (no game bet) — still surface for missing detection.
  for (const entry of db.journal) {
    if (entry.operatorId !== operatorId) continue;
    if (entry.referenceType !== "bet") continue;
    if (entry.entryType !== "bet_reserve" && entry.entryType !== "bet_settle") {
      continue;
    }
    const key = factKey("bet", entry.referenceId);
    if (rail.some((f) => f.key === key)) continue;
    const amt = entry.lines.find((l) => l.amount > 0)?.amount ?? 0;
    rail.push({
      key,
      kind: "bet",
      referenceId: entry.referenceId,
      amount: amt,
      currency: entry.lines[0]?.currency ?? config.currency,
      sourceId: entry.entryId,
    });
  }

  return { game, rail, chain };
}

/** Apply inject overlays: missing hides a fact on a leg; duplicate clones it. */
function applyInjections(
  operatorId: string,
  legs: Record<ReconLeg, ReconFact[]>,
): Record<ReconLeg, ReconFact[]> {
  const out: Record<ReconLeg, ReconFact[]> = {
    game: [...legs.game],
    rail: [...legs.rail],
    chain: [...legs.chain],
  };

  const injections = db.reconInjections.filter((i) => i.operatorId === operatorId);

  for (const inj of injections) {
    if (inj.type === "missing") {
      out[inj.leg] = out[inj.leg].filter((f) => f.key !== inj.targetKey);
      continue;
    }
    // duplicate — clone an existing fact onto the target leg (or fabricate from peers)
    const peers = [...out.game, ...out.rail, ...out.chain];
    const base =
      out[inj.leg].find((f) => f.key === inj.targetKey) ??
      peers.find((f) => f.key === inj.targetKey);
    if (!base) continue;
    out[inj.leg].push({
      ...base,
      amount: inj.amount ?? base.amount,
      sourceId: `inject_dup_${inj.id}`,
    });
  }

  return out;
}

function countByKey(facts: ReconFact[]): Map<string, { count: number; amounts: number[]; sample: ReconFact }> {
  const map = new Map<string, { count: number; amounts: number[]; sample: ReconFact }>();
  for (const f of facts) {
    const cur = map.get(f.key);
    if (!cur) {
      map.set(f.key, { count: 1, amounts: [f.amount], sample: f });
    } else {
      cur.count += 1;
      cur.amounts.push(f.amount);
    }
  }
  return map;
}

function findInjection(
  operatorId: string,
  type: ReconInjectType,
  leg: ReconLeg,
  targetKey: string,
): ReconInjectedAnomaly | undefined {
  return db.reconInjections.find(
    (i) =>
      i.operatorId === operatorId &&
      i.type === type &&
      i.leg === leg &&
      i.targetKey === targetKey,
  );
}

/**
 * Diff three legs.
 * - Deposits: require presence (and matching amount) on game + rail + chain
 * - Bets: require presence (and matching amount) on game + rail (chain N/A)
 */
export function diffLegs(
  operatorId: string,
  legs: Record<ReconLeg, ReconFact[]>,
): ReconDiscrepancy[] {
  const gameMap = countByKey(legs.game);
  const railMap = countByKey(legs.rail);
  const chainMap = countByKey(legs.chain);

  const allKeys = new Set<string>([
    ...gameMap.keys(),
    ...railMap.keys(),
    ...chainMap.keys(),
  ]);

  const diffs: ReconDiscrepancy[] = [];

  for (const key of allKeys) {
    const sample =
      gameMap.get(key)?.sample ??
      railMap.get(key)?.sample ??
      chainMap.get(key)?.sample;
    if (!sample) continue;

    const g = gameMap.get(key)?.count ?? 0;
    const r = railMap.get(key)?.count ?? 0;
    const c = chainMap.get(key)?.count ?? 0;
    const factKind = sample.kind;
    const legsNeeded: ReconLeg[] =
      factKind === "deposit" ? ["game", "rail", "chain"] : ["game", "rail"];

    // Duplicates on any applicable leg
    for (const leg of legsNeeded) {
      const count = leg === "game" ? g : leg === "rail" ? r : c;
      if (count > 1) {
        const inj = findInjection(operatorId, "duplicate", leg, key);
        diffs.push({
          kind: "duplicate",
          targetKey: key,
          factKind,
          leg,
          summary: `Duplicate ${factKind} on ${leg}: ${key} appears ${count}×`,
          counts: { game: g, rail: r, chain: c },
          amounts: {
            game: gameMap.get(key)?.amounts[0] ?? null,
            rail: railMap.get(key)?.amounts[0] ?? null,
            chain: chainMap.get(key)?.amounts[0] ?? null,
          },
          injectionId: inj?.id,
        });
      }
    }

    // Missing from an applicable leg (present on at least one peer)
    for (const leg of legsNeeded) {
      const count = leg === "game" ? g : leg === "rail" ? r : c;
      if (count === 0) {
        const peersPresent = legsNeeded.some((L) => {
          const n = L === "game" ? g : L === "rail" ? r : c;
          return L !== leg && n > 0;
        });
        if (!peersPresent) continue;
        const inj = findInjection(operatorId, "missing", leg, key);
        diffs.push({
          kind: "missing",
          targetKey: key,
          factKind,
          leg,
          summary: `Missing ${factKind} on ${leg}: ${key}`,
          counts: { game: g, rail: r, chain: c },
          amounts: {
            game: gameMap.get(key)?.amounts[0] ?? null,
            rail: railMap.get(key)?.amounts[0] ?? null,
            chain: chainMap.get(key)?.amounts[0] ?? null,
          },
          injectionId: inj?.id,
        });
      }
    }

    // Amount mismatch when present once on each needed leg
    if (legsNeeded.every((leg) => (leg === "game" ? g : leg === "rail" ? r : c) === 1)) {
      const amounts: Partial<Record<ReconLeg, number | null>> = {
        game: gameMap.get(key)?.amounts[0] ?? null,
        rail: railMap.get(key)?.amounts[0] ?? null,
        chain: chainMap.get(key)?.amounts[0] ?? null,
      };
      const vals = legsNeeded
        .map((leg) => amounts[leg])
        .filter((v): v is number => typeof v === "number");
      if (vals.length >= 2 && vals.some((v) => v !== vals[0])) {
        diffs.push({
          kind: "amount_mismatch",
          targetKey: key,
          factKind,
          leg: "cross",
          summary: `Amount mismatch for ${key}: game=${amounts.game} rail=${amounts.rail} chain=${amounts.chain}`,
          counts: { game: g, rail: r, chain: c },
          amounts,
        });
      }
    }
  }

  return diffs;
}

function ticketFingerprint(d: ReconDiscrepancy): string {
  return `${d.kind}|${d.leg}|${d.targetKey}`;
}

export function snapshotLegs(operatorId: string): {
  canonical: Record<ReconLeg, ReconFact[]>;
  effective: Record<ReconLeg, ReconFact[]>;
  injections: ReconInjectedAnomaly[];
} {
  const canonical = buildCanonicalLegs(operatorId);
  const effective = applyInjections(operatorId, canonical);
  return {
    canonical,
    effective,
    injections: db.reconInjections.filter((i) => i.operatorId === operatorId),
  };
}

export function injectAnomaly(args: {
  operatorId: string;
  type: ReconInjectType;
  leg: ReconLeg;
  targetKey?: string;
  /** When targetKey omitted, pick first deposit key present on the leg (demo helper). */
  amount?: number;
  note?: string;
  actorId: string;
}): ReconInjectedAnomaly {
  const { effective } = snapshotLegs(args.operatorId);
  let targetKey = args.targetKey;

  if (!targetKey) {
    const pool = effective[args.leg].filter((f) => f.kind === "deposit");
    if (pool.length === 0) {
      throw new ApiError(
        "INVALID_REQUEST",
        `no deposit facts on ${args.leg} to inject against — seed or credit a deposit first`,
      );
    }
    targetKey = pool[0]!.key;
  }

  // For missing, the key should exist on the leg before hide (or on peers for demo).
  // For duplicate, same — need a base fact somewhere.
  const peers = [...effective.game, ...effective.rail, ...effective.chain];
  if (!peers.some((f) => f.key === targetKey) && args.type === "duplicate") {
    throw new ApiError("INVALID_REQUEST", `unknown target_key for duplicate: ${targetKey}`);
  }
  if (args.type === "missing" && !effective[args.leg].some((f) => f.key === targetKey)) {
    // Allow missing-inject only when currently present on that leg
    throw new ApiError(
      "INVALID_REQUEST",
      `target_key ${targetKey} is not present on ${args.leg} — cannot inject missing`,
    );
  }

  const anomaly: ReconInjectedAnomaly = {
    id: ids.reconInject(),
    operatorId: args.operatorId,
    type: args.type,
    leg: args.leg,
    targetKey,
    amount: args.amount,
    note: args.note,
    createdAt: now(),
    createdBy: args.actorId,
  };
  db.reconInjections.push(anomaly);

  appendAuditEvent({
    operatorId: args.operatorId,
    actorType: "admin",
    actorId: args.actorId,
    action: "recon.inject",
    entityType: "recon_injection",
    entityId: anomaly.id,
    payload: {
      type: anomaly.type,
      leg: anomaly.leg,
      target_key: anomaly.targetKey,
      amount: anomaly.amount ?? null,
      note: anomaly.note ?? null,
    },
  });

  return anomaly;
}

export function clearInjections(operatorId: string): number {
  const before = db.reconInjections.length;
  db.reconInjections = db.reconInjections.filter((i) => i.operatorId !== operatorId);
  return before - db.reconInjections.length;
}

export function runReconciliation(args: {
  operatorId: string;
  actorId: string;
  mode?: "dry_run_fixture" | "live";
}): {
  run: ReconRun;
  tickets: ReconTicket[];
  legs: Record<ReconLeg, ReconFact[]>;
} {
  const startedAt = now();
  const mode = args.mode ?? (config.sui.dryRun ? "dry_run_fixture" : "live");
  const { effective } = snapshotLegs(args.operatorId);
  const discrepancies = diffLegs(args.operatorId, effective);

  const runId = ids.reconRun();
  const opened: string[] = [];
  const resolved: string[] = [];

  const openFingerprints = new Set(discrepancies.map(ticketFingerprint));

  // Resolve previously open tickets whose discrepancy disappeared.
  for (const ticket of db.reconTickets.values()) {
    if (ticket.operatorId !== args.operatorId) continue;
    if (ticket.status !== "open") continue;
    const fp = `${ticket.discrepancyKind}|${ticket.leg}|${ticket.targetKey}`;
    if (!openFingerprints.has(fp)) {
      ticket.status = "resolved";
      ticket.resolvedAt = now();
      ticket.resolvedByRunId = runId;
      resolved.push(ticket.id);
      appendAuditEvent({
        operatorId: args.operatorId,
        actorType: "system",
        actorId: args.actorId,
        action: "recon.ticket_resolve",
        entityType: "recon_ticket",
        entityId: ticket.id,
        payload: {
          run_id: runId,
          target_key: ticket.targetKey,
          discrepancy_kind: ticket.discrepancyKind,
        },
      });
    }
  }

  // Open tickets for new discrepancies (dedupe by fingerprint while open).
  const existingOpen = new Map<string, ReconTicket>();
  for (const ticket of db.reconTickets.values()) {
    if (ticket.operatorId !== args.operatorId || ticket.status !== "open") continue;
    existingOpen.set(
      `${ticket.discrepancyKind}|${ticket.leg}|${ticket.targetKey}`,
      ticket,
    );
  }

  const tickets: ReconTicket[] = [];
  for (const d of discrepancies) {
    const fp = ticketFingerprint(d);
    const existing = existingOpen.get(fp);
    if (existing) {
      tickets.push(existing);
      continue;
    }
    const ticket: ReconTicket = {
      id: ids.reconTicket(),
      operatorId: args.operatorId,
      status: "open",
      discrepancyKind: d.kind,
      leg: d.leg,
      targetKey: d.targetKey,
      factKind: d.factKind,
      summary: d.summary,
      details: {
        counts: d.counts ?? null,
        amounts: d.amounts ?? null,
        injection_id: d.injectionId ?? null,
      },
      runId,
      injectionId: d.injectionId,
      createdAt: now(),
    };
    db.reconTickets.set(ticket.id, ticket);
    opened.push(ticket.id);
    tickets.push(ticket);

    appendAuditEvent({
      operatorId: args.operatorId,
      actorType: "system",
      actorId: args.actorId,
      action: "recon.ticket_open",
      entityType: "recon_ticket",
      entityId: ticket.id,
      payload: {
        run_id: runId,
        discrepancy_kind: d.kind,
        leg: d.leg,
        target_key: d.targetKey,
        fact_kind: d.factKind,
        summary: d.summary,
        injection_id: d.injectionId ?? null,
      },
    });
  }

  const diffSummary = {
    missing: discrepancies.filter((d) => d.kind === "missing").length,
    duplicate: discrepancies.filter((d) => d.kind === "duplicate").length,
    amount_mismatch: discrepancies.filter((d) => d.kind === "amount_mismatch").length,
    total: discrepancies.length,
  };

  const run: ReconRun = {
    id: runId,
    operatorId: args.operatorId,
    startedAt,
    finishedAt: now(),
    mode,
    legCounts: {
      game: effective.game.length,
      rail: effective.rail.length,
      chain: effective.chain.length,
    },
    discrepancies,
    ticketsOpened: opened,
    ticketsResolved: resolved,
    diffSummary,
  };
  db.reconRuns.push(run);

  appendAuditEvent({
    operatorId: args.operatorId,
    actorType: "admin",
    actorId: args.actorId,
    action: "recon.run",
    entityType: "recon_run",
    entityId: run.id,
    payload: {
      mode: run.mode,
      leg_counts: run.legCounts,
      diff_summary: run.diffSummary,
      tickets_opened: opened.length,
      tickets_resolved: resolved.length,
      injections_active: db.reconInjections.filter((i) => i.operatorId === args.operatorId)
        .length,
    },
  });

  return { run, tickets, legs: effective };
}

export function listTickets(opts: {
  operatorId: string;
  status?: "open" | "resolved" | "all";
  limit?: number;
}): ReconTicket[] {
  const status = opts.status ?? "all";
  let items = [...db.reconTickets.values()].filter((t) => t.operatorId === opts.operatorId);
  if (status !== "all") items = items.filter((t) => t.status === status);
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return items.slice(0, opts.limit ?? 200);
}

export function listRuns(operatorId: string, limit = 20): ReconRun[] {
  return db.reconRuns
    .filter((r) => r.operatorId === operatorId)
    .slice()
    .reverse()
    .slice(0, limit);
}

export function serializeTicket(t: ReconTicket) {
  return {
    id: t.id,
    operator_id: t.operatorId,
    status: t.status,
    discrepancy_kind: t.discrepancyKind,
    leg: t.leg,
    target_key: t.targetKey,
    fact_kind: t.factKind,
    summary: t.summary,
    details: t.details,
    run_id: t.runId,
    injection_id: t.injectionId ?? null,
    created_at: t.createdAt,
    resolved_at: t.resolvedAt ?? null,
    resolved_by_run_id: t.resolvedByRunId ?? null,
  };
}

export function serializeRun(r: ReconRun) {
  return {
    id: r.id,
    operator_id: r.operatorId,
    started_at: r.startedAt,
    finished_at: r.finishedAt,
    mode: r.mode,
    leg_counts: r.legCounts,
    diff_summary: r.diffSummary,
    discrepancies: r.discrepancies.map((d) => ({
      kind: d.kind,
      target_key: d.targetKey,
      fact_kind: d.factKind,
      leg: d.leg,
      summary: d.summary,
      counts: d.counts ?? null,
      amounts: d.amounts ?? null,
      injection_id: d.injectionId ?? null,
    })),
    tickets_opened: r.ticketsOpened,
    tickets_resolved: r.ticketsResolved,
  };
}

export function serializeInjection(i: ReconInjectedAnomaly) {
  return {
    id: i.id,
    operator_id: i.operatorId,
    type: i.type,
    leg: i.leg,
    target_key: i.targetKey,
    amount: i.amount ?? null,
    note: i.note ?? null,
    created_at: i.createdAt,
    created_by: i.createdBy,
  };
}

export function serializeFact(f: ReconFact) {
  return {
    key: f.key,
    kind: f.kind,
    reference_id: f.referenceId,
    amount: f.amount,
    currency: f.currency,
    player_id: f.playerId ?? null,
    source_id: f.sourceId ?? null,
  };
}
