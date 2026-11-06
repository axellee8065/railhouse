import { useCallback, useEffect, useState } from 'react'
import { api, RailApiError } from '../lib/api/client'
import { formatUsdc } from '../lib/format'
import type { AdminDeposit } from '../lib/types'

export function AdminDeposits() {
  const [items, setItems] = useState<AdminDeposit[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await api.adminDeposits()
      setItems(res.items)
    } catch (e) {
      if (e instanceof RailApiError) setError(`${e.code}: ${e.message}`)
      else setError(e instanceof Error ? e.message : 'Failed to load deposits')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="admin-panel stack">
      <div className="cta-row">
        <button className="btn btn-ghost" type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <p style={{ color: 'var(--ink-muted)', margin: 0 }}>
        Ledger <code>deposit_credit</code> entries (seed + watcher + mock). Append-visible
        history via journal — not rewritten.
      </p>
      {error ? <p className="alert">{error}</p> : null}

      <div className="admin-table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Tx / digest</th>
              <th>Player</th>
              <th>Amount</th>
              <th>Posted</th>
              <th>Entry</th>
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.entry_id}>
                <td>
                  <code className="mono">{d.tx_id}</code>
                </td>
                <td>
                  <code>{d.player_id ?? '—'}</code>
                </td>
                <td>{formatUsdc(d.amount, 2)} USDC</td>
                <td style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>{d.posted_at}</td>
                <td>
                  <code className="mono">{d.entry_id}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && !error ? (
          <p style={{ color: 'var(--ink-muted)' }}>No deposits credited yet.</p>
        ) : null}
      </div>
    </div>
  )
}
