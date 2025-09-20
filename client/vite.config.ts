// client/vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,          // lejo akses nga jashtë (jo vetëm localhost)
    port: 5173,          // ndrysho nëse përdor port tjetër
    allowedHosts: [
      'finweb.loca.lt',  // domeni i LocalTunnel që po përdor
      'localhost',
      '127.0.0.1'
    ],
    // Kjo ndihmon HMR/WebSocket kur kalon përmes HTTPS të loca.lt
    hmr: {
      host: 'finweb.loca.lt',
      protocol: 'https',
      port: 443
    }
  }
})
