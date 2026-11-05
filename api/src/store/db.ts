import type {
  Bet,
  IdempotencyRecord,
  JournalEntry,
  Operator,
  PlayerAccount,
  Round,
  Session,
  WebhookEndpoint,
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
  depositsSeen = new Set<string>(); // chain tx ids

  accountKey(operatorId: string, playerId: string, currency: string): string {
    return `${operatorId}:${playerId}:${currency}`;
  }

  idempotencyKey(operatorId: string, route: string, key: string): string {
    return `${operatorId}:${route}:${key}`;
  }
}

export const db = new MemoryStore();
