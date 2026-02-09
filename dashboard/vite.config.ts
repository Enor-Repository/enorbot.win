import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: '../dist/dashboard',
    emptyOutDir: false, // Keep TypeScript-compiled server files
  },
  server: {
    port: 3004,
    proxy: {
      '/api': {
        target: 'http://181.215.135.75:3004',
        changeOrigin: true,
      },
    },
  },
})
