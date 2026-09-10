import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    // Preserve the browser targets used before the Vite 8 upgrade.
    target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14']
  },
  server: {
    host: '0.0.0.0',
    port: 3013,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5679',
        changeOrigin: true,
        proxyTimeout: 600000,
        timeout: 600000
      },
      '/static': {
        target: 'http://127.0.0.1:5679',
        changeOrigin: true
      }
    }
  }
})
