import type {
  AuditEvent,
  Bet,
  IdempotencyRecord,
  JournalEntry,
  Operator,
  PlayerAccount,
  PlayerPolicyProfile,
  Round,
  Session,
  WebhookEndpoint,
  Withdrawal,
} from "../types.js";

/** In-memory multi-tenant sandbox store. */
export class MemoryStore {
  operators = new Map<string, Operator>();
  operatorsByClientId = new Map<string, Operator>();
  accounts = new Map<string, PlayerAccount>(); // key: operatorId:playerId:currency
  sessions = new Map<string, Session>();
  bets = new Map<string, Bet>();
  rounds = new Map<string, Round>();
  journal: JournalEntry[] = [];
  idempotency = new Map<string, IdempotencyRecord>(); // key: operatorId:route:key
  webhooks = new Map<string, WebhookEndpoint>();
  /** key: operatorId:txId — deposit digests are tenant-scoped */
  depositsSeen = new Set<string>();
  /** key: operatorId:playerId */
  playerPolicies = new Map<string, PlayerPolicyProfile>();
  withdrawals = new Map<string, Withdrawal>();
  /** Append-only — never mutate or delete entries after push. */
  auditEvents: AuditEvent[] = [];

  accountKey(operatorId: string, playerId: string, currency: string): string {
    return `${operatorId}:${playerId}:${currency}`;
  }

  idempotencyKey(operatorId: string, route: string, key: string): string {
    return `${operatorId}:${route}:${key}`;
  }

  policyKey(operatorId: string, playerId: string): string {
    return `${operatorId}:${playerId}`;
  }
}

export const db = new MemoryStore();
