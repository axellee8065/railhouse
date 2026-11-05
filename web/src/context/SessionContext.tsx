import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { api } from '../lib/api/client'
import type { Balance, LaunchSession, PlayerAccount } from '../lib/types'

const PLAYER: PlayerAccount = {
  player_id: 'player_demo_42',
  display_name: 'Rail Demo',
  email: 'demo@railhouse.demo',
  chain: 'sui-testnet',
  custody: 'operator-self',
}

type SessionContextValue = {
  player: PlayerAccount
  session: LaunchSession | null
  balance: Balance | null
  ready: boolean
  error: string | null
  ensureSession: (gameId?: string) => Promise<LaunchSession>
  refreshBalance: () => Promise<void>
  applyBalance: (next: Pick<Balance, 'available' | 'reserved' | 'minor_unit'>) => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<LaunchSession | null>(null)
  const [balance, setBalance] = useState<Balance | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sessionRef = useRef<LaunchSession | null>(null)
  const launchPromiseRef = useRef<Promise<LaunchSession> | null>(null)

  const ensureSession = useCallback(async (gameId = 'hello_dice') => {
    if (sessionRef.current) return sessionRef.current
    if (launchPromiseRef.current) return launchPromiseRef.current

    launchPromiseRef.current = (async () => {
      const launched = await api.launch({
        player_id: PLAYER.player_id,
        game_id: gameId,
      })
      sessionRef.current = launched
      setSession(launched)
      setBalance(launched.balance)
      setError(null)
      return launched
    })()

    try {
      return await launchPromiseRef.current
    } finally {
      launchPromiseRef.current = null
    }
  }, [])

  const refreshBalance = useCallback(async () => {
    const current = sessionRef.current
    if (!current) return
    const next = await api.balance(current.session_id, current.launch_token)
    setBalance(next)
  }, [])

  const applyBalance = useCallback(
    (next: Pick<Balance, 'available' | 'reserved' | 'minor_unit'>) => {
      setBalance((prev) => ({
        currency: prev?.currency ?? 'USD',
        asset: 'USDC',
        available: next.available,
        reserved: next.reserved,
        minor_unit: next.minor_unit,
        total: next.available + next.reserved,
        updated_at: new Date().toISOString(),
      }))
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await ensureSession('hello_dice')
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to launch session')
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ensureSession])

  const value = useMemo(
    () => ({
      player: PLAYER,
      session,
      balance,
      ready,
      error,
      ensureSession,
      refreshBalance,
      applyBalance,
    }),
    [session, balance, ready, error, ensureSession, refreshBalance, applyBalance],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}
