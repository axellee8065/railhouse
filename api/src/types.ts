export type RailEnv = "sandbox" | "production";

export type BetStatus = "reserved" | "settled" | "cancelled";
export type RoundStatus = "open" | "closed";
export type SessionStatus = "open" | "closed" | "expired";
export type OutcomeMode = "studio" | "rail_pf";

/** KYC stub statuses — anything other than `clear` fails closed for withdrawals. */
export type KycStubStatus = "none" | "pending" | "clear" | "review" | "reject" | "expired";

export type WithdrawalStatus =
  | "pending_approval"
  | "approved"
  | "rejected"
  | "policy_denied";

export type AuditAction =
  | "withdraw.request"
  | "withdraw.policy_deny"
  | "withdraw.approve"
  | "withdraw.reject"
  | "policy.update"
  | "deposit.credit"
  | "bet.reserve"
  | "bet.settle"
  | "tenant.isolation_deny"
  | "recon.run"
  | "recon.inject"
  | "recon.ticket_open"
  | "recon.ticket_resolve";

/** Three legs of PoC reconciliation (game meta ↔ Rail journal ↔ chain/fixture). */
export type ReconLeg = "game" | "rail" | "chain";

export type ReconFactKind = "deposit" | "bet";

export type ReconDiscrepancyKind = "missing" | "duplicate" | "amount_mismatch";

export type ReconTicketStatus = "open" | "resolved";

export type ReconInjectType = "missing" | "duplicate";

/** Canonical fact key used across legs, e.g. `deposit:tx_001` or `bet:bet_abc`. */
export interface ReconFact {
  key: string;
  kind: ReconFactKind;
  referenceId: string;
  amount: number;
  currency: string;
  playerId?: string;
  sourceId?: string;
}

export interface ReconInjectedAnomaly {
  id: string;
  operatorId: string;
  type: ReconInjectType;
  /** Leg the anomaly is applied to (hide or duplicate on this side). */
  leg: ReconLeg;
  targetKey: string;
  amount?: number;
  note?: string;
  createdAt: string;
  createdBy: string;
}

export interface ReconDiscrepancy {
  kind: ReconDiscrepancyKind;
  targetKey: string;
  factKind: ReconFactKind;
  /** Primary leg implicated (missing-from / duplicate-on / mismatch). */
  leg: ReconLeg | "cross";
  summary: string;
  amounts?: Partial<Record<ReconLeg, number | null>>;
  counts?: Partial<Record<ReconLeg, number>>;
  injectionId?: string;
}

export interface ReconTicket {
  id: string;
  operatorId: string;
  status: ReconTicketStatus;
  discrepancyKind: ReconDiscrepancyKind;
  leg: ReconLeg | "cross";
  targetKey: string;
  factKind: ReconFactKind;
  summary: string;
  details: Record<string, unknown>;
  runId: string;
  injectionId?: string;
  createdAt: string;
  resolvedAt?: string;
  resolvedByRunId?: string;
}

export interface ReconRun {
  id: string;
  operatorId: string;
  startedAt: string;
  finishedAt: string;
  mode: "dry_run_fixture" | "live";
  legCounts: { game: number; rail: number; chain: number };
  discrepancies: ReconDiscrepancy[];
  ticketsOpened: string[];
  ticketsResolved: string[];
  diffSummary: {
    missing: number;
    duplicate: number;
    amount_mismatch: number;
    total: number;
  };
}

export interface Operator {
  id: string;
  code: string;
  clientId: string;
  clientSecret: string;
  scope: string;
}

export interface PlayerAccount {
  operatorId: string;
  playerId: string;
  currency: string;
  available: number;
  reserved: number;
  minorUnit: number;
  updatedAt: string;
}

export interface JournalLine {
  account: string;
  direction: "debit" | "credit";
  amount: number;
  currency: string;
}

export interface JournalEntry {
  entryId: string;
  operatorId: string;
  entryType:
    | "deposit_credit"
    | "bet_reserve"
    | "bet_settle"
    | "bet_void"
    | "withdraw_reserve"
    | "withdraw_release"
    | "adjustment";
  idempotencyKey: string;
  referenceType: string;
  referenceId: string;
  postedAt: string;
  lines: JournalLine[];
}

export interface FairnessState {
  algorithm: "hmac-sha256";
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nextNonce: number;
  rotatedAt: string | null;
  previousServerSeed: string | null;
}

