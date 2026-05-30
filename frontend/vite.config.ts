import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBase = env.VITE_API_BASE_URL || 'http://localhost:8000'

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: env.VITE_API_BASE_URL ? {} : {
        '/api': { target: 'http://localhost:8000', changeOrigin: true },
        '/renders': { target: 'http://localhost:8000', changeOrigin: true },
      },
    },
    // Copy sw.js and manifest.json from public/ without hashing
    // so the service worker URL is always /sw.js
    build: {
      rollupOptions: {
        output: {
          // Ensure assets are fingerprinted for cache busting
          assetFileNames: 'assets/[name].[hash][extname]',
          chunkFileNames: 'assets/[name].[hash].js',
          entryFileNames: 'assets/[name].[hash].js',
        },
      },
    },
  }
})
