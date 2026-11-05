import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
import { api, RailApiError } from '../lib/api/client'
import { formatUsdc, toMinor, uuid } from '../lib/format'
import { calcMultiplier } from '../lib/fairness'

export function HelloDice() {
  const { session, balance, applyBalance, ensureSession } = useSession()
  const [stake, setStake] = useState('10')
  const [target, setTarget] = useState(50.5)
  const [condition, setCondition] = useState<'over' | 'under'>('over')
  const [busy, setBusy] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [last, setLast] = useState<{
    roll: number
    won: boolean
    payout: number
    profit: number
    multiplier: string
  } | null>(null)

  const multiplier = calcMultiplier(target, condition)
  const amountMinor = toMinor(Number(stake) || 0, balance?.minor_unit ?? 2)

  async function play() {
    setError(null)
    setBusy(true)
    setSpinning(true)
    try {
      const sess = session ?? (await ensureSession('hello_dice'))
      const placeKey = uuid()
      const settleKey = uuid()
      const placed = await api.placeBet(
        sess.session_id,
        sess.launch_token,
        {
          game_id: 'hello_dice',
          round_id: `round_${Date.now()}`,
          amount: amountMinor,
          bet_type: condition === 'over' ? 'roll_over' : 'roll_under',
          client_seed: sess.provably_fair ? `client_${sess.session_id.slice(-6)}` : 'client_demo',
          nonce: 0,
          payload: { target, condition },
        },
        placeKey,
      )
      applyBalance(placed.balance_after)

      const preview = placed.outcome_preview
      const payout = preview?.payout ?? 0
      const outcome = preview
        ? {
            roll: preview.roll,
            won: preview.won,
            multiplier: preview.multiplier,
          }
        : { roll: 0, won: false, multiplier: '0' }

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
        roll: outcome.roll,
        won: outcome.won,
        payout: settled.payout,
        profit: settled.profit,
        multiplier: outcome.multiplier,
      })
    } catch (e) {
      if (e instanceof RailApiError) {
        setError(`${e.code}: ${e.message}`)
      } else {
        setError(e instanceof Error ? e.message : 'Bet failed')
      }
    } finally {
      setBusy(false)
      window.setTimeout(() => setSpinning(false), 550)
    }
  }

  return (
    <section className="section" aria-labelledby="dice-title">
      <h2 id="dice-title">Hello Dice</h2>
      <p>
        In-house original. Target a roll, then place → settle on Casino Rail. Balance comes
        only from the wallet API.
      </p>

      <div className="dice-stage">
        <div className={`dice-orb ${spinning ? 'spinning' : ''}`} aria-live="polite">
          {last ? last.roll.toFixed(2) : '—'}
        </div>
      </div>

      <div className="panel stack">
        <div className="metric-row">
          <div className="metric">
            <span>Multiplier</span>
            <strong>{multiplier}×</strong>
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
          <label htmlFor="stake">Stake (USDC)</label>
          <input
            id="stake"
            type="number"
            min="0.01"
            step="0.01"
            value={stake}
            onChange={(e) => setStake(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="target">Target</label>
          <input
            id="target"
            type="range"
            min="2"
            max="98"
            step="0.5"
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
          />
          <span className="mono">{target.toFixed(1)}</span>
        </div>

        <div className="field">
          <label htmlFor="condition">Condition</label>
          <select
            id="condition"
            value={condition}
            onChange={(e) => setCondition(e.target.value as 'over' | 'under')}
          >
            <option value="over">Roll over</option>
            <option value="under">Roll under</option>
          </select>
        </div>

        <div className="cta-row">
          <button className="btn btn-primary" type="button" disabled={busy || amountMinor < 1} onClick={play}>
            {busy ? 'Settling…' : 'Place bet'}
          </button>
          <Link className="btn btn-ghost" to="/fairness">
            Verify seeds
          </Link>
        </div>

        {error ? <p className="alert">{error}</p> : null}
        {last ? (
          <p className={last.won ? 'ok-note result-win' : 'alert result-lose'}>
            Roll {last.roll.toFixed(2)} · {last.won ? 'Win' : 'Lose'} · payout{' '}
            {formatUsdc(last.payout, balance?.minor_unit ?? 2)} USDC · profit{' '}
            {formatUsdc(last.profit, balance?.minor_unit ?? 2)}
          </p>
        ) : null}
      </div>
    </section>
  )
}
