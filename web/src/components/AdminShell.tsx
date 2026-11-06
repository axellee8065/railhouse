import { NavLink, Outlet } from 'react-router-dom'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'admin-nav-link active' : 'admin-nav-link'

/**
 * Nested admin console shell — DEMO / SANDBOX labeled.
 * Own-brand Railhouse chrome; not production IAM.
 */
export function AdminShell() {
  return (
    <section className="section admin-console" aria-labelledby="admin-console-title">
      <header className="admin-header">
        <div>
          <p className="admin-kicker">DEMO · SANDBOX · games:admin</p>
          <h2 id="admin-console-title">Admin console</h2>
          <p className="admin-lede">
            Players, bets, deposits, withdrawals, and an append-only audit stream. Studio
            client credentials only — not production IAM.
          </p>
        </div>
        <span className="admin-badge" aria-label="Sandbox environment">
          SANDBOX
        </span>
      </header>

      <nav className="admin-nav" aria-label="Admin sections">
        <NavLink to="/admin" end className={linkClass}>
          Dashboard
        </NavLink>
        <NavLink to="/admin/tenants" className={linkClass}>
          Tenants
        </NavLink>
        <NavLink to="/admin/players" className={linkClass}>
          Players
        </NavLink>
        <NavLink to="/admin/bets" className={linkClass}>
          Bets
        </NavLink>
        <NavLink to="/admin/deposits" className={linkClass}>
          Deposits
        </NavLink>
        <NavLink to="/admin/withdrawals" className={linkClass}>
          Withdrawals
        </NavLink>
        <NavLink to="/admin/audit" className={linkClass}>
          Audit log
        </NavLink>
      </nav>

      <Outlet />
    </section>
  )
}
