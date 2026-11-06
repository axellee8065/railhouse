import { useCallback, useEffect, useState } from 'react'
import { api, RailApiError } from '../lib/api/client'
import { formatUsdc } from '../lib/format'
import type { TenantIsolationView, TenantSnapshot } from '../lib/types'

export function AdminTenants() {
  const [data, setData] = useState<TenantIsolationView | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setData(await api.adminTenants())
    } catch (e) {
      if (e instanceof RailApiError) setError(`${e.code}: ${e.message}`)
      else setError(e instanceof Error ? e.message : 'Failed to load tenants')
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

      <p className="admin-lede" style={{ margin: 0 }}>
        Side-by-side ledgers for <code>op_demo_A</code> and <code>op_demo_B</code>. Same{' '}
        <code>player_id</code> under both tenants stays segregated — balances never mix.
      </p>

      {error ? <p className="alert">{error}</p> : null}

      {data ? (
        <>
          <div className="tenant-compare" role="list">
            <TenantColumn tenant={data.tenants.A} accent="A" />
            <TenantColumn tenant={data.tenants.B} accent="B" />
          </div>

          <h3 className="admin-subhead">Shared player_id proof</h3>
          <div className="tenant-shared-proof">
            <p>
              Player <code>{data.shared_player_id_proof.player_id}</code> —{' '}
              {data.shared_player_id_proof.note}
            </p>
            <div className="tenant-shared-grid">
              <div>
                <span className="tenant-pill">A</span>
                <strong>
                  {formatUsdc(data.shared_player_id_proof.A.balance.available, 2)} USDC
                </strong>
              </div>
              <div>
                <span className="tenant-pill tenant-pill-b">B</span>
                <strong>
                  {formatUsdc(data.shared_player_id_proof.B.balance.available, 2)} USDC
                </strong>
              </div>
            </div>
            <p className={data.shared_player_id_proof.balances_equal ? 'alert' : 'ok-line'}>
              {data.shared_player_id_proof.balances_equal
                ? 'Unexpected: balances match (isolation broken)'
                : 'OK — balances differ; operator_id keys keep ledgers apart'}
            </p>
          </div>

          <h3 className="admin-subhead">Sandbox credentials</h3>
          <div className="tenant-creds">
            <CredBlock label="Operator A" creds={data.credentials.A} />
            <CredBlock label="Operator B" creds={data.credentials.B} />
          </div>
        </>
      ) : !error ? (
        <p style={{ color: 'var(--ink-muted)' }}>Loading…</p>
      ) : null}
    </div>
  )
}

function TenantColumn({ tenant, accent }: { tenant: TenantSnapshot; accent: 'A' | 'B' }) {
  return (
    <article className={`tenant-card tenant-card-${accent.toLowerCase()}`} role="listitem">
      <header>
        <span className={`tenant-pill${accent === 'B' ? ' tenant-pill-b' : ''}`}>{accent}</span>
        <h3>{tenant.label}</h3>
        <code className="mono">{tenant.operator_id}</code>
      </header>
      <dl className="tenant-stats">
        <div>
          <dt>Available</dt>
          <dd>{formatUsdc(tenant.balances.available, 2)} USDC</dd>
        </div>
        <div>
          <dt>Reserved</dt>
          <dd>{formatUsdc(tenant.balances.reserved, 2)} USDC</dd>
        </div>
        <div>
          <dt>Players</dt>
          <dd>{tenant.counts.players}</dd>
        </div>
        <div>
          <dt>Bets</dt>
          <dd>{tenant.counts.bets}</dd>
        </div>
        <div>
          <dt>Deposits</dt>
          <dd>{tenant.counts.deposits}</dd>
        </div>
        <div>
          <dt>Journal</dt>
          <dd>{tenant.counts.journal_entries}</dd>
        </div>
      </dl>
      <h4 className="admin-subhead">Players</h4>
      <ul className="tenant-player-list">
        {tenant.players.map((p) => (
          <li key={`${tenant.operator_id}:${p.player_id}`}>
            <code>{p.player_id}</code>
            <span>{formatUsdc(p.balance.available, 2)} USDC</span>
          </li>
        ))}
      </ul>
    </article>
  )
}

function CredBlock({
  label,
  creds,
}: {
  label: string
  creds: {
    operator_id: string
    client_id: string
    client_secret: string
    player_id: string
  }
}) {
  return (
    <div className="tenant-cred-block">
      <h4>{label}</h4>
      <ul>
        <li>
          <span>operator_id</span>
          <code>{creds.operator_id}</code>
        </li>
        <li>
          <span>client_id</span>
          <code>{creds.client_id}</code>
        </li>
        <li>
          <span>client_secret</span>
          <code>{creds.client_secret}</code>
        </li>
        <li>
          <span>player_id</span>
          <code>{creds.player_id}</code>
        </li>
      </ul>
    </div>
  )
}
