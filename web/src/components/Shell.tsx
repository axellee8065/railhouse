import { NavLink, Outlet } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
import { usdcLabel } from '../lib/format'

const linkClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : undefined)

export function Shell() {
  const { balance, ready, error } = useSession()

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="Railhouse home">
          <span className="brand-mark" aria-hidden>
            R
          </span>
          <span>
            <span className="brand-name">Railhouse</span>
            <span className="brand-sub">Casino Rail PoC</span>
          </span>
        </NavLink>

        <nav className="nav" aria-label="Primary">
          <NavLink to="/" end className={linkClass}>
            Lobby
          </NavLink>
          <NavLink to="/play/hello-dice" className={linkClass}>
            Dice
          </NavLink>
          <NavLink to="/play/rgs-mock" className={linkClass}>
            RGS
          </NavLink>
          <NavLink to="/wallet" className={linkClass}>
            Wallet
          </NavLink>
          <NavLink to="/fairness" className={linkClass}>
            Fairness
          </NavLink>
          <NavLink to="/account" className={linkClass}>
            Account
          </NavLink>
        </nav>

        <div className="balance-chip" title="Sandbox USDC on Sui testnet">
          <strong>{ready && balance ? usdcLabel(balance) : '—'}</strong>
        </div>
      </header>

      <p className="demo-banner">
        DEMO / NOT AFFILIATED WITH STAKE OR EASYGO — Sui testnet USDC sandbox. Operator
        self-custody: Railhouse never sole-signs your withdrawals.
      </p>

      {error ? <p className="alert">{error}</p> : null}
      <Outlet />

      <footer className="footer-note">
        Built for Casino Rail PoC · Ages 18+ · Responsible play · Virtual funds only
      </footer>
    </div>
  )
}
