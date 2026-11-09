import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        external: ['better-sqlite3-multiple-ciphers'],
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          cli: resolve(__dirname, 'src/main/cli.ts'),
          'derived-learnings': resolve(__dirname, 'src/main/services/derived-learnings.ts'),
          'mcp-keys': resolve(__dirname, 'src/main/services/security/keys.ts'),
          'mcp/whatsapp-server': resolve(__dirname, 'src/main/mcp/whatsapp-server.ts'),
          'mcp/telegram-server': resolve(__dirname, 'src/main/mcp/telegram-server.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})
