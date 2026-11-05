import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { msw } from 'msw/vite'

export default defineConfig({
  plugins: [react(), msw()],
  server: {
    port: 5173,
    host: true,
  },
})
