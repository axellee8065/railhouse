import { calcMultiplier, computePayout, rollFromDigest, sha256Hex } from '../lib/fairness'
import type {
  Balance,
  BetPlaceResponse,
  BetSettleResponse,
  LaunchSession,
  ProvablyFairState,
  RoundItem,
} from '../lib/types'

const MINOR = 2
const DEFAULT_AVAILABLE = 100_000 // $1,000.00 USDC sandbox (USD minor units)

type BetRecord = {
  bet_id: string
  round_id: string
  game_id: string
  amount: number
  status: 'reserved' | 'settled' | 'cancelled'
  payout?: number
  placeKey: string
  settleKey?: string
  placeBodyHash: string
  outcome?: BetPlaceResponse['outcome_preview']
  created_at: string
  settled_at?: string
}

type SessionState = {
  session_id: string
  player_id: string
  game_id: string
  launch_token: string
  balance: Balance
  server_seed: string
  server_seed_hash: string
  client_seed: string
  next_nonce: number
  previous_server_seed: string | null
  previous_server_seed_hash: string | null
  rotated_at: string | null
  bets: Map<string, BetRecord>
  idempotency: Map<string, unknown>
  closed: boolean
}

function nowIso() {
  return new Date().toISOString()
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
}

async function hashSeed(seed: string) {
  return sha256Hex(seed)
}

async function makeDigest(serverSeed: string, clientSeed: string, nonce: number, cursor = 0) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(serverSeed),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const msg = `${clientSeed}:${nonce}:${cursor}`
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function bodyHash(value: unknown) {
  return JSON.stringify(value)
}

class MockLedger {
  sessions = new Map<string, SessionState>()
  tokens = new Map<string, string>()

  async launch(input: {
    player_id: string
    game_id: string
  }): Promise<LaunchSession> {
    const server_seed = `seed_${crypto.randomUUID()}`
    const server_seed_hash = await hashSeed(server_seed)
    const session_id = id('sess')
    const launch_token = `launch_${crypto.randomUUID()}`
    const client_seed = `client_${input.player_id}`

    const balance: Balance = {
      currency: 'USD',
      available: DEFAULT_AVAILABLE,
      reserved: 0,
      total: DEFAULT_AVAILABLE,
      minor_unit: MINOR,
      asset: 'USDC',
      updated_at: nowIso(),
    }

    const state: SessionState = {
      session_id,
      player_id: input.player_id,
      game_id: input.game_id,
      launch_token,
      balance,
      server_seed,
      server_seed_hash,
      client_seed,
      next_nonce: 0,
      previous_server_seed: null,
      previous_server_seed_hash: null,
      rotated_at: null,
      bets: new Map(),
      idempotency: new Map(),
      closed: false,
    }
    this.sessions.set(session_id, state)
    this.tokens.set(launch_token, session_id)

    return {
      session_id,
      launch_token,
      launch_token_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      game_url: `https://games.railhouse.demo/${input.game_id}?token=${launch_token}`,
      balance,
      provably_fair: {
        server_seed_hash,
        nonce: 0,
        algorithm: 'hmac-sha256',
      },
      env: 'sandbox',
    }
  }

  requireSession(sessionId: string, authHeader: string | null): SessionState {
    const state = this.sessions.get(sessionId)
    if (!state || state.closed) {
      throw { status: 404, code: 'SESSION_NOT_FOUND', message: 'session not found' }
    }
    const token = authHeader?.replace(/^Bearer\s+/i, '') ?? ''
    if (!token || (token !== state.launch_token && !token.startsWith('access_'))) {
      throw { status: 401, code: 'AUTH_REQUIRED', message: 'invalid or missing token' }
    }
    return state
  }

  balance(state: SessionState) {
    return {
      session_id: state.session_id,
      currency: state.balance.currency,
      available: state.balance.available,
      reserved: state.balance.reserved,
      total: state.balance.available + state.balance.reserved,
      minor_unit: state.balance.minor_unit,
      updated_at: state.balance.updated_at ?? nowIso(),
    }
  }

