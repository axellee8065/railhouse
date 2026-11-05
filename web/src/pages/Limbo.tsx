import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
import { api, RailApiError } from '../lib/api/client'
import { formatUsdc, toMinor, uuid } from '../lib/format'

export function Limbo() {
  const { session, balance, applyBalance, ensureSession } = useSession()
  const [stake, setStake] = useState('10')
  const [target, setTarget] = useState(2)
  const [busy, setBusy] = useState(false)
  const [flying, setFlying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [last, setLast] = useState<{
    result: number
    target: number
    won: boolean
    payout: number
    profit: number
    multiplier: string
  } | null>(null)

  const amountMinor = toMinor(Number(stake) || 0, balance?.minor_unit ?? 2)
  const displayTarget = Math.max(1.01, Math.floor(target * 100) / 100)

  async function play() {
    setError(null)
    setBusy(true)
    setFlying(true)
    try {
      const sess = session ?? (await ensureSession('limbo'))
      const placeKey = uuid()
      const settleKey = uuid()
      const placed = await api.placeBet(
        sess.session_id,
        sess.launch_token,
        {
          game_id: 'limbo',
          round_id: `limbo_${Date.now()}`,
          amount: amountMinor,
          bet_type: 'target_multiplier',
          client_seed: sess.provably_fair
            ? `client_${sess.session_id.slice(-6)}`
            : 'client_demo',
          payload: { target_multiplier: displayTarget },
        },
        placeKey,
      )
      applyBalance(placed.balance_after)

      const preview = placed.outcome_preview
      const payout = preview?.payout ?? 0
      const outcome = {
        result: Number(preview?.result ?? 0),
        target_multiplier: Number(preview?.target_multiplier ?? displayTarget),
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
        result: outcome.result,
        target: outcome.target_multiplier,
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
      window.setTimeout(() => setFlying(false), 700)
    }
  }

  return (
    <section className="section" aria-labelledby="limbo-title">
      <h2 id="limbo-title">Horizon Limbo</h2>
      <p>
        Pick a target multiplier. Provably Fair result settles through Casino Rail —
        win when the flight clears your line.
      </p>

      <div className="limbo-stage" aria-live="polite">
        <div className={`limbo-meter ${flying ? 'flying' : ''}`}>
          <span className="limbo-readout">
            {last ? `${last.result.toFixed(2)}×` : '—'}
          </span>
          <div
            className="limbo-fill"
            style={{
              width: `${Math.min(100, ((last?.result ?? 1) / Math.max(displayTarget * 2, 4)) * 100)}%`,
            }}
          />
        </div>
        <p className="limbo-target-line">Target {displayTarget.toFixed(2)}×</p>
      </div>

      <div className="panel stack">
        <div className="metric-row">
          <div className="metric">
            <span>Pays</span>
            <strong>{displayTarget.toFixed(2)}×</strong>
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
          <label htmlFor="limbo-stake">Stake (USDC)</label>
          <input
            id="limbo-stake"
            type="number"
            min="0.01"
            step="0.01"
            value={stake}
            onChange={(e) => setStake(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="limbo-target">Target multiplier</label>
          <input
            id="limbo-target"
            type="range"
            min="1.01"
            max="100"
            step="0.01"
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
          />
          <input
            type="number"
            min="1.01"
            max="100000"
            step="0.01"
            value={displayTarget}
            onChange={(e) => setTarget(Number(e.target.value) || 1.01)}
            aria-label="Target multiplier exact"
          />
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
            Result {last.result.toFixed(2)}× vs {last.target.toFixed(2)}× ·{' '}
            {last.won ? 'Win' : 'Lose'} · payout{' '}
            {formatUsdc(last.payout, balance?.minor_unit ?? 2)} USDC · profit{' '}
            {formatUsdc(last.profit, balance?.minor_unit ?? 2)}
          </p>
        ) : null}
      </div>
    </section>
  )
}
