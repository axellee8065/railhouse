import { useCallback, useEffect, useState } from 'react'
import { api, RailApiError } from '../lib/api/client'
import type { AuditEvent } from '../lib/types'

const FILTERS: { label: string; value: string }[] = [
  { label: 'All', value: '' },
  { label: 'withdraw.*', value: 'prefix:withdraw.' },
  { label: 'withdraw.request', value: 'withdraw.request' },
  { label: 'withdraw.policy_deny', value: 'withdraw.policy_deny' },
  { label: 'withdraw.approve', value: 'withdraw.approve' },
  { label: 'withdraw.reject', value: 'withdraw.reject' },
  { label: 'policy.update', value: 'policy.update' },
]

/**
 * Append-only audit log stream UI.
 * Filter by action type; no edit/delete controls (by design).
 */
export function AdminAudit() {
  const [items, setItems] = useState<AuditEvent[]>([])
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [appendOnly, setAppendOnly] = useState(true)

  const load = useCallback(async () => {
    setError(null)
    try {
      const opts =
        filter.startsWith('prefix:')
          ? { action_prefix: filter.slice('prefix:'.length) }
          : filter
            ? { type: filter }
            : undefined
      const res = await api.adminAuditEvents(opts)
      setItems(res.items)
      setAppendOnly(res.append_only !== false)
    } catch (e) {
      if (e instanceof RailApiError) setError(`${e.code}: ${e.message}`)
      else setError(e instanceof Error ? e.message : 'Failed to load audit')
    }
  }, [filter])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="admin-panel stack">
      <p className="ok-note" style={{ margin: 0 }}>
        Append-only audit stream — events are frozen after write. No update/delete API.
        {appendOnly ? ' · append_only=true' : ''}
      </p>

      <div className="cta-row admin-filter-row">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            className={filter === f.value ? 'btn btn-teal' : 'btn btn-ghost'}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
        <button className="btn btn-ghost" type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {error ? <p className="alert">{error}</p> : null}

      <ul className="admin-audit-stream">
        {items.map((ev) => (
          <li key={ev.id} className="admin-audit-item">
            <div className="admin-audit-meta">
              <code className="admin-action">{ev.action}</code>
              <span>
                {ev.actor_type}:{ev.actor_id}
              </span>
              <span>
                {ev.entity_type}/{ev.entity_id}
              </span>
              <time dateTime={ev.created_at}>{ev.created_at}</time>
            </div>
            <pre className="admin-audit-payload">{JSON.stringify(ev.payload, null, 2)}</pre>
            <div className="mono" style={{ fontSize: '0.75rem' }}>
              {ev.id}
            </div>
          </li>
        ))}
      </ul>

      {items.length === 0 && !error ? (
        <p style={{ color: 'var(--ink-muted)' }}>
          No events for this filter. Request/approve a withdrawal or toggle KYC on Withdrawals to
          append.
        </p>
      ) : null}
    </div>
  )
}
