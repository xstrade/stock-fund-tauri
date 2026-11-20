import { computed, onMounted, ref } from 'vue'
import { desktopCommand } from './desktop'
import defaultIcon from '../src-tauri/tray.png'
import obsidianIcon from './icons/tray-obsidian.svg'

const storageKey = 'desktop-tray-icon'
const size = 32
const presets = {
  default: { label: '默认图标', url: defaultIcon },
  obsidian: { label: 'Obsidian 水晶', url: obsidianIcon },
}
const trayOptions = Object.entries(presets).map(([id, { label }]) => ({ id, label }))

type PresetId = keyof typeof presets
type IconPreference = { id: PresetId; custom?: string } | { id: 'custom'; custom: string }

function isPresetId(id: unknown): id is PresetId {
  return trayOptions.some(option => option.id === id)
}

function readPreference(): IconPreference {
  try {
    const stored: { id?: unknown; custom?: unknown } | null = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    const custom = typeof stored?.custom === 'string' && stored.custom.length <= 8192 &&
      stored.custom.startsWith('data:image/png;base64,') ? stored.custom : undefined
    if (stored?.id === 'custom' && custom) return { id: 'custom', custom }
    return { id: isPresetId(stored?.id) ? stored.id : 'default', custom }
  } catch {
    // An unreadable preference falls back to the bundled icon.
  }
  return { id: 'default' }
}

function rasterize(source: string, padding = 0) {
  return new Promise<{ canvas: HTMLCanvasElement; pixels: Uint8ClampedArray }>((resolve, reject) => {
    const image = new Image()
    image.onerror = () => reject(new Error('无法读取这张图片'))
    image.onload = () => {
      try {
        const { naturalWidth: width, naturalHeight: height } = image
        if (!width || !height || Math.max(width, height) > 4096) {
          throw new Error('图片宽高须在 1–4096 像素之间')
        }
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size
        const context = canvas.getContext('2d')
        if (!context) throw new Error('无法处理这张图片')
        const scale = (size - padding * 2) / Math.max(width, height)
        const drawWidth = width * scale
        const drawHeight = height * scale
        context.drawImage(image, (size - drawWidth) / 2, (size - drawHeight) / 2, drawWidth, drawHeight)
        const pixels = context.getImageData(0, 0, size, size).data
        if (!pixels.some((channel, index) => index % 4 === 3 && channel > 0)) {
          throw new Error('图片没有可见内容')
        }
        resolve({ canvas, pixels })
      } catch (error) {
        reject(error)
      }
    }
    image.src = source
  })
}

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('无法读取图片文件'))
    }
    reader.onerror = () => reject(new Error('无法读取图片文件'))
    reader.readAsDataURL(file)
  })
}

function iconSource(preference: IconPreference) {
  return preference.id === 'custom' ? preference.custom : presets[preference.id].url
}

async function applyPreference(preference: IconPreference) {
  const { id } = preference
  const rgba = id === 'default' ? null : Array.from((await rasterize(iconSource(preference))).pixels)
  await desktopCommand('set_tray_icon', { rgba })
}

export function useTrayIcon() {
  const preference = ref(readPreference())
  const pending = ref(true)
  const error = ref('')
  const preview = computed(() => iconSource(preference.value))

  onMounted(async () => {
    try {
      if (preference.value.id !== 'default') await applyPreference(preference.value)
    } catch (reason) {
      preference.value = { id: 'default' }
      error.value = `无法恢复菜单栏图标：${(reason as { message?: string } | null)?.message || reason}`
    } finally {
      pending.value = false
    }
  })

  async function change(getNext: () => IconPreference | Promise<IconPreference>) {
    if (pending.value) return
    pending.value = true
    error.value = ''
    try {
      const next = await getNext()
      await applyPreference(next)
      try {
        localStorage.setItem(storageKey, JSON.stringify(next))
      } catch (reason) {
        await applyPreference(preference.value)
        throw reason
      }
      preference.value = next
    } catch (reason) {
      error.value = `无法更换菜单栏图标：${(reason as { message?: string } | null)?.message || reason}`
    } finally {
      pending.value = false
    }
  }

  function select(event: Event) {
    const input = event.target
    if (!(input instanceof HTMLSelectElement)) return
    const id = input.value
    input.value = preference.value.id
    const { custom } = preference.value
    if (isPresetId(id)) return change(() => ({ id, custom }))
    if (id === 'custom' && custom) {
      return change(() => ({ id, custom }))
    }
  }

  function upload(event: Event) {
    const input = event.target
    if (!(input instanceof HTMLInputElement)) return
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    return change(async () => {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
        throw new Error('请选择 2 MB 以内的 PNG、JPEG 或 WebP 图片')
      }
      const { canvas } = await rasterize(await readFile(file), 2)
      return { id: 'custom', custom: canvas.toDataURL('image/png') }
    })
  }

  return { preference, preview, pending, error, trayOptions, select, upload }
}
