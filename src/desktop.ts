import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'

export { isTauri }

export function desktopCommand<T>(command: string, args?: Record<string, unknown>): Promise<T | undefined> {
  return isTauri() ? invoke<T>(command, args) : Promise.resolve(undefined)
}

export function windowAction(...[action, value]: ['setAlwaysOnTop', boolean] | ['minimize' | 'close']) {
  if (!isTauri()) return Promise.resolve()
  const window = getCurrentWindow()
  return action === 'setAlwaysOnTop' ? window.setAlwaysOnTop(value) : window[action]()
}

export async function setWindowLayout(compact: boolean) {
  if (!isTauri()) return
  const window = getCurrentWindow()
  const size = compact ? new LogicalSize(230, 365) : new LogicalSize(390, 510)
  const minimum = compact ? new LogicalSize(230, 260) : new LogicalSize(290, 260)
  await window.setDecorations(!compact)
  await window.setShadow(!compact)
  await window.setMinSize(minimum)
  await window.setSize(size)
}

type TrayAction = 'settings' | 'watchlist' | 'watchlist-focused' | 'login'

export function listenTray(handler: (action: TrayAction) => void) {
  return isTauri() ? listen<TrayAction>('tray-action', ({ payload }) => handler(payload)) : Promise.resolve(() => {})
}
