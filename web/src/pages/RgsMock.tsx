import { useState } from 'react'
import { useSession } from '../context/SessionContext'
import { api, RailApiError } from '../lib/api/client'
import { formatUsdc, toMinor, uuid } from '../lib/format'

/** Placeholder third-party RGS tile — same rail session, mock autoplay bet. */
export function RgsMock() {
  const { session, balance, applyBalance, ensureSession } = useSession()
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string>('Waiting for mock spin…')
  const [error, setError] = useState<string | null>(null)

  async function mockSpin() {
    setBusy(true)
    setError(null)
    try {
      const sess = session ?? (await ensureSession('rgs_mock_slots'))
      const amount = toMinor(1, balance?.minor_unit ?? 2)
      const placeKey = uuid()
      const settleKey = uuid()
      const placed = await api.placeBet(
        sess.session_id,
        sess.launch_token,
        {
          game_id: 'rgs_mock_slots',
          round_id: `rgs_${Date.now()}`,
          amount,
          bet_type: 'spin',
          client_seed: `rgs_${sess.session_id.slice(-6)}`,
          nonce: 0,
          payload: { target: 50.5, condition: 'over' },
        },
        placeKey,
      )
      applyBalance(placed.balance_after)
      const preview = placed.outcome_preview
      const settled = await api.settleBet(
        sess.session_id,
        sess.launch_token,
        placed.bet_id,
        {
          payout: preview?.payout ?? 0,
          outcome: preview
            ? { roll: preview.roll, won: preview.won, multiplier: preview.multiplier }
            : { won: false },
        },
        settleKey,
      )
      applyBalance(settled.balance_after)
      setLog(
        `RGS mock settled · bet ${settled.bet_id.slice(0, 12)}… · payout ${formatUsdc(
          settled.payout,
          balance?.minor_unit ?? 2,
        )} USDC`,
      )
    } catch (e) {
      if (e instanceof RailApiError) setError(`${e.code}: ${e.message}`)
      else setError(e instanceof Error ? e.message : 'RGS mock failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="section" aria-labelledby="rgs-title">
      <h2 id="rgs-title">Neon Switch · RGS mock</h2>
      <p>
        Stand-in for an external remote game server. The frame is local; wallet debit/credit
        still goes through Casino Rail with idempotent place/settle.
      </p>

      <div className="rgs-frame" role="img" aria-label="Mock RGS game frame">
        <div>
          <p className="hero-kicker">iframe placeholder</p>
          <h3 style={{ fontFamily: 'var(--font-display)', margin: '0.4rem 0' }}>Neon Switch</h3>
          <p style={{ color: 'var(--ink-muted)', maxWidth: '28rem' }}>
            Provider SDK would mount here. For the PoC we fire a 1 USDC mock spin against the
            same session ledger.
          </p>
          <div className="cta-row" style={{ justifyContent: 'center', marginTop: '1rem' }}>
            <button className="btn btn-teal" type="button" disabled={busy} onClick={mockSpin}>
              {busy ? 'Spinning…' : 'Mock spin (1 USDC)'}
            </button>
          </div>
        </div>
      </div>

      <p className="mono" style={{ marginTop: '1rem' }}>
        {log}
      </p>
      {error ? <p className="alert">{error}</p> : null}
    </section>
  )
}
