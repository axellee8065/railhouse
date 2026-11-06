import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { SessionProvider } from './context/SessionContext'
import { Shell } from './components/Shell'
import { Lobby } from './pages/Lobby'
import { HelloDice } from './pages/HelloDice'
import { Limbo } from './pages/Limbo'
import { CoinFlip } from './pages/CoinFlip'
import { RgsMock } from './pages/RgsMock'
import { Wallet } from './pages/Wallet'
import { Fairness } from './pages/Fairness'
import { Account } from './pages/Account'
import { AdminWithdrawals } from './pages/AdminWithdrawals'

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
            <Route path="admin/withdrawals" element={<AdminWithdrawals />} />
            <Route path="fairness" element={<Fairness />} />
            <Route path="account" element={<Account />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  )
}
