import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Opcionales, para servir el dev server detras de un reverse proxy HTTPS
// (Contabo 1, ver RECETA-DESARROLLO.md). Sin definir = comportamiento previo.
const allowedHosts = (process.env.VITE_ALLOWED_HOSTS || '')
  .split(',').map((h) => h.trim()).filter(Boolean)
const hmrClientPort = Number(process.env.VITE_HMR_CLIENT_PORT) || undefined

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    ...(allowedHosts.length ? { allowedHosts } : {}),
    ...(hmrClientPort ? { hmr: { clientPort: hmrClientPort } } : {}),
  }
})
