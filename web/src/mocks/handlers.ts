import { http, HttpResponse, type HttpHandler } from 'msw'
import { errorJson, ledger } from './ledger'

const bases = ['/v1', 'https://sandbox-api.casino-rail.demo/v1']

function onEach(suffix: string, build: (url: string) => HttpHandler): HttpHandler[] {
  return bases.map((b) => build(`${b}${suffix}`))
}

function auth(req: Request) {
  return req.headers.get('Authorization')
}

function idem(req: Request) {
  return req.headers.get('Idempotency-Key')
}

function railEnv(req: Request) {
  return req.headers.get('X-Rail-Env') ?? 'sandbox'
}

function guardEnv(req: Request) {
  if (railEnv(req) !== 'sandbox') {
    const err = errorJson(403, 'ENV_MISMATCH', 'demo only accepts sandbox')
    return HttpResponse.json(err.body, { status: err.status })
  }
  return null
}

function fromThrown(e: unknown) {
  const err = e as {
    status?: number
    code?: string
    message?: string
    details?: Record<string, unknown>
  }
  const mapped = errorJson(
    err.status ?? 500,
    err.code ?? 'INTERNAL_ERROR',
    err.message ?? 'internal error',
    err.details,
  )
  return HttpResponse.json(mapped.body, { status: mapped.status })
}

export const handlers: HttpHandler[] = [
  ...onEach('/demo/credentials', (url) =>
    http.get(url, ({ request }) => {
      const blocked = guardEnv(request)
      if (blocked) return blocked
      return HttpResponse.json({
        client_id: 'studio_demo_01',
        client_secret: 'sk_sandbox_demo_secret',
        operator_id: 'op_demo_01',
        player_id: 'player_demo_42',
        scope: 'games:play games:admin',
      })
    }),
  ),

  ...onEach('/auth/token', (url) =>
    http.post(url, async ({ request }) => {
      const blocked = guardEnv(request)
      if (blocked) return blocked
      const body = (await request.json()) as { client_id?: string }
      return HttpResponse.json({
        access_token: `access_${body.client_id ?? 'demo'}`,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'games:play games:admin',
      })
    }),
  ),

  ...onEach('/sessions/launch', (url) =>
    http.post(url, async ({ request }) => {
      const blocked = guardEnv(request)
      if (blocked) return blocked
      const body = (await request.json()) as { player_id: string; game_id: string }
      const session = await ledger.launch(body)
      return HttpResponse.json(session, { status: 201 })
    }),
  ),

  ...onEach('/deposits/usdc', (url) =>
    http.post(url, async ({ request }) => {
      const blocked = guardEnv(request)
      if (blocked) return blocked
      const body = (await request.json()) as { amount: number; player_id: string; tx_id: string }
      // Credit against the most recent session for this player (demo simplification).
      const sessions = [...ledger.sessions.values()].filter((s) => s.player_id === body.player_id)
      const state = sessions.at(-1)
      if (!state) {
        return fromThrown({
          status: 404,
          code: 'SESSION_NOT_FOUND',
          message: 'no session for player',
        })
      }
      const bal = ledger.deposit(state, body.amount)
      return HttpResponse.json(
        {
          credited: true,
          replay: false,
          chain: 'sui-testnet',
          asset: 'USDC',
          tx_id: body.tx_id,
          player_id: body.player_id,
          amount: body.amount,
          currency: 'USD',
          minor_unit: 2,
          balance: bal,
          note: 'Stub credit only — operator self-custody; no Rail sole-sign withdrawals.',
        },
        { status: 201 },
      )
    }),
  ),

  ...onEach('/sessions/:sessionId/balance', (url) =>
    http.get(url, ({ request, params }) => {
      const blocked = guardEnv(request)
      if (blocked) return blocked
      try {
        const state = ledger.requireSession(String(params.sessionId), auth(request))
        return HttpResponse.json(ledger.balance(state))
      } catch (e) {
        return fromThrown(e)
      }
    }),
  ),

  ...onEach('/sessions/:sessionId/bets', (url) =>
    http.post(url, async ({ request, params }) => {
      const blocked = guardEnv(request)
      if (blocked) return blocked
      try {
        const state = ledger.requireSession(String(params.sessionId), auth(request))
        const body = await request.json()
        const result = await ledger.placeBet(state, idem(request), body as never)
        return HttpResponse.json(result, { status: 201 })
      } catch (e) {
        return fromThrown(e)
      }
    }),
  ),

  ...onEach('/sessions/:sessionId/bets/:betId/settle', (url) =>
    http.post(url, async ({ request, params }) => {
      const blocked = guardEnv(request)
      if (blocked) return blocked
      try {
        const state = ledger.requireSession(String(params.sessionId), auth(request))
        const body = await request.json()
        const result = ledger.settle(state, String(params.betId), idem(request), body as never)
        return HttpResponse.json(result)
      } catch (e) {
        return fromThrown(e)
      }
    }),
  ),

  ...onEach('/sessions/:sessionId/bets/:betId/cancel', (url) =>
    http.post(url, async ({ request, params }) => {
      const blocked = guardEnv(request)
      if (blocked) return blocked
      try {
        const state = ledger.requireSession(String(params.sessionId), auth(request))
        const result = ledger.cancel(state, String(params.betId), idem(request))
        return HttpResponse.json(result)
      } catch (e) {
        return fromThrown(e)
      }
    }),
  ),

  ...onEach('/sessions/:sessionId/rounds', (url) =>
    http.get(url, ({ request, params }) => {
      const blocked = guardEnv(request)
      if (blocked) return blocked
      try {
        const state = ledger.requireSession(String(params.sessionId), auth(request))
        return HttpResponse.json(ledger.rounds(state))
      } catch (e) {
        return fromThrown(e)
      }
    }),
  ),

  ...onEach('/sessions/:sessionId/fairness', (url) =>
    http.get(url, ({ request, params }) => {
      const blocked = guardEnv(request)
      if (blocked) return blocked
      try {
        const state = ledger.requireSession(String(params.sessionId), auth(request))
        return HttpResponse.json(ledger.fairness(state))
      } catch (e) {
        return fromThrown(e)
      }
    }),
  ),

  ...onEach('/sessions/:sessionId/fairness/client-seed', (url) =>
    http.post(url, async ({ request, params }) => {
      const blocked = guardEnv(request)
      if (blocked) return blocked
      try {
        const state = ledger.requireSession(String(params.sessionId), auth(request))
        const body = (await request.json()) as { client_seed: string }
        const result = await ledger.setClientSeed(state, body.client_seed)
        return HttpResponse.json(result)
      } catch (e) {
        return fromThrown(e)
      }
    }),
  ),

  ...onEach('/sessions/:sessionId/fairness/rotate', (url) =>
    http.post(url, async ({ request, params }) => {
      const blocked = guardEnv(request)
      if (blocked) return blocked
      try {
        const state = ledger.requireSession(String(params.sessionId), auth(request))
        const result = await ledger.rotate(state)
        return HttpResponse.json(result)
      } catch (e) {
        return fromThrown(e)
      }
    }),
  ),

  ...onEach('/sessions/:sessionId/wallet/deposit', (url) =>
    http.post(url, async ({ request, params }) => {
      const blocked = guardEnv(request)
      if (blocked) return blocked
      try {
        const state = ledger.requireSession(String(params.sessionId), auth(request))
        const body = (await request.json()) as { amount: number }
        return HttpResponse.json(ledger.deposit(state, body.amount))
      } catch (e) {
        return fromThrown(e)
      }
    }),
  ),
]
