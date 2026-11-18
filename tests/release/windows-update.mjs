import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'

const endpoint = 'http://127.0.0.1:9222'

async function connect(version) {
  let result
  await expect.poll(async () => {
    let browser
    try {
      browser = await chromium.connectOverCDP(endpoint, { timeout: 2000 })
      const page = browser.contexts()[0]?.pages().find((target) => target.url().includes('tauri.localhost'))
      const current = await page?.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|version'))
      if (current === version) {
        result = { browser, page }
        return current
      }
    } catch {
      // The installer closes the original WebView before starting the new one.
    }
    await browser?.close().catch(() => {})
  }, { timeout: 180_000 }).toBe(version)
  return result
}

const old = await connect('0.1.0')
const settings = old.page.getByRole('button', { name: '设置', exact: true })
await settings.click()
await old.page.getByLabel('精简列表', { exact: true }).check()
await old.page.getByLabel('窗口置顶', { exact: true }).check()
await old.page.getByRole('button', { name: '保存设置' }).click()
const readSettings = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('desktop-settings')))
const before = await readSettings(old.page)
assert.equal(before.compact, true)
assert.equal(before.pinned, true)
console.log('v0.1.0 started and test settings saved.')

await expect(old.page.getByText('发现新版本 0.1.1')).toBeVisible({ timeout: 100_000 })
const install = old.page.getByRole('button', { name: '下载并安装' })
await install.click({ noWaitAfter: true }).catch((error) => {
  if (!/closed|destroyed/i.test(String(error))) throw error
})
const updated = await connect('0.1.1')
assert.deepEqual(await readSettings(updated.page), before)
await updated.page.getByRole('button', { name: '设置', exact: true }).click()
await expect(updated.page.getByLabel('精简列表', { exact: true })).toBeChecked()
await expect(updated.page.getByLabel('窗口置顶', { exact: true })).toBeChecked()
console.log('v0.1.1 downloaded, installed, and relaunched. All saved settings match.')
await updated.browser.close()
await old.browser.close().catch(() => {})
