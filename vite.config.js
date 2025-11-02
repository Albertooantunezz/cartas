import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
    server: {
    proxy: {
      // Todo lo que empiece por /api se reenvía a Vercel (puerto 3000)
      '/api': 'http://localhost:3000'
    }
  }
  
})
