import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    // Ship straight into the backend's static dir — `npm run build` here is what `fastify-static` serves.
    outDir: '../public',
    emptyOutDir: true,
  },
})
