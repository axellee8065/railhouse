import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
import { api, RailApiError } from '../lib/api/client'
import { formatUsdc, toMinor, uuid } from '../lib/format'
import { calcMultiplier, winChanceFromTarget } from '../lib/fairness'

const TARGET_MIN = 2
const TARGET_MAX = 98
const EDGE = 0.01

type RollHistory = {
  roll: number
  won: boolean
}

function clampTarget(n: number): number {
  return Math.min(TARGET_MAX, Math.max(TARGET_MIN, Math.round(n * 2) / 2))
}

function targetFromWinChance(chance: number, condition: 'over' | 'under'): number {
  const c = Math.min(98, Math.max(1, chance))
  return clampTarget(condition === 'over' ? 100 - c : c)
}

function targetFromMultiplier(mult: number, condition: 'over' | 'under'): number {
  if (!Number.isFinite(mult) || mult <= 1) return clampTarget(condition === 'over' ? 50.5 : 49.5)
  const chance = (100 * (1 - EDGE)) / mult
  return targetFromWinChance(chance, condition)
}

export function HelloDice() {
  const { session, balance, applyBalance, ensureSession } = useSession()
  const [stake, setStake] = useState('10')
  const [target, setTarget] = useState(50.5)
  const [condition, setCondition] = useState<'over' | 'under'>('over')
  const [busy, setBusy] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<RollHistory[]>([])
  const [last, setLast] = useState<{
    roll: number
    won: boolean
    payout: number
    profit: number
    multiplier: string
  } | null>(null)

  const multiplier = calcMultiplier(target, condition)
  const winChance = winChanceFromTarget(target, condition)
  const amountMinor = toMinor(Number(stake) || 0, balance?.minor_unit ?? 2)
  const availableMajor = balance ? balance.available / 10 ** balance.minor_unit : 0
  const potentialPayout = useMemo(() => {
    const stakeNum = Number(stake) || 0
    return (stakeNum * Number(multiplier)).toFixed(2)
  }, [stake, multiplier])

  const sliderFill = useMemo(() => {
    const pct = ((target - TARGET_MIN) / (TARGET_MAX - TARGET_MIN)) * 100
    if (condition === 'over') {
      // lose zone left (danger), win zone right (ok)
      return {
        background: `linear-gradient(90deg, var(--danger) 0%, var(--danger) ${pct}%, var(--ok) ${pct}%, var(--ok) 100%)`,
      }
    }
    // win zone left, lose zone right
    return {
      background: `linear-gradient(90deg, var(--ok) 0%, var(--ok) ${pct}%, var(--danger) ${pct}%, var(--danger) 100%)`,
    }
  }, [target, condition])

  function setStakeSafe(next: number) {
    if (!Number.isFinite(next) || next < 0) {
      setStake('0')
      return
    }
    const capped = availableMajor > 0 ? Math.min(next, availableMajor) : next
    setStake((Math.round(capped * 100) / 100).toFixed(2))
  }

  function onWinChanceChange(raw: string) {
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    setTarget(targetFromWinChance(n, condition))
  }

  function onMultiplierChange(raw: string) {
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    setTarget(targetFromMultiplier(n, condition))
  }

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
      const entry = { roll: outcome.roll, won: outcome.won }
      setHistory((prev) => [entry, ...prev].slice(0, 12))
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
    <section className="dice-page" aria-labelledby="dice-title">
      <header className="dice-page-head">
        <div>
          <h2 id="dice-title">Hello Dice</h2>
          <p>Railhouse original · roll 0–100 · 1% edge</p>
        </div>
        <Link className="dice-fair-link" to="/fairness">
          Provably Fair
        </Link>
      </header>

      <div className="dice-layout">
        <div className="dice-board">
          <div className={`dice-result ${spinning ? 'spinning' : ''} ${last ? (last.won ? 'is-win' : 'is-lose') : ''}`} aria-live="polite">
            <span className="dice-result-label">Result</span>
            <strong className="dice-result-num">{last ? last.roll.toFixed(2) : '—'}</strong>
            {last ? (
              <span className={`dice-result-badge ${last.won ? 'win' : 'lose'}`}>
                {last.won ? `Win · ${last.multiplier}×` : 'Lose'}
              </span>
            ) : (
              <span className="dice-result-badge idle">Set target &amp; roll</span>
            )}
          </div>

          <div className="dice-slider-block">
            <div className="dice-slider-meta">
              <span>0</span>
              <span className="dice-slider-target mono">
                {condition === 'over' ? 'Roll over' : 'Roll under'} {target.toFixed(1)}
              </span>
              <span>100</span>
            </div>
            <div className="dice-slider-track" style={sliderFill}>
              <input
                className="dice-slider"
                id="target"
                type="range"
                min={TARGET_MIN}
                max={TARGET_MAX}
                step={0.5}
                value={target}
                aria-label="Target number"
                onChange={(e) => setTarget(Number(e.target.value))}
              />
              <div
                className="dice-slider-thumb-marker"
                style={{ left: `${((target - TARGET_MIN) / (TARGET_MAX - TARGET_MIN)) * 100}%` }}
                aria-hidden
              />
            </div>
            <div className="dice-zone-legend">
              <span className="zone-win">Win zone</span>
              <span className="zone-lose">Lose zone</span>
            </div>
          </div>

          {history.length > 0 ? (
            <ul className="dice-history" aria-label="Recent rolls">
              {history.map((h, i) => (
                <li key={`${h.roll}-${i}`} className={h.won ? 'win' : 'lose'}>
                  {h.roll.toFixed(2)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="dice-history-empty">Recent rolls appear here</p>
          )}
        </div>

        <aside className="dice-controls">
          <div className="dice-toggle" role="group" aria-label="Roll condition">
            <button
              type="button"
              className={condition === 'under' ? 'active' : undefined}
              onClick={() => setCondition('under')}
            >
              Roll under
            </button>
            <button
              type="button"
              className={condition === 'over' ? 'active' : undefined}
              onClick={() => setCondition('over')}
            >
              Roll over
            </button>
          </div>

          <div className="dice-stats">
            <label className="dice-stat">
              <span>Win chance</span>
              <div className="dice-stat-input">
                <input
                  type="number"
                  min={1}
                  max={98}
                  step={0.5}
                  value={winChance.toFixed(2)}
                  onChange={(e) => onWinChanceChange(e.target.value)}
                />
                <em>%</em>
              </div>
            </label>
            <label className="dice-stat">
              <span>Multiplier</span>
              <div className="dice-stat-input">
                <input
                  type="number"
                  min={1.01}
                  max={99}
                  step={0.0001}
                  value={multiplier}
                  onChange={(e) => onMultiplierChange(e.target.value)}
                />
                <em>×</em>
              </div>
            </label>
          </div>

          <div className="dice-bet-field">
            <div className="dice-bet-label-row">
              <label htmlFor="stake">Bet amount</label>
              <span className="dice-bet-avail">
                {balance
                  ? `${formatUsdc(balance.available, balance.minor_unit)} USDC`
                  : '—'}
              </span>
            </div>
            <div className="dice-bet-row">
              <input
                id="stake"
                type="number"
                min="0.01"
                step="0.01"
                value={stake}
                onChange={(e) => setStake(e.target.value)}
              />
              <span className="dice-bet-unit">USDC</span>
            </div>
            <div className="dice-quick">
              <button type="button" onClick={() => setStakeSafe((Number(stake) || 0) / 2)}>
                ½
              </button>
              <button type="button" onClick={() => setStakeSafe((Number(stake) || 0) * 2)}>
                2×
              </button>
              <button type="button" onClick={() => setStakeSafe(availableMajor)}>
                Max
              </button>
            </div>
          </div>

          <div className="dice-payout-hint">
            <span>Payout on win</span>
            <strong>{potentialPayout} USDC</strong>
          </div>

          <button
            className="btn btn-primary dice-roll-cta"
            type="button"
            disabled={busy || amountMinor < 1}
            onClick={play}
          >
            {busy ? 'Rolling…' : 'Bet'}
          </button>

          {error ? <p className="alert">{error}</p> : null}
          {last ? (
            <p className={last.won ? 'ok-note result-win' : 'alert result-lose'}>
              {last.won ? 'Won' : 'Lost'} · profit{' '}
              {formatUsdc(last.profit, balance?.minor_unit ?? 2)} USDC
            </p>
          ) : null}

          <Link className="dice-verify-link" to="/fairness">
            Verify seeds
          </Link>
        </aside>
      </div>
    </section>
  )
}
