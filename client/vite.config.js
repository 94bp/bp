// client/vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    server: {
        host: true,
        port: 5173,
        allowedHosts: ['finweb.loca.lt', 'localhost', '127.0.0.1'],
        hmr: {
            host: 'finweb.loca.lt',
            protocol: 'wss',   // ws mbi https => wss
            clientPort: 443
        }
    }
})
