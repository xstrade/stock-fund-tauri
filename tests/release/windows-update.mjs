import assert from 'node:assert/strict'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'

const endpoint = 'http://127.0.0.1:9222/json/list'

async function waitFor(label, get, timeout = 90_000) {
  const deadline = Date.now() + timeout
  let lastError
  do {
    try {
      const value = await get()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await delay(1000)
  } while (Date.now() < deadline)
  throw new Error(`Timed out waiting for ${label}: ${lastError ?? 'condition was false'}`)
}

async function evaluate(expression) {
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(5000) })
  const pages = await response.json()
  const page = pages.find(({ url }) => url.includes('tauri.localhost'))
  if (!page) throw new Error(`Tauri page absent. Titles: ${pages.map(({ title }) => title).join(', ')}`)
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  try {
    await once(socket, 'open', { signal: AbortSignal.timeout(5000) })
    const reply = once(socket, 'message', { signal: AbortSignal.timeout(5000) })
    socket.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true },
    }))
    const [{ data }] = await reply
    const message = JSON.parse(data)
    if (message.error || message.result.exceptionDetails) {
      throw new Error(JSON.stringify(message.error ?? message.result.exceptionDetails))
    }
    return message.result.result.value
  } finally {
    socket.close()
  }
}

const version = () => evaluate("window.__TAURI_INTERNALS__.invoke('plugin:app|version')")
const readSettings = () => evaluate("JSON.parse(localStorage.getItem('desktop-settings'))")
await waitFor('v0.1.0 running', async () => await version() === '0.1.0')
await waitFor('Settings button', () => evaluate(`(() => {
  const button = document.querySelector('button[aria-label="设置"]:not(:disabled)')
  button?.click()
  return !!button
})()`))
await waitFor('settings saved', () => evaluate(`(() => {
  const form = [...document.forms].find((item) => item.textContent.includes('保存设置'))
  if (!form) return false
  for (const input of form.querySelectorAll('input[type="checkbox"]')) {
    if (!input.checked) input.click()
  }
  form.querySelector('button.primary').click()
  return true
})()`))
const before = await waitFor('settings persisted', async () => {
  const value = await readSettings()
  return value?.compact && value?.pinned ? value : null
})
console.log('v0.1.0 started and test settings saved.')

await waitFor('v0.1.1 available', () => evaluate("document.body.innerText.includes('发现新版本 0.1.1')"))
await evaluate("document.querySelector('.update-action').click()")
await waitFor('v0.1.1 relaunched by the installer', async () => await version() === '0.1.1', 240_000)
assert.deepEqual(await readSettings(), before)
console.log('v0.1.1 downloaded, installed and relaunched. All saved settings match.')