export interface Session {
  sessionId: string;
  operatorId: string;
  playerId: string;
  gameId: string;
  currency: string;
  locale?: string;
  returnUrl?: string;
  walletMode: "seamless";
  status: SessionStatus;
  outcomeMode: OutcomeMode;
  meta: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  closedAt?: string;
  launchTokenJti: string;
  launchTokenBound: boolean;
  launchTokenExpiresAt: string;
  fairness: FairnessState;
  env: RailEnv;
}

export interface Bet {
  betId: string;
  sessionId: string;
  operatorId: string;
  playerId: string;
  gameId: string;
  roundId: string;
  status: BetStatus;
  amount: number;
  currency: string;
  betType?: string;
  payload?: Record<string, unknown>;
  reservationId: string;
  payout?: number;
  profit?: number;
  outcome?: Record<string, unknown>;
  outcomePreview?: Record<string, unknown>;
  provablyFair?: {
    server_seed_hash: string;
    client_seed: string;
    nonce: number;
    cursor: number;
    digest_hex?: string;
    algorithm?: string;
  };
  ledger?: {
    debit_entry_id?: string;
    credit_entry_id?: string;
    reserve_entry_id?: string;
    settle_entry_id?: string;
    void_entry_id?: string;
  };
  createdAt: string;
  settledAt?: string;
  cancelledAt?: string;
  placeIdempotencyKey: string;
  settleIdempotencyKey?: string;
  cancelIdempotencyKey?: string;
}

export interface Round {
  roundId: string;
  sessionId: string;
  operatorId: string;
  gameId: string;
  status: RoundStatus;
  betIds: string[];
  provablyFair?: Bet["provablyFair"];
  createdAt: string;
  settledAt?: string;
}

export interface IdempotencyRecord {
  key: string;
  operatorId: string;
  route: string;
  requestHash: string;
  statusCode: number;
  body: unknown;
  createdAt: string;
}

export interface WebhookEndpoint {
  endpointId: string;
  operatorId: string;
  url: string;
  secret: string;
  events: string[];
  createdAt: string;
}

export interface AccessTokenClaims {
  typ: "access";
  sub: string;
  operator_id: string;
  client_id: string;
  scope: string;
  env: RailEnv;
}

export interface LaunchTokenClaims {
  typ: "launch";
  sub: string;
  operator_id: string;
  session_id: string;
  player_id: string;
  jti: string;
  env: RailEnv;
}

export type AuthContext =
  | { kind: "access"; claims: AccessTokenClaims; token: string }
  | { kind: "launch"; claims: LaunchTokenClaims; token: string };

/** Per-player policy profile used by fail-closed withdrawal gates. */
export interface PlayerPolicyProfile {
  operatorId: string;
  playerId: string;
  /** Missing / unset treated as fail-closed by policy service. */
  kycStatus: KycStubStatus | null;
  /** Daily withdraw limit in ledger minor units. null = missing → deny. */
  rgDailyLimitMinor: number | null;
  /** Weekly withdraw limit in ledger minor units. null = missing → deny. */
  rgWeeklyLimitMinor: number | null;
  selfExcluded: boolean;
  withdrawnTodayMinor: number;
  withdrawnThisWeekMinor: number;
  updatedAt: string;
}

/**
 * Unsigned payout intent for the operator signer.
 * Rail never loads private keys or broadcasts — JSON only.
 */
export interface UnsignedPayoutIntent {
  intent_id: string;
  withdrawal_id: string;
  operator_id: string;
  player_id: string;
  to_address: string;
  amount: number;
  currency: string;
  asset: "USDC";
  chain: "sui-testnet";
  usdc_coin_type: string;
  usdc_decimals: number;
  ledger_minor_unit: number;
  /** Explicit: Rail does not sign or broadcast. */
  signing: "operator_self_custody";
  signed: false;
  broadcast: false;
  created_at: string;
}

export interface Withdrawal {
  id: string;
  operatorId: string;
  playerId: string;
  amount: number;
  currency: string;
  asset: "USDC";
  chain: "sui-testnet";
  toAddress: string;
  status: WithdrawalStatus;
  idempotencyKey: string;
  policySnapshot: Record<string, unknown>;
  failReason?: string;
  failCodes?: string[];
  reserveEntryId?: string;
  releaseEntryId?: string;
  unsignedPayoutIntent?: UnsignedPayoutIntent;
  requestedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionNote?: string;
}

export interface AuditEvent {
  id: string;
  operatorId: string;
  actorType: "player" | "admin" | "system";
  actorId: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
