import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

async function enableMocking() {
  const base = import.meta.env.VITE_API_BASE_URL?.trim()
  const forceMsw = import.meta.env.VITE_FORCE_MSW === '1'
  const useMsw = import.meta.env.DEV && (forceMsw || !base)

  if (!useMsw) return

  const { network } = await import('virtual:msw')
  const { handlers } = await import('./mocks/handlers')
  network.configure({ handlers })
  await network.enable()
}

void enableMocking().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
