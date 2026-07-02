import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // Vendor chunking: split the heavy libs into separate, independently
        // cacheable chunks so the entry chunk stays small and the big deps
        // (wallet-adapter / web3.js / the SDK) cache across route navigations
        // and deploys. Purely a bundling detail — no runtime behavior change.
        manualChunks(id) {
          // @kassandra/sdk resolves via the workspace to sdk/dist (NOT
          // node_modules), so key on either the package name or the dist path.
          if (id.includes('@kassandra/sdk') || id.includes('/sdk/dist/')) {
            return 'sdk'
          }
          // Solana: wallet-adapter, web3.js, and their low-level deps (ox,
          // @noble/*, etc.) — the bulk of the third-party weight.
          if (
            id.includes('@solana/') ||
            id.includes('node_modules/ox/') ||
            id.includes('node_modules/@noble/') ||
            id.includes('node_modules/@solana-mobile/') ||
            id.includes('node_modules/@wallet-standard/') ||
            id.includes('node_modules/jayson/') ||
            id.includes('node_modules/rpc-websockets/')
          ) {
            return 'solana'
          }
          // React runtime + router — small, stable, cache-friendly vendor chunk.
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router-dom/') ||
            id.includes('node_modules/react-router/') ||
            id.includes('node_modules/scheduler/')
          ) {
            return 'react-vendor'
          }
        },
      },
    },
  },
})
