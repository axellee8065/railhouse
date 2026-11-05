import { useState } from 'react'
import { useSession } from '../context/SessionContext'
import { api, RailApiError } from '../lib/api/client'
import { formatUsdc, toMinor } from '../lib/format'

export function Wallet() {
  const { session, balance, applyBalance, ensureSession, refreshBalance, player } = useSession()
  const [amount, setAmount] = useState('50')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function deposit() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const sess = session ?? (await ensureSession())
      const minor = toMinor(Number(amount) || 0, balance?.minor_unit ?? 2)
      const next = await api.mockDeposit(sess.session_id, sess.launch_token, minor, player.player_id)
      applyBalance(next)
      setMessage(
        `Mock deposit credited · ${formatUsdc(minor, next.minor_unit)} USDC on Sui testnet (sandbox).`,
      )
    } catch (e) {
      if (e instanceof RailApiError) setError(`${e.code}: ${e.message}`)
      else setError(e instanceof Error ? e.message : 'Deposit failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="section" aria-labelledby="wallet-title">
      <h2 id="wallet-title">Wallet</h2>
      <p>
        USDC on Sui testnet for this PoC. Operator self-custody — Railhouse never holds your
        signing keys and never sole-signs customer withdrawals.
      </p>

      <div className="panel stack">
        <div className="metric-row">
          <div className="metric">
            <span>Available</span>
            <strong>
              {balance
                ? `${formatUsdc(balance.available, balance.minor_unit)} USDC`
                : '—'}
            </strong>
          </div>
          <div className="metric">
            <span>Reserved</span>
            <strong>
              {balance
                ? `${formatUsdc(balance.reserved, balance.minor_unit)} USDC`
                : '—'}
            </strong>
          </div>
          <div className="metric">
            <span>Chain</span>
            <strong>Sui testnet</strong>
          </div>
        </div>

        <div className="ok-note">
          Custody model: you (the operator / player wallet) keep keys. Casino Rail moves
          sandbox ledger balances for the demo; it is not a custodian of production funds.
        </div>

        <div className="field">
          <label htmlFor="deposit">Mock deposit (USDC)</label>
          <input
            id="deposit"
            type="number"
            min="1"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div className="cta-row">
          <button className="btn btn-primary" type="button" disabled={busy} onClick={deposit}>
            {busy ? 'Crediting…' : 'Mock deposit'}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => void refreshBalance()}
          >
            Refresh balance
          </button>
        </div>

        {message ? <p className="ok-note">{message}</p> : null}
        {error ? <p className="alert">{error}</p> : null}
      </div>
    </section>
  )
}
