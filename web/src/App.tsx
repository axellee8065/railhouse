import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { SessionProvider } from './context/SessionContext'
import { Shell } from './components/Shell'
import { AdminShell } from './components/AdminShell'
import { Lobby } from './pages/Lobby'
import { HelloDice } from './pages/HelloDice'
import { Limbo } from './pages/Limbo'
import { CoinFlip } from './pages/CoinFlip'
import { RgsMock } from './pages/RgsMock'
import { Wallet } from './pages/Wallet'
import { Fairness } from './pages/Fairness'
import { Account } from './pages/Account'
import { AdminDashboard } from './pages/AdminDashboard'
import { AdminPlayers } from './pages/AdminPlayers'
import { AdminBets } from './pages/AdminBets'
import { AdminDeposits } from './pages/AdminDeposits'
import { AdminWithdrawals } from './pages/AdminWithdrawals'
import { AdminAudit } from './pages/AdminAudit'
import { AdminTenants } from './pages/AdminTenants'

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Lobby />} />
            <Route path="play/hello-dice" element={<HelloDice />} />
            <Route path="play/limbo" element={<Limbo />} />
            <Route path="play/coin-flip" element={<CoinFlip />} />
            <Route path="play/rgs-mock" element={<RgsMock />} />
            <Route path="wallet" element={<Wallet />} />
            <Route path="admin" element={<AdminShell />}>
              <Route index element={<AdminDashboard />} />
              <Route path="tenants" element={<AdminTenants />} />
              <Route path="players" element={<AdminPlayers />} />
              <Route path="bets" element={<AdminBets />} />
              <Route path="deposits" element={<AdminDeposits />} />
              <Route path="withdrawals" element={<AdminWithdrawals />} />
              <Route path="audit" element={<AdminAudit />} />
            </Route>
            <Route path="fairness" element={<Fairness />} />
            <Route path="account" element={<Account />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  )
}
