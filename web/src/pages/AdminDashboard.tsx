import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, RailApiError } from '../lib/api/client'
import { formatUsdc } from '../lib/format'
import type { AdminDashboard as DashboardData, AuditEvent } from '../lib/types'

export function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setData(await api.adminDashboard())
    } catch (e) {
      if (e instanceof RailApiError) setError(`${e.code}: ${e.message}`)
      else setError(e instanceof Error ? e.message : 'Failed to load dashboard')
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
        <Link className="btn btn-teal" to="/admin/audit">
          Open audit stream
        </Link>
      </div>

      {error ? <p className="alert">{error}</p> : null}

      {data ? (
        <>
          <div className="admin-stat-grid" role="list">
            <Stat label="Players" value={String(data.counts.players)} to="/admin/players" />
            <Stat label="Bets" value={String(data.counts.bets)} to="/admin/bets" />
            <Stat label="Deposits" value={String(data.counts.deposits)} to="/admin/deposits" />
            <Stat
              label="Pending WD"
              value={String(data.counts.withdrawals_pending)}
              to="/admin/withdrawals"
            />
            <Stat
              label="Audit events"
              value={String(data.counts.audit_events)}
              to="/admin/audit"
              hint="append-only"
            />
            <Stat
              label="Available"
              value={`${formatUsdc(data.balances.available, 2)} USDC`}
              to="/admin/players"
            />
          </div>

          <h3 className="admin-subhead">Recent audit</h3>
          {data.recent_audit.length === 0 ? (
            <p style={{ color: 'var(--ink-muted)' }}>No audit events yet.</p>
          ) : (
            <ul className="admin-event-list">
              {data.recent_audit.map((ev: AuditEvent) => (
                <li key={ev.id}>
                  <code className="admin-action">{ev.action}</code>
                  <span>
                    {ev.entity_type}/{ev.entity_id}
                  </span>
                  <time dateTime={ev.created_at}>{ev.created_at}</time>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : !error ? (
        <p style={{ color: 'var(--ink-muted)' }}>Loading…</p>
      ) : null}
    </div>
  )
}

function Stat({
  label,
  value,
  to,
  hint,
}: {
  label: string
  value: string
  to: string
  hint?: string
}) {
  return (
    <Link className="admin-stat" to={to} role="listitem">
      <span className="admin-stat-label">
        {label}
        {hint ? <em> · {hint}</em> : null}
      </span>
      <strong>{value}</strong>
    </Link>
  )
}
