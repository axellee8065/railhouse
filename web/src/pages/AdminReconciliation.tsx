import { useCallback, useEffect, useState } from 'react'
import { api, RailApiError } from '../lib/api/client'
import type {
  ReconInjection,
  ReconOverview,
  ReconRun,
  ReconTicket,
} from '../lib/types'

type InjectForm = {
  type: 'missing' | 'duplicate'
  leg: 'game' | 'rail' | 'chain'
}

/**
 * 3-way reconciliation admin UI (PoC step D).
 * Run recon, inject missing/duplicate demos, list tickets + diff summary.
 */
export function AdminReconciliation() {
  const [data, setData] = useState<ReconOverview | null>(null)
  const [lastRun, setLastRun] = useState<ReconRun | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [injectForm, setInjectForm] = useState<InjectForm>({
    type: 'missing',
    leg: 'chain',
  })
  const [note, setNote] = useState('demo inject')

  const load = useCallback(async () => {
    setError(null)
    try {
      const overview = await api.adminReconciliation()
      setData(overview)
      if (overview.last_run) setLastRun(overview.last_run)
    } catch (e) {
      if (e instanceof RailApiError) setError(`${e.code}: ${e.message}`)
      else setError(e instanceof Error ? e.message : 'Failed to load reconciliation')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function onRun() {
    setBusy(true)
    setError(null)
    try {
      const res = await api.adminReconRun()
      setLastRun(res.run)
      await load()
    } catch (e) {
      if (e instanceof RailApiError) setError(`${e.code}: ${e.message}`)
      else setError(e instanceof Error ? e.message : 'Run failed')
    } finally {
      setBusy(false)
    }
  }

  async function onInject() {
    setBusy(true)
    setError(null)
    try {
      await api.adminReconInject({
        type: injectForm.type,
        leg: injectForm.leg,
        note,
      })
      await load()
    } catch (e) {
      if (e instanceof RailApiError) setError(`${e.code}: ${e.message}`)
      else setError(e instanceof Error ? e.message : 'Inject failed')
    } finally {
      setBusy(false)
    }
  }

  async function onClear() {
    setBusy(true)
    setError(null)
    try {
      await api.adminReconClearInjections()
      await load()
    } catch (e) {
      if (e instanceof RailApiError) setError(`${e.code}: ${e.message}`)
      else setError(e instanceof Error ? e.message : 'Clear failed')
    } finally {
      setBusy(false)
    }
  }

  const tickets = data?.tickets ?? []
  const openTickets = tickets.filter((t) => t.status === 'open')
  const resolvedTickets = tickets.filter((t) => t.status === 'resolved')
  const summary = lastRun?.diff_summary ?? data?.last_run?.diff_summary

  return (
    <div className="admin-panel stack">
      <p className="admin-lede" style={{ margin: 0 }}>
        Compare <strong>game</strong> ledger · <strong>Rail</strong> journal ·{' '}
        <strong>chain/fixture</strong> digests. Inject missing/duplicate anomalies for demo —
        run recon to open tickets (status open/resolved).
      </p>

      <div className="cta-row">
        <button className="btn btn-teal" type="button" disabled={busy} onClick={() => void onRun()}>
          {busy ? 'Working…' : 'Run reconciliation'}
        </button>
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void load()}>
          Refresh
        </button>
        <button
          className="btn btn-ghost"
          type="button"
          disabled={busy}
          onClick={() => void onClear()}
        >
          Clear injections
        </button>
      </div>

      {error ? <p className="alert">{error}</p> : null}

      <div className="admin-stat-grid" role="list">
        <div className="admin-stat" role="listitem">
          <span className="admin-stat-label">Game facts</span>
          <strong>{data?.leg_counts.game ?? '—'}</strong>
        </div>
        <div className="admin-stat" role="listitem">
          <span className="admin-stat-label">Rail facts</span>
          <strong>{data?.leg_counts.rail ?? '—'}</strong>
        </div>
        <div className="admin-stat" role="listitem">
          <span className="admin-stat-label">Chain facts</span>
          <strong>{data?.leg_counts.chain ?? '—'}</strong>
        </div>
        <div className="admin-stat" role="listitem">
          <span className="admin-stat-label">Open tickets</span>
          <strong>{data?.open_tickets ?? openTickets.length}</strong>
        </div>
        <div className="admin-stat" role="listitem">
          <span className="admin-stat-label">Missing</span>
          <strong>{summary?.missing ?? 0}</strong>
        </div>
        <div className="admin-stat" role="listitem">
          <span className="admin-stat-label">Duplicate</span>
          <strong>{summary?.duplicate ?? 0}</strong>
        </div>
      </div>

      <h3 className="admin-subhead">Inject demo anomaly</h3>
      <div className="recon-inject-row">
        <label>
          Type
          <select
            value={injectForm.type}
            onChange={(e) =>
              setInjectForm((f) => ({
                ...f,
                type: e.target.value as InjectForm['type'],
              }))
            }
          >
            <option value="missing">missing</option>
            <option value="duplicate">duplicate</option>
          </select>
        </label>
        <label>
          Leg
          <select
            value={injectForm.leg}
            onChange={(e) =>
              setInjectForm((f) => ({
                ...f,
                leg: e.target.value as InjectForm['leg'],
              }))
            }
          >
            <option value="game">game</option>
            <option value="rail">rail</option>
            <option value="chain">chain</option>
          </select>
        </label>
        <label>
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button className="btn btn-teal" type="button" disabled={busy} onClick={() => void onInject()}>
          Inject
        </button>
      </div>
      <p className="ok-note" style={{ margin: 0 }}>
        Inject picks the first deposit fact on that leg when <code>target_key</code> is omitted.
        Then click <strong>Run reconciliation</strong>.
      </p>

      {data && data.injections.length > 0 ? (
        <>
          <h3 className="admin-subhead">Active injections</h3>
          <ul className="admin-event-list">
            {data.injections.map((inj: ReconInjection) => (
              <li key={inj.id}>
                <code className="admin-action">
                  {inj.type}/{inj.leg}
                </code>
                <span>{inj.target_key}</span>
                <span>{inj.note ?? '—'}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h3 className="admin-subhead">3-way diff summary</h3>
      {lastRun || data?.last_run ? (
        <div className="recon-diff-box">
          <p>
            Run <code>{(lastRun ?? data?.last_run)?.id}</code> · mode{' '}
            <code>{(lastRun ?? data?.last_run)?.mode}</code> · total diffs{' '}
            <strong>{(lastRun ?? data?.last_run)?.diff_summary.total ?? 0}</strong>
          </p>
          <ul className="admin-event-list">
            {((lastRun ?? data?.last_run)?.discrepancies ?? []).map((d, i) => (
              <li key={`${d.kind}-${d.leg}-${d.target_key}-${i}`}>
                <code className="admin-action">{d.kind}</code>
                <span>
                  {d.leg} · {d.target_key}
                </span>
                <span>{d.summary}</span>
              </li>
            ))}
          </ul>
          {(lastRun ?? data?.last_run)?.discrepancies.length === 0 ? (
            <p className="ok-line">Clean — no discrepancies on last run.</p>
          ) : null}
        </div>
      ) : (
        <p style={{ color: 'var(--ink-muted)' }}>No runs yet — click Run reconciliation.</p>
      )}

      <h3 className="admin-subhead">Tickets ({openTickets.length} open · {resolvedTickets.length} resolved)</h3>
      {tickets.length === 0 ? (
        <p style={{ color: 'var(--ink-muted)' }}>No tickets yet.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Kind</th>
                <th>Leg</th>
                <th>Key</th>
                <th>Summary</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t: ReconTicket) => (
                <tr key={t.id}>
                  <td>
                    <span className={t.status === 'open' ? 'recon-status-open' : 'recon-status-resolved'}>
                      {t.status}
                    </span>
                  </td>
                  <td>
                    <code>{t.discrepancy_kind}</code>
                  </td>
                  <td>{t.leg}</td>
                  <td>
                    <code className="mono">{t.target_key}</code>
                  </td>
                  <td>{t.summary}</td>
                  <td>
                    <time dateTime={t.created_at}>{t.created_at}</time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
