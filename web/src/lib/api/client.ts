import type {
  Balance,
  BetPlaceResponse,
  BetSettleResponse,
  DemoCredentials,
  LaunchSession,
  ProvablyFairState,
  RailErrorBody,
  RoundItem,
} from '../types'
import { uuid } from '../format'

const DEFAULT_BASE = '/v1'

let studioToken: string | null = null

export function apiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_BASE_URL?.trim()
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : DEFAULT_BASE
}

export class RailApiError extends Error {
  code: string
  status: number
  details?: Record<string, unknown>

  constructor(status: number, body: RailErrorBody | null, fallback: string) {
    super(body?.error?.message ?? fallback)
    this.name = 'RailApiError'
    this.status = status
    this.code = body?.error?.code ?? 'UNKNOWN'
    this.details = body?.error?.details
  }
}

async function parseError(res: Response): Promise<RailApiError> {
  let body: RailErrorBody | null = null
  try {
    body = (await res.json()) as RailErrorBody
  } catch {
    body = null
  }
  return new RailApiError(res.status, body, res.statusText || 'Request failed')
}

type RequestOpts = {
  method?: string
  body?: unknown
  token?: string | null
  idempotencyKey?: string
  operatorId?: string
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Rail-Env': 'sandbox',
    'X-Request-Id': uuid(),
  }
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey
  if (opts.operatorId) headers['X-Operator-Id'] = opts.operatorId

  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })

  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  async demoCredentials(): Promise<DemoCredentials> {
    try {
      return await request('/demo/credentials')
    } catch {
      return {
        client_id: 'studio_demo_01',
        client_secret: 'sk_sandbox_demo_secret',
        operator_id: 'op_demo_01',
        player_id: 'player_demo_42',
        scope: 'games:play games:admin',
      }
    }
  },

  async studioAccessToken(creds?: DemoCredentials): Promise<string> {
    if (studioToken) return studioToken
    const c = creds ?? (await this.demoCredentials())
    const res = await request<{ access_token: string }>('/auth/token', {
      method: 'POST',
      body: {
        grant_type: 'client_credentials',
        client_id: c.client_id,
        client_secret: c.client_secret,
        scope: c.scope ?? 'games:play games:admin',
      },
    })
    studioToken = res.access_token
    return studioToken
  },

  async launch(input: {
    player_id: string
    game_id: string
    locale?: string
    return_url?: string
    operator_id?: string
  }): Promise<LaunchSession> {
    const creds = await this.demoCredentials()
    const access = await this.studioAccessToken(creds)
    return request('/sessions/launch', {
      method: 'POST',
      token: access,
      operatorId: input.operator_id ?? creds.operator_id,
      idempotencyKey: uuid(),
      body: {
        player_id: input.player_id,
        game_id: input.game_id,
        currency: 'USD',
        locale: input.locale ?? 'ko',
        return_url: input.return_url ?? window.location.origin,
        wallet_mode: 'seamless',
        meta: { outcome_mode: 'rail_pf', chain: 'sui-testnet', asset: 'USDC' },
      },
    })
  },

  balance(sessionId: string, token: string): Promise<Balance & { session_id: string }> {
    return request(`/sessions/${sessionId}/balance`, { token })
  },

  placeBet(
    sessionId: string,
    token: string,
    body: {
      game_id: string
      round_id: string
      amount: number
      bet_type: string
      client_seed: string
      nonce: number
      payload: Record<string, unknown>
    },
    idempotencyKey: string,
  ): Promise<BetPlaceResponse> {
    return request(`/sessions/${sessionId}/bets`, {
      method: 'POST',
      token,
      idempotencyKey,
      body: { ...body, currency: 'USD' },
    })
  },

  settleBet(
    sessionId: string,
    token: string,
    betId: string,
    body: {
      payout: number
      outcome: Record<string, unknown>
      provably_fair?: Record<string, unknown>
    },
    idempotencyKey: string,
  ): Promise<BetSettleResponse> {
    return request(`/sessions/${sessionId}/bets/${betId}/settle`, {
      method: 'POST',
      token,
      idempotencyKey,
      body,
    })
  },

  cancelBet(
    sessionId: string,
    token: string,
    betId: string,
    reason: string,
    idempotencyKey: string,
  ): Promise<unknown> {
    return request(`/sessions/${sessionId}/bets/${betId}/cancel`, {
      method: 'POST',
      token,
      idempotencyKey,
      body: { reason },
    })
  },

  rounds(sessionId: string, token: string): Promise<{ items: RoundItem[]; next_cursor: null }> {
    return request(`/sessions/${sessionId}/rounds?limit=20`, { token })
  },

  fairness(sessionId: string, token: string): Promise<ProvablyFairState> {
    return request(`/sessions/${sessionId}/fairness`, { token })
  },

  setClientSeed(sessionId: string, token: string, client_seed: string): Promise<ProvablyFairState> {
    return request(`/sessions/${sessionId}/fairness/client-seed`, {
      method: 'POST',
      token,
      idempotencyKey: uuid(),
      body: { client_seed },
    })
  },

  rotateFairness(sessionId: string, token: string): Promise<ProvablyFairState> {
    return request(`/sessions/${sessionId}/fairness/rotate`, {
      method: 'POST',
      token,
      idempotencyKey: uuid(),
      body: {},
    })
  },

  /** Sandbox Sui USDC credit — prefers real API deposit stub, falls back to session mock. */
  async mockDeposit(
    sessionId: string,
    token: string,
    amount: number,
    playerId: string,
  ): Promise<Balance & { session_id: string }> {
    try {
      const creds = await this.demoCredentials()
      const access = await this.studioAccessToken(creds)
      await request('/deposits/usdc', {
        method: 'POST',
        token: access,
        operatorId: creds.operator_id,
        idempotencyKey: uuid(),
        body: {
          player_id: playerId,
          amount,
          chain: 'sui-testnet',
          asset: 'USDC',
          tx_id: `mock_tx_${uuid()}`,
          mock: true,
        },
      })
      return this.balance(sessionId, token)
    } catch {
      return request(`/sessions/${sessionId}/wallet/deposit`, {
        method: 'POST',
        token,
        idempotencyKey: uuid(),
        body: { amount, currency: 'USD', chain: 'sui-testnet', mock: true },
      })
    }
  },
}
