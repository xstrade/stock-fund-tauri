import { defineConfig } from '@playwright/test'

const demoUrl = 'http://127.0.0.1:1426'
const liveUrl = 'http://127.0.0.1:1427'

export default defineConfig({
  testDir: './tests/e2e',
  forbidOnly: !!process.env.CI,
  use: {
    channel: 'chrome',
    headless: true,
    viewport: { width: 390, height: 510 },
  },
  webServer: [
    { command: 'vite --host 127.0.0.1 --port 1426 --strictPort', url: demoUrl, env: { VITE_DEMO_MODE: 'true' } },
    {
      command: 'vite --host 127.0.0.1 --port 1427 --strictPort',
      url: liveUrl,
      env: {
        VITE_DEMO_MODE: 'false',
        VITE_API_BASE: 'https://api.hqzs.top/apis/',
        VITE_HISTORY_URL: '',
      },
    },
  ],
  projects: [
    { name: '离线自选', testMatch: 'watchlist.spec.js', use: { baseURL: demoUrl } },
    { name: '真实模式模拟服务', testMatch: 'market.spec.js', use: { baseURL: liveUrl } },
  ],
})
