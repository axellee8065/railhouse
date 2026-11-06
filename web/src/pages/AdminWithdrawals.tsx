import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
import { api, RailApiError } from '../lib/api/client'
import { formatUsdc } from '../lib/format'
import type { UnsignedPayoutIntent, Withdrawal } from '../lib/types'

/**
 * SANDBOX admin approvals — demo auth via studio client credentials.
 * Approve stores an unsigned payout intent only (no keys / no broadcast).
 */
export function AdminWithdrawals() {
  const { applyBalance, refreshBalance } = useSession()
  const [items, setItems] = useState<Withdrawal[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastIntent, setLastIntent] = useState<UnsignedPayoutIntent | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [kycToggle, setKycToggle] = useState<'clear' | 'pending'>('clear')

  const load = useCallback(async () => {
    setError(null)
    try {
      const list = await api.listWithdrawals()
      setItems(list.items)
    } catch (e) {
      if (e instanceof RailApiError) setError(`${e.code}: ${e.message}`)
      else setError(e instanceof Error ? e.message : 'Failed to load withdrawals')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function approve(id: string) {
    setBusyId(id)
    setError(null)
    setNote(null)
    try {
      const result = await api.approveWithdrawal(id)
      if (result.balance) applyBalance(result.balance)
      else await refreshBalance()
      setLastIntent(result.confirmation?.unsigned_payout_intent ?? result.unsigned_payout_intent ?? null)
      setNote(
        'Approved — unsigned payout intent stored. signed=false, broadcast=false, private_keys_in_process=false.',
      )
      await load()
    } catch (e) {
      if (e instanceof RailApiError) setError(`${e.code}: ${e.message}`)
      else setError(e instanceof Error ? e.message : 'Approve failed')
    } finally {
      setBusyId(null)
    }
  }

  async function reject(id: string) {
    setBusyId(id)
    setError(null)
    setNote(null)
    try {
      const result = await api.rejectWithdrawal(id)
      if (result.balance) applyBalance(result.balance)
      else await refreshBalance()
      setNote('Rejected — reserved funds released to available.')
      await load()
    } catch (e) {
      if (e instanceof RailApiError) setError(`${e.code}: ${e.message}`)
      else setError(e instanceof Error ? e.message : 'Reject failed')
    } finally {
      setBusyId(null)
    }
  }

  async function setDemoKyc(status: 'clear' | 'pending') {
    setError(null)
    try {
      await api.setSandboxWithdrawPolicy({
        player_id: 'player_demo_42',
        kyc_status: status,
      })
      setKycToggle(status)
      setNote(
        status === 'pending'
          ? 'SANDBOX: KYC set to pending — next withdraw requests will be policy_denied.'
          : 'SANDBOX: KYC restored to clear.',
      )
    } catch (e) {
      if (e instanceof RailApiError) setError(`${e.code}: ${e.message}`)
      else setError(e instanceof Error ? e.message : 'Policy stub update failed')
    }
  }

  const pending = items.filter((w) => w.status === 'pending_approval')

  return (
    <div className="admin-panel stack" aria-labelledby="admin-wd-title">
      <h3 id="admin-wd-title" className="admin-subhead">
        Withdrawals
      </h3>
      <p className="alert" style={{ background: 'rgba(212,163,92,0.12)' }}>
        SANDBOX demo auth (studio client credentials · games:admin). Not production IAM.
        Approve never signs or broadcasts — operator self-custody only. Policy stub changes
        append <code>policy.update</code> to the audit log.
      </p>

      <div className="stack">
        <div className="cta-row">
          <button className="btn btn-ghost" type="button" onClick={() => void load()}>
            Refresh queue
          </button>
          <Link className="btn btn-ghost" to="/wallet">
            Player wallet
          </Link>
          <Link className="btn btn-ghost" to="/admin/audit">
            Audit stream
          </Link>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => void setDemoKyc(kycToggle === 'clear' ? 'pending' : 'clear')}
          >
            Demo KYC → {kycToggle === 'clear' ? 'pending (deny)' : 'clear (allow)'}
          </button>
        </div>

        {note ? <p className="ok-note">{note}</p> : null}
        {error ? <p className="alert">{error}</p> : null}

        <h3 style={{ margin: 0, fontFamily: 'var(--font-display)' }}>
          Pending approval ({pending.length})
        </h3>

        {pending.length === 0 ? (
          <p style={{ color: 'var(--ink-muted)' }}>
            No pending withdrawals. Request one from the{' '}
            <Link to="/wallet">Wallet</Link> page.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {pending.map((w) => (
              <li
                key={w.id}
                style={{
                  borderTop: '1px solid var(--line)',
                  padding: '0.85rem 0',
                }}
              >
                <div>
                  <strong>{formatUsdc(w.amount, 2)} USDC</strong>
                  {' · '}
                  <code>{w.player_id}</code>
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--ink-muted)', wordBreak: 'break-all' }}>
                  to {w.to_address}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>
                  {w.id} · {w.requested_at}
                </div>
                <div className="cta-row" style={{ marginTop: '0.5rem' }}>
                  <button
                    className="btn btn-teal"
                    type="button"
                    disabled={busyId === w.id}
                    onClick={() => void approve(w.id)}
                  >
                    {busyId === w.id ? 'Working…' : 'Approve (unsigned intent)'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    disabled={busyId === w.id}
                    onClick={() => void reject(w.id)}
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {lastIntent ? (
          <div className="ok-note" style={{ wordBreak: 'break-all' }}>
            <strong>Last unsigned payout intent</strong>
            <pre style={{ margin: '0.5rem 0 0', whiteSpace: 'pre-wrap', fontSize: '0.78rem' }}>
              {JSON.stringify(lastIntent, null, 2)}
            </pre>
          </div>
        ) : null}

        <h3 style={{ margin: '1rem 0 0', fontFamily: 'var(--font-display)' }}>All recent</h3>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.slice(0, 20).map((w) => (
            <li
              key={`all-${w.id}`}
              style={{ borderTop: '1px solid var(--line)', padding: '0.45rem 0', fontSize: '0.9rem' }}
            >
              <strong>{w.status}</strong> · {formatUsdc(w.amount, 2)} USDC · {w.id}
              {w.fail_codes && w.fail_codes.length > 0 ? (
                <span style={{ color: 'var(--danger)' }}> · {w.fail_codes.join(', ')}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
