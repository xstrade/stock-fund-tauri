import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'

export { isTauri }

export function desktopCommand<T>(command: string, args?: Record<string, unknown>): Promise<T | undefined> {
  return isTauri() ? invoke<T>(command, args) : Promise.resolve(undefined)
}

export function windowAction(...[action, value]: ['setAlwaysOnTop', boolean] | ['setSize', LogicalSize]) {
  if (!isTauri()) return Promise.resolve()
  const window = getCurrentWindow()
  return action === 'setSize' ? window.setSize(value) : window.setAlwaysOnTop(value)
}

export function resizeWindow(width: number, height: number) {
  return windowAction('setSize', new LogicalSize(width, height))
}

type TrayAction = 'settings' | 'watchlist' | 'watchlist-focused' | 'login'

export function listenTray(handler: (action: TrayAction) => void) {
  return isTauri() ? listen<TrayAction>('tray-action', ({ payload }) => handler(payload)) : Promise.resolve(() => {})
}
