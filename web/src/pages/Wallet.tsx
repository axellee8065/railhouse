import { useEffect, useState } from 'react'
import { useSession } from '../context/SessionContext'
import { api, RailApiError } from '../lib/api/client'
import { formatUsdc, toMinor } from '../lib/format'
import type { DepositAddressInfo } from '../lib/types'

export function Wallet() {
  const { session, balance, applyBalance, ensureSession, refreshBalance, player } = useSession()
  const [amount, setAmount] = useState('50')
  const [digest, setDigest] = useState('dryrun_B5F7Be1srK6nARNzB9YqnipvYnEq5XCZW12WSTi2BjJj')
  const [depositInfo, setDepositInfo] = useState<DepositAddressInfo | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api
      .depositAddress()
      .then((info) => {
        if (!cancelled) setDepositInfo(info)
      })
      .catch(() => {
        /* MSW / offline — address panel stays empty */
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function copyAddress() {
    if (!depositInfo?.receive_address) return
    try {
      await navigator.clipboard.writeText(depositInfo.receive_address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setError('Clipboard unavailable — select the address manually.')
    }
  }

  async function mockDeposit() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const sess = session ?? (await ensureSession())
      const minor = toMinor(Number(amount) || 0, balance?.minor_unit ?? 2)
      const next = await api.mockDeposit(sess.session_id, sess.launch_token, minor, player.player_id)
      applyBalance(next)
      setMessage(
        `Mock deposit credited · ${formatUsdc(minor, next.minor_unit)} USDC (sandbox stub, not on-chain).`,
      )
    } catch (e) {
      if (e instanceof RailApiError) setError(`${e.code}: ${e.message}`)
      else setError(e instanceof Error ? e.message : 'Deposit failed')
    } finally {
      setBusy(false)
    }
  }

  async function detectDeposit() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const sess = session ?? (await ensureSession())
      const result = await api.detectUsdcDeposit(digest.trim(), player.player_id, true)
      const next = await api.balance(sess.session_id, sess.launch_token)
      applyBalance(next)
      if (result.skipped === 'unconfirmed') {
        setMessage(
          `Seen on-chain but waiting for confirmations (${result.deposit?.confirmations ?? '?'}/${depositInfo?.required_confirmations ?? '?'}).`,
        )
      } else if (result.replay) {
        setMessage(`Already credited digest ${result.deposit?.digest ?? digest}. Balance refreshed.`)
      } else {
        setMessage(
          `Credited ${formatUsdc(result.amount ?? 0, next.minor_unit)} USDC from ${result.deposit?.source ?? 'detect'} · ${result.deposit?.digest ?? digest}`,
        )
      }
    } catch (e) {
      if (e instanceof RailApiError) setError(`${e.code}: ${e.message}`)
      else setError(e instanceof Error ? e.message : 'Detect failed')
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
          Custody model: the operator receive address is self-custodied. Casino Rail detects
          inbound Circle USDC and updates the sandbox ledger only — it does not sign withdrawals.
        </div>

        <div className="field">
          <label htmlFor="receive-address">Operator receive address (Sui testnet)</label>
          <input
            id="receive-address"
            readOnly
            value={depositInfo?.receive_address ?? 'Loading…'}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>

        <div className="cta-row">
          <button className="btn btn-teal" type="button" onClick={() => void copyAddress()}>
            {copied ? 'Copied' : 'Copy address'}
          </button>
          {depositInfo?.explorer_account_url ? (
            <a className="btn btn-ghost" href={depositInfo.explorer_account_url} target="_blank" rel="noreferrer">
              View on explorer
            </a>
          ) : null}
          {depositInfo?.faucet_url ? (
            <a className="btn btn-ghost" href={depositInfo.faucet_url} target="_blank" rel="noreferrer">
              Circle USDC faucet
            </a>
          ) : null}
        </div>

        <ol className="stack" style={{ margin: 0, paddingLeft: '1.25rem', lineHeight: 1.55 }}>
          <li>Fund a Sui testnet wallet with gas (SUI) from a public faucet.</li>
          <li>
            Mint or request Circle testnet USDC
            {depositInfo?.faucet_url ? (
              <>
                {' '}
                (<a href={depositInfo.faucet_url} target="_blank" rel="noreferrer">faucet.circle.com</a>
                ; availability varies).
              </>
            ) : null}
          </li>
          <li>Send USDC to the receive address above (Circle coin type only — not bridged wUSDC).</li>
          <li>Wait for the deposit watcher, or paste the tx digest below and detect.</li>
          <li>
            Without faucet USDC, replay the bundled dry-run digest (pre-filled) to see a ledger credit.
          </li>
        </ol>

        {depositInfo?.usdc_coin_type ? (
          <p className="ok-note" style={{ wordBreak: 'break-all' }}>
            Coin type: <code>{depositInfo.usdc_coin_type}</code>
          </p>
        ) : null}

        <div className="field">
          <label htmlFor="tx-digest">Tx digest (live or dry-run fixture)</label>
          <input
            id="tx-digest"
            value={digest}
            onChange={(e) => setDigest(e.target.value)}
            spellCheck={false}
          />
        </div>

        <div className="cta-row">
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void detectDeposit()}>
            {busy ? 'Detecting…' : 'Detect & credit'}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => void refreshBalance()}
          >
            Refresh balance
          </button>
        </div>

        <div className="field">
          <label htmlFor="deposit">Mock deposit (sandbox stub, no chain)</label>
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
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void mockDeposit()}>
            {busy ? 'Crediting…' : 'Mock deposit'}
          </button>
        </div>

        {message ? <p className="ok-note">{message}</p> : null}
        {error ? <p className="alert">{error}</p> : null}
      </div>
    </section>
  )
}
