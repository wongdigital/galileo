import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import packageJson from './package.json'

const ELECTRON_CONNECT_SRC = "connect-src 'self'"
const PROVIDER_ORIGINS = [
  'https://api.anthropic.com',
  'https://api.openai.com',
  'https://openrouter.ai',
]

/** Electron's source CSP remains locked down. Only the web build may contact
 * Sched and supported browser-callable model providers. Exact replacement
 * makes source-policy drift a build failure instead of silently weakening it. */
function webContentSecurityPolicy(schedOrigin: string): Plugin {
  const webConnectSrc = `${ELECTRON_CONNECT_SRC} ${schedOrigin} ${PROVIDER_ORIGINS.join(' ')}`
  return {
    name: 'galileo-web-content-security-policy',
    transformIndexHtml(html) {
      const matches = html.split(ELECTRON_CONNECT_SRC).length - 1
      if (matches !== 1) {
        throw new Error(`Expected exactly one Electron connect-src in index.html; found ${matches}.`)
      }
      return html.replace(ELECTRON_CONNECT_SRC, webConnectSrc)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const site = env.VITE_SCHED_SITE ?? 'https://comiccon2026.sched.com'
  const schedOrigin = new URL(site).origin

  return {
    root: resolve('src/renderer'),
    plugins: [react(), tailwindcss(), webContentSecurityPolicy(schedOrigin)],
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
        '@data': resolve('data'),
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version),
      __SCHED_SITE__: JSON.stringify(site),
    },
    build: {
      outDir: resolve('dist-web'),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve('src/renderer/index.html'),
      },
    },
  }
})
