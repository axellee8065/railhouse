import { useCallback, useEffect, useState } from 'react'
import { api, RailApiError } from '../lib/api/client'
import { formatUsdc } from '../lib/format'
import type { AdminBet, AdminRound } from '../lib/types'

export function AdminBets() {
  const [bets, setBets] = useState<AdminBet[]>([])
  const [rounds, setRounds] = useState<AdminRound[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [b, r] = await Promise.all([api.adminBets(), api.adminRounds()])
      setBets(b.items)
      setRounds(r.items)
    } catch (e) {
      if (e instanceof RailApiError) setError(`${e.code}: ${e.message}`)
      else setError(e instanceof Error ? e.message : 'Failed to load bets')
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

      <h3 className="admin-subhead">Bets ({bets.length})</h3>
      <div className="admin-table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Bet</th>
              <th>Game</th>
              <th>Player</th>
              <th>Status</th>
              <th>Amount</th>
              <th>Payout</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {bets.map((b) => (
              <tr key={b.bet_id}>
                <td>
                  <code className="mono">{b.bet_id}</code>
                </td>
                <td>{b.game_id}</td>
                <td>
                  <code>{b.player_id}</code>
                </td>
                <td>{b.status}</td>
                <td>{formatUsdc(b.amount, 2)}</td>
                <td>{b.payout != null ? formatUsdc(b.payout, 2) : '—'}</td>
                <td style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>{b.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {bets.length === 0 && !error ? (
          <p style={{ color: 'var(--ink-muted)' }}>
            No bets yet — place one from Dice / Limbo / Flip.
          </p>
        ) : null}
      </div>

      <h3 className="admin-subhead">Rounds ({rounds.length})</h3>
      <div className="admin-table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Round</th>
              <th>Game</th>
              <th>Status</th>
              <th>Bets</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {rounds.map((r) => (
              <tr key={r.round_id}>
                <td>
                  <code className="mono">{r.round_id}</code>
                </td>
                <td>{r.game_id}</td>
                <td>{r.status}</td>
                <td>{r.bet_ids.length}</td>
                <td style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>{r.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
