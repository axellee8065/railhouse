import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
import { api, RailApiError } from '../lib/api/client'
import { formatUsdc, toMinor, uuid } from '../lib/format'

type Side = 'heads' | 'tails'

const PAYOUT_MULT = ((1 - 0.01) / 0.5).toFixed(4)

export function CoinFlip() {
  const { session, balance, applyBalance, ensureSession } = useSession()
  const [stake, setStake] = useState('10')
  const [side, setSide] = useState<Side>('heads')
  const [busy, setBusy] = useState(false)
  const [flipping, setFlipping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [last, setLast] = useState<{
    side: Side
    landed: Side
    won: boolean
    payout: number
    profit: number
    multiplier: string
  } | null>(null)

  const amountMinor = toMinor(Number(stake) || 0, balance?.minor_unit ?? 2)

  async function play() {
    setError(null)
    setBusy(true)
    setFlipping(true)
    try {
      const sess = session ?? (await ensureSession('coin_flip'))
      const placeKey = uuid()
      const settleKey = uuid()
      const placed = await api.placeBet(
        sess.session_id,
        sess.launch_token,
        {
          game_id: 'coin_flip',
          round_id: `flip_${Date.now()}`,
          amount: amountMinor,
          bet_type: `call_${side}`,
          client_seed: sess.provably_fair
            ? `client_${sess.session_id.slice(-6)}`
            : 'client_demo',
          payload: { side },
        },
        placeKey,
      )
      applyBalance(placed.balance_after)

      const preview = placed.outcome_preview
      const payout = preview?.payout ?? 0
      const outcome = {
        side: (preview?.side as Side) ?? side,
        landed: (preview?.landed as Side) ?? side,
        roll: Number(preview?.roll ?? 0),
        won: Boolean(preview?.won),
        multiplier: String(preview?.multiplier ?? '0'),
      }

      const settled = await api.settleBet(
        sess.session_id,
        sess.launch_token,
        placed.bet_id,
        {
          payout,
          outcome,
          provably_fair: preview
            ? { cursor: 0, digest_hex: preview.digest_hex }
            : undefined,
        },
        settleKey,
      )
      applyBalance(settled.balance_after)
      setLast({
        side: outcome.side,
        landed: outcome.landed,
        won: outcome.won,
        payout: settled.payout,
        profit: settled.profit,
        multiplier: outcome.multiplier,
      })
    } catch (e) {
      if (e instanceof RailApiError) setError(`${e.code}: ${e.message}`)
      else setError(e instanceof Error ? e.message : 'Bet failed')
    } finally {
      setBusy(false)
      window.setTimeout(() => setFlipping(false), 650)
    }
  }

  return (
    <section className="section" aria-labelledby="flip-title">
      <h2 id="flip-title">Twin Face</h2>
      <p>
        Call heads or tails. Same Provably Fair HMAC path as Hello Dice — place and
        settle with Idempotency-Key on the rail.
      </p>

      <div className="flip-stage" aria-live="polite">
        <div className={`flip-coin ${flipping ? 'flipping' : ''} ${last?.landed ?? ''}`}>
          <span>{last ? (last.landed === 'heads' ? 'H' : 'T') : '?'}</span>
        </div>
      </div>

      <div className="panel stack">
        <div className="metric-row">
          <div className="metric">
            <span>Multiplier</span>
            <strong>{PAYOUT_MULT}×</strong>
          </div>
          <div className="metric">
            <span>Available</span>
            <strong>
              {balance
                ? `${formatUsdc(balance.available, balance.minor_unit)} USDC`
                : '—'}
            </strong>
          </div>
        </div>

        <div className="field">
          <label htmlFor="flip-stake">Stake (USDC)</label>
          <input
            id="flip-stake"
            type="number"
            min="0.01"
            step="0.01"
            value={stake}
            onChange={(e) => setStake(e.target.value)}
          />
        </div>

        <div className="field">
          <span id="flip-side-label">Call</span>
          <div className="side-toggle" role="group" aria-labelledby="flip-side-label">
            <button
              type="button"
              className={`side-btn ${side === 'heads' ? 'active' : ''}`}
              onClick={() => setSide('heads')}
            >
              Heads
            </button>
            <button
              type="button"
              className={`side-btn ${side === 'tails' ? 'active' : ''}`}
              onClick={() => setSide('tails')}
            >
              Tails
            </button>
          </div>
        </div>

        <div className="cta-row">
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy || amountMinor < 1}
            onClick={play}
          >
            {busy ? 'Settling…' : 'Place bet'}
          </button>
          <Link className="btn btn-ghost" to="/fairness">
            Verify seeds
          </Link>
        </div>

        {error ? <p className="alert">{error}</p> : null}
        {last ? (
          <p className={last.won ? 'ok-note result-win' : 'alert result-lose'}>
            Called {last.side} · landed {last.landed} · {last.won ? 'Win' : 'Lose'} ·
            payout {formatUsdc(last.payout, balance?.minor_unit ?? 2)} USDC · profit{' '}
            {formatUsdc(last.profit, balance?.minor_unit ?? 2)}
          </p>
        ) : null}
      </div>
    </section>
  )
}
