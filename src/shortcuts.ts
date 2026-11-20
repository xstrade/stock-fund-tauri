const mac = /Mac/.test(navigator.platform)
const modifiers = [
  ['ctrlKey', 'Ctrl', /^(ctrl|control)$/i],
  ['altKey', 'Alt', /^(alt|option)$/i],
  ['shiftKey', 'Shift', /^shift$/i],
  ['metaKey', 'Super', /^(cmd|command|super|meta|win)$/i],
] as const
const keys = [
  'Backquote `', 'Backslash \\', 'BracketLeft [', 'BracketRight ]', 'Comma ,', 'Equal =',
  'Minus -', 'Period .', "Quote '", 'Semicolon ;', 'Slash /',
  'ArrowLeft Left', 'ArrowRight Right', 'ArrowUp Up', 'ArrowDown Down',
  'Escape Esc', 'Pause PauseBreak', 'Backspace', 'CapsLock', 'Enter', 'Space', 'Tab',
  'Delete', 'End', 'Home', 'Insert', 'PageDown', 'PageUp', 'PrintScreen', 'ScrollLock', 'NumLock',
  'NumpadAdd NumAdd NumpadPlus NumPlus', 'NumpadDecimal NumDecimal', 'NumpadDivide NumDivide',
  'NumpadEnter NumEnter', 'NumpadEqual NumEqual', 'NumpadMultiply NumMultiply', 'NumpadSubtract NumSubtract',
  'AudioVolumeDown VolumeDown', 'AudioVolumeUp VolumeUp', 'AudioVolumeMute VolumeMute',
  'MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop', 'MediaTrackNext', 'MediaTrackPrevious MediaTrackPrev',
]
const namedKeys = new Map(keys.flatMap((entry) => {
  const names = entry.split(' ')
  return names.map((name) => [name.toUpperCase(), names[0]] as const)
}))

function normalizeKey(key: string) {
  const value = key.toUpperCase()
  if (/^(KEY)?[A-Z]$|^(DIGIT)?[0-9]$/.test(value)) return value.slice(-1)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(value)) return value
  if (/^NUM(PAD)?[0-9]$/.test(value)) return `Numpad${value.slice(-1)}`
  return namedKeys.get(value)
}

export function normalizeShortcut(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return ''
  const parts = value.split('+').map((part) => part.trim())
  const key = normalizeKey(parts.pop() ?? '')
  if (!key) return null
  const active = new Set<string>()
  for (const part of parts) {
    const name = /^(command|cmd)or(control|ctrl)$/i.test(part)
      ? (mac ? 'Super' : 'Ctrl')
      : modifiers.find(([, , pattern]) => pattern.test(part))?.[1]
    if (!name) return null
    active.add(name)
  }
  return [...modifiers.map(([, name]) => name).filter((name) => active.has(name)), key].join('+')
}

export function shortcutFromEvent(event: KeyboardEvent) {
  const key = normalizeKey(event.code)
  if (!key || event.isComposing || event.getModifierState('AltGraph')) return ''
  return [...modifiers.filter(([property]) => event[property]).map(([, name]) => name), key].join('+')
}