  async placeBet(
    state: SessionState,
    idemKey: string | null,
    body: {
      game_id: string
      round_id: string
      amount: number
      currency: string
      bet_type: string
      client_seed: string
      nonce: number
      payload: { target: number; condition: 'over' | 'under' }
    },
  ): Promise<BetPlaceResponse> {
    if (!idemKey) {
      throw { status: 400, code: 'INVALID_REQUEST', message: 'Idempotency-Key required' }
    }
    const existing = state.idempotency.get(`place:${idemKey}`) as BetPlaceResponse | undefined
    if (existing) {
      if (existing.round_id !== body.round_id || existing.amount !== body.amount) {
        throw { status: 409, code: 'IDEMPOTENCY_KEY_CONFLICT', message: 'key reused with different body' }
      }
      return { ...existing, idempotency_replay: true }
    }

    if (!Number.isInteger(body.amount) || body.amount <= 0) {
      throw { status: 400, code: 'INVALID_AMOUNT', message: 'amount must be positive integer' }
    }
    if (body.currency !== 'USD') {
      throw { status: 422, code: 'CURRENCY_MISMATCH', message: 'sandbox USD (USDC display) only' }
    }
    if (state.balance.available < body.amount) {
      throw {
        status: 409,
        code: 'INSUFFICIENT_FUNDS',
        message: 'available balance is less than bet amount',
        details: { available: state.balance.available, requested: body.amount },
      }
    }

    state.balance.available -= body.amount
    state.balance.reserved += body.amount
    state.balance.updated_at = nowIso()
    state.client_seed = body.client_seed || state.client_seed

    const nonce = state.next_nonce
    state.next_nonce += 1
    const digest_hex = await makeDigest(state.server_seed, state.client_seed, nonce, 0)
    const roll = Number(rollFromDigest(digest_hex).toFixed(2))
    const { target, condition } = body.payload
    const won = condition === 'over' ? roll > target : roll < target
    const multiplier = calcMultiplier(target, condition)
    const payout = computePayout(body.amount, multiplier, won)

    const bet_id = id('bet')
    const outcome = { roll, won, multiplier, payout, digest_hex, nonce }
    const response: BetPlaceResponse = {
      bet_id,
      round_id: body.round_id,
      status: 'reserved',
      amount: body.amount,
      currency: 'USD',
      reservation_id: id('rsv'),
      balance_after: {
        available: state.balance.available,
        reserved: state.balance.reserved,
        minor_unit: MINOR,
      },
      provably_fair: {
        server_seed_hash: state.server_seed_hash,
        client_seed: state.client_seed,
        nonce,
        cursor: 0,
      },
      outcome_preview: outcome,
      created_at: nowIso(),
      idempotency_replay: false,
    }

    state.bets.set(bet_id, {
      bet_id,
      round_id: body.round_id,
      game_id: body.game_id,
      amount: body.amount,
      status: 'reserved',
      placeKey: idemKey,
      placeBodyHash: bodyHash(body),
      outcome,
      created_at: response.created_at,
    })
    state.idempotency.set(`place:${idemKey}`, response)
    return response
  }

  settle(
    state: SessionState,
    betId: string,
    idemKey: string | null,
    body: { payout: number; outcome: Record<string, unknown> },
  ): BetSettleResponse {
    if (!idemKey) {
      throw { status: 400, code: 'INVALID_REQUEST', message: 'Idempotency-Key required' }
    }
    const existing = state.idempotency.get(`settle:${idemKey}`) as BetSettleResponse | undefined
    if (existing) return { ...existing, idempotency_replay: true }

    const bet = state.bets.get(betId)
    if (!bet) throw { status: 404, code: 'BET_NOT_FOUND', message: 'bet not found' }
    if (bet.status === 'settled') {
      throw { status: 409, code: 'BET_ALREADY_SETTLED', message: 'bet already settled' }
    }
    if (bet.status !== 'reserved') {
      throw { status: 409, code: 'BET_NOT_RESERVED', message: 'bet not reserved' }
    }

    const payout = bet.outcome?.payout ?? body.payout
    state.balance.reserved -= bet.amount
    state.balance.available += payout
    state.balance.updated_at = nowIso()
    bet.status = 'settled'
    bet.payout = payout
    bet.settled_at = nowIso()
    bet.settleKey = idemKey

    const response: BetSettleResponse = {
      bet_id: bet.bet_id,
      round_id: bet.round_id,
      status: 'settled',
      amount: bet.amount,
      payout,
      profit: payout - bet.amount,
      currency: 'USD',
      balance_after: {
        available: state.balance.available,
        reserved: state.balance.reserved,
        minor_unit: MINOR,
      },
      settled_at: bet.settled_at,
      idempotency_replay: false,
    }
    state.idempotency.set(`settle:${idemKey}`, response)
    return response
  }

