import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'

export function desktopCommand(command, args) {
  return isTauri() ? invoke(command, args) : Promise.resolve()
}

export function windowAction(action, value) {
  return isTauri() ? getCurrentWindow()[action](value) : Promise.resolve()
}

export function resizeWindow(width, height) {
  return windowAction('setSize', new LogicalSize(width, height))
}

export function listenTray(handler) {
  return isTauri() ? listen('tray-action', ({ payload }) => handler(payload)) : Promise.resolve(() => {})
}
