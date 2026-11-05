import { useEffect, useState } from 'react'
import { useSession } from '../context/SessionContext'
import { api } from '../lib/api/client'
import { formatUsdc } from '../lib/format'
import type { RoundItem } from '../lib/types'

export function Account() {
  const { player, session, balance, ensureSession } = useSession()
  const [rounds, setRounds] = useState<RoundItem[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const sess = session ?? (await ensureSession())
        const data = await api.rounds(sess.session_id, sess.launch_token)
        if (!cancelled) setRounds(data.items)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load history')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [session, ensureSession])

  return (
    <section className="section" aria-labelledby="account-title">
      <h2 id="account-title">Account</h2>
      <p>Simple demo profile for the sandbox player session.</p>

      <div className="panel stack">
        <div className="metric-row">
          <div className="metric">
            <span>Display name</span>
            <strong>{player.display_name}</strong>
          </div>
          <div className="metric">
            <span>Player ID</span>
            <strong className="mono">{player.player_id}</strong>
          </div>
          <div className="metric">
            <span>Email</span>
            <strong>{player.email}</strong>
          </div>
        </div>

        <div className="ok-note">
          Custody: operator self-custody on {player.chain}. Session balance{' '}
          {balance
            ? `${formatUsdc(balance.available, balance.minor_unit)} USDC available`
            : 'loading…'}
          .
        </div>

        <h3 style={{ fontFamily: 'var(--font-display)', margin: '0.5rem 0 0' }}>Recent rounds</h3>
        {error ? <p className="alert">{error}</p> : null}
        <table className="table">
          <thead>
            <tr>
              <th>Round</th>
              <th>Game</th>
              <th>Status</th>
              <th>Payout</th>
            </tr>
          </thead>
          <tbody>
            {rounds.length === 0 ? (
              <tr>
                <td colSpan={4}>No rounds yet — place a bet from Dice or RGS.</td>
              </tr>
            ) : (
              rounds.map((r) => (
                <tr key={r.round_id}>
                  <td className="mono">{r.round_id}</td>
                  <td>{r.game_id}</td>
                  <td>{r.status}</td>
                  <td>
                    {formatUsdc(r.bets[0]?.payout ?? 0, balance?.minor_unit ?? 2)} USDC
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