  cancel(state: SessionState, betId: string, idemKey: string | null) {
    if (!idemKey) {
      throw { status: 400, code: 'INVALID_REQUEST', message: 'Idempotency-Key required' }
    }
    const bet = state.bets.get(betId)
    if (!bet) throw { status: 404, code: 'BET_NOT_FOUND', message: 'bet not found' }
    if (bet.status === 'settled') {
      throw { status: 409, code: 'BET_NOT_CANCELLABLE', message: 'settled bets cannot cancel' }
    }
    if (bet.status === 'cancelled') {
      return {
        bet_id: bet.bet_id,
        status: 'cancelled',
        balance_after: {
          available: state.balance.available,
          reserved: state.balance.reserved,
          minor_unit: MINOR,
        },
        cancelled_at: bet.settled_at ?? nowIso(),
      }
    }
    state.balance.reserved -= bet.amount
    state.balance.available += bet.amount
    state.balance.updated_at = nowIso()
    bet.status = 'cancelled'
    bet.settled_at = nowIso()
    return {
      bet_id: bet.bet_id,
      status: 'cancelled',
      balance_after: {
        available: state.balance.available,
        reserved: state.balance.reserved,
        minor_unit: MINOR,
      },
      cancelled_at: bet.settled_at,
    }
  }

  rounds(state: SessionState): { items: RoundItem[]; next_cursor: null } {
    const items = [...state.bets.values()]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .map((bet) => ({
        round_id: bet.round_id,
        game_id: bet.game_id,
        status: bet.status === 'reserved' ? 'open' : 'closed',
        bets: [
          {
            bet_id: bet.bet_id,
            amount: bet.amount,
            payout: bet.payout ?? 0,
            status: bet.status,
          },
        ],
        created_at: bet.created_at,
        settled_at: bet.settled_at,
      }))
    return { items, next_cursor: null }
  }

  fairness(state: SessionState): ProvablyFairState {
    return {
      algorithm: 'hmac-sha256',
      server_seed_hash: state.server_seed_hash,
      client_seed: state.client_seed,
      next_nonce: state.next_nonce,
      rotated_at: state.rotated_at,
      previous_server_seed: state.previous_server_seed,
      previous_server_seed_hash: state.previous_server_seed_hash,
    }
  }

  async setClientSeed(state: SessionState, client_seed: string) {
    const inFlight = [...state.bets.values()].some((b) => b.status === 'reserved')
    if (inFlight) {
      throw { status: 409, code: 'BET_IN_FLIGHT', message: 'active reserved bet' }
    }
    state.client_seed = client_seed
    return this.fairness(state)
  }

  async rotate(state: SessionState) {
    const inFlight = [...state.bets.values()].some((b) => b.status === 'reserved')
    if (inFlight) {
      throw { status: 409, code: 'BET_IN_FLIGHT', message: 'active reserved bet' }
    }
    state.previous_server_seed = state.server_seed
    state.previous_server_seed_hash = state.server_seed_hash
    state.server_seed = `seed_${crypto.randomUUID()}`
    state.server_seed_hash = await hashSeed(state.server_seed)
    state.next_nonce = 0
    state.rotated_at = nowIso()
    return {
      ...this.fairness(state),
      new_server_seed_hash: state.server_seed_hash,
    }
  }

  deposit(state: SessionState, amount: number) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw { status: 400, code: 'INVALID_AMOUNT', message: 'amount must be positive integer' }
    }
    state.balance.available += amount
    state.balance.total = state.balance.available + state.balance.reserved
    state.balance.updated_at = nowIso()
    return this.balance(state)
  }
}

export const ledger = new MockLedger()

export function errorJson(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return {
    status,
    body: {
      error: {
        code,
        message,
        request_id: id('req'),
        details,
      },
    },
  }
}
