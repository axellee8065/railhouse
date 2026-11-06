import { useCallback, useEffect, useState } from 'react'
import { api, RailApiError } from '../lib/api/client'
import { formatUsdc } from '../lib/format'
import type { AdminPlayer } from '../lib/types'

export function AdminPlayers() {
  const [items, setItems] = useState<AdminPlayer[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await api.adminPlayers()
      setItems(res.items)
    } catch (e) {
      if (e instanceof RailApiError) setError(`${e.code}: ${e.message}`)
      else setError(e instanceof Error ? e.message : 'Failed to load players')
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
      {error ? <p className="alert">{error}</p> : null}

      <div className="admin-table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Available</th>
              <th>Reserved</th>
              <th>KYC</th>
              <th>RG daily</th>
              <th>Self-ex</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={`${p.operator_id}:${p.player_id}`}>
                <td>
                  <code>{p.player_id}</code>
                </td>
                <td>{formatUsdc(p.balance.available, 2)}</td>
                <td>{formatUsdc(p.balance.reserved, 2)}</td>
                <td>{p.policy?.kyc_status ?? '—'}</td>
                <td>
                  {p.policy?.rg_daily_limit_minor != null
                    ? formatUsdc(p.policy.rg_daily_limit_minor, 2)
                    : '—'}
                </td>
                <td>{p.policy?.self_excluded ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && !error ? (
          <p style={{ color: 'var(--ink-muted)' }}>No player accounts.</p>
        ) : null}
      </div>
    </div>
  )
}
