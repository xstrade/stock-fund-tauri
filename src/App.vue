<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { desktopCommand, isTauri, listenTray, setWindowLayout, windowAction } from './desktop'
import { normalizeShortcut, shortcutFromEvent } from './shortcuts'
import { useTrayIcon } from './trayIcon'
import WatchlistSparkline from './WatchlistSparkline.vue'
import UpdatePanel from './UpdatePanel.vue'
import settingsIcon from './icons/settings.svg'
import searchIcon from './icons/search.svg'
import pinIcon from './icons/pin.svg'
import minimizeIcon from './icons/minus.svg'
import closeIcon from './icons/x.svg'
import deleteIcon from './icons/trash.svg'
import {
  addSymbol, applyQuotes, deleteSymbol, demo, loadGroups, login,
  loadQuotes, saveDemoGroups, searchSymbols, sessionScope, sortSymbols, symbolKey,
} from './market'
import type { GroupId, Session, Stock, WatchlistGroup } from './market'

type Panel = 'startup' | 'login' | 'list' | 'settings'
type LegacySettings = {
  config?: { stockView?: unknown; startToTop?: unknown; viewTransparency?: unknown }
  shortcutKey?: { windowShow?: { switch?: unknown; keyPad?: unknown } }
}

const defaults = {
  compact: false, pinned: false, opacity: 95,
  shortcut: 'Alt+Z', previousGroupShortcut: '', nextGroupShortcut: '',
}
const shortcutFields = [
  ['shortcut', '唤出自选页面'],
  ['previousGroupShortcut', '向左切换分组'],
  ['nextGroupShortcut', '向右切换分组'],
] as const
type ShortcutField = typeof shortcutFields[number][0]

function isShortcutField(value: unknown): value is ShortcutField {
  return shortcutFields.some(([field]) => field === value)
}

function readSettings(): typeof defaults {
  try {
    const stored: Partial<typeof defaults> | null = JSON.parse(localStorage.getItem('desktop-settings') || '{}')
    return { ...defaults, ...stored }
  } catch {
    return { ...defaults }
  }
}
const settings = ref(readSettings())
const settingsDraft = ref({ ...settings.value })
const {
  preference: trayIcon, preview: trayIconPreview, pending: trayIconPending,
  error: trayIconError, trayOptions, select: selectTrayIcon, upload: uploadTrayIcon,
} = useTrayIcon()
const activeShortcuts = computed(() => Object.fromEntries(shortcutFields.map(([field]) => [
  field, normalizeShortcut(settings.value[field]),
])))
const user = ref<Session | null>(null)
const skipRestoreKey = `skip-session-restore:${sessionScope}`
const groups = ref<WatchlistGroup[]>([])
const groupId = ref<GroupId | null>(null)
const group = computed(() => groups.value.find((item) => item.group_id === groupId.value))
const rows = computed(() => group.value?.position ?? [])
const selectedKey = ref('')
const selected = computed(() => rows.value.find((item) => symbolKey(item) === selectedKey.value))
const subscription = computed(() => rows.value.map(symbolKey).join(','))
const panel = ref<Panel>(demo ? 'list' : 'startup')
const listVisible = computed(() => panel.value === 'list' && !selected.value)
const compactList = computed(() => listVisible.value && settings.value.compact)
const watchlist = ref<HTMLElement | null>(null)
const watchlistScope = computed(() => demo ? 'watchlist:demo' : user.value
  ? `watchlist:${sessionScope}:${user.value.accountId}`
  : null)
const lastGroupKey = computed(() => watchlistScope.value && `${watchlistScope.value}:group`)
const scrollKey = computed(() => watchlistScope.value && groupId.value != null
  ? `${watchlistScope.value}:scroll:${groupId.value}`
  : null)
let alive = true
let pendingResize = Promise.resolve()

watch(compactList, (compact) => {
  pendingResize = pendingResize.then(async () => {
    if (alive && compact === compactList.value) {
      await setWindowLayout(compact)
    }
  }).catch(report)
}, { immediate: true })

watch([lastGroupKey, groupId], ([key, id]) => {
  if (key && id != null) localStorage.setItem(key, String(id))
})

watch([watchlist, scrollKey], async ([list, key], _, onCleanup) => {
  if (!list || !key) return
  const savedTop = Number(localStorage.getItem(key)) || 0
  let active = true
  onCleanup(() => { active = false })
  await pendingResize
  if (active) list.scrollTop = savedTop
}, { flush: 'post' })

function saveListScroll(event: Event) {
  const list = watchlist.value
  if (list && event.currentTarget === list && scrollKey.value) {
    localStorage.setItem(scrollKey.value, String(list.scrollTop))
  }
}

function toggleCompact() {
  settings.value.compact = !settings.value.compact
  localStorage.setItem('desktop-settings', JSON.stringify(settings.value))
}

function toggleWindowPin() {
  return run(async () => {
    const pinned = !settings.value.pinned
    await windowAction('setAlwaysOnTop', pinned)
    settings.value.pinned = pinned
    localStorage.setItem('desktop-settings', JSON.stringify(settings.value))
  })
}
const form = ref({ account: '', password: '' })
const query = ref('')
const searchVisible = ref(false)
const searchInput = ref<HTMLInputElement | null>(null)

async function toggleSearch() {
  searchVisible.value = !searchVisible.value
  if (searchVisible.value) {
    await nextTick()
    searchInput.value?.focus()
  }
}
const results = ref<Stock[]>([])
const status = ref('')
const quoteStatus = ref('')
const busy = ref(false)
let unlisten: (() => void) | undefined

function expired(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code
  return code === '001' || code === '002'
}

function errorMessage(error: unknown) {
  return (error as { message?: string } | null)?.message || String(error)
}

async function report(error: unknown) {
  if (user.value && expired(error)) await signOut()

  status.value = errorMessage(error)
}

async function run(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  status.value = ''
  try {
    await action()
  } catch (error) {
    await report(error)
  } finally {
    busy.value = false
  }
}

async function refresh() {
  const incoming = await loadGroups(user.value)
  if (!demo) {
    const previousQuotes = new Map(groups.value.flatMap((entry) => entry.position ?? [])
      .filter((row) => 'price' in row || 'zdf' in row)
      .map((row) => [symbolKey(row), { price: row.price, zdf: row.zdf, metrics: row.metrics }]))
    for (const entry of incoming) {
      if (entry.position) entry.position = applyQuotes(entry.position, previousQuotes)
    }
  }
  groups.value = incoming
  if (!group.value) {
    const previous = lastGroupKey.value && localStorage.getItem(lastGroupKey.value)
    const saved = groups.value.find((item) => String(item.group_id) === previous)
    groupId.value = (saved ?? groups.value[0])?.group_id ?? null
  }
}

async function submitLogin() {
  await run(async () => {
    user.value = await login(form.value.account, form.value.password)
    try {
      await refresh()
      panel.value = 'list'
      try {
        await desktopCommand('save_session', { scope: sessionScope, session: user.value })
        localStorage.removeItem(skipRestoreKey)
      } catch (error) {
        await report(error)
      }
    } catch (error) {
      user.value = null
      throw error
    } finally {
      form.value.password = ''
    }
  })
}

async function restoreSession() {
  try {
    const saved = localStorage.getItem(skipRestoreKey)
      ? null
      : await desktopCommand<Session | null>('load_session', { scope: sessionScope })
    if (saved) {
      user.value = saved
      await refresh()
      panel.value = 'list'
      return
    }
  } catch (error) {
    await report(error)
    user.value = null
  }
  panel.value = 'login'
}

async function signOut() {
  user.value = null
  groups.value = []
  groupId.value = null
  selectedKey.value = ''
  results.value = []
  query.value = ''
  panel.value = 'login'
  localStorage.setItem(skipRestoreKey, '1')
  await desktopCommand('clear_session', { scope: sessionScope }).catch((error) => {
    status.value = String(error)
  })
}

async function search() {
  await run(async () => {
    results.value = []
    if (!query.value.trim()) return
    results.value = await searchSymbols(query.value.trim())
    if (!results.value.length) status.value = '没有匹配的股票'
  })
}

async function modify(action: 'add' | 'pin' | 'delete', row: Stock) {
  const current = group.value
  if (!current) return
  await run(async () => {
    const remaining = current.position.filter((item) => symbolKey(item) !== symbolKey(row))
    if (action === 'add' && remaining.length !== current.position.length) return
    const ordered = action === 'add' ? [...remaining, row] : action === 'pin' ? [row, ...remaining] : remaining
    if (demo) {
      current.position = ordered
      saveDemoGroups(groups.value)
    } else {
      if (action === 'add') {
        await addSymbol(user.value, {
          group_id: current.group_id, info_type: 1,
          info_name: row.info_name, info_code: row.info_code,
          info_market: row.info_market, stock_type: row.stock_type,
        })
      } else if (action === 'pin') {
        await sortSymbols(user.value, current.group_id, ordered.map((item) => item.info_id))
      } else {
        await deleteSymbol(user.value, current.group_id, row.info_id)
      }
      await refresh()
    }
    if (action === 'add') {
      results.value = []
      query.value = ''
    }
  })
}

function openSettings() {
  if (panel.value === 'settings') return
  settingsDraft.value = { ...settings.value }
  status.value = ''
  panel.value = 'settings'
}

function leaveSettings() {
  if (panel.value === 'settings') status.value = ''
  panel.value = demo || user.value ? 'list' : 'login'
}

function showWatchlist() {
  if (panel.value === 'startup') return
  selectedKey.value = ''
  leaveSettings()
}

function recordShortcut(event: KeyboardEvent, field: ShortcutField) {
  if (event.key === 'Tab' || event.repeat) return
  const shortcut = shortcutFromEvent(event)
  if (!shortcut || !shortcut.includes('+')) return
  event.preventDefault()
  settingsDraft.value[field] = shortcut
}

function handleKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.repeat) return
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')) return
  const shortcut = shortcutFromEvent(event)
  if (!shortcut) return
  if (!isTauri() && shortcut === activeShortcuts.value.shortcut) {
    event.preventDefault()
    showWatchlist()
    return
  }
  if (!listVisible.value || busy.value || groups.value.length < 2) return
  if (!shortcut.includes('+') && target?.closest('select')) return
  const direction = shortcut === activeShortcuts.value.previousGroupShortcut ? -1
    : shortcut === activeShortcuts.value.nextGroupShortcut ? 1 : 0
  if (!direction || !group.value) return
  const index = groups.value.indexOf(group.value)
  if (index < 0) return
  event.preventDefault()
  const count = groups.value.length
  groupId.value = groups.value[(index + direction + count) % count].group_id
}

async function importSettings(event: Event) {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  const file = input.files?.[0]
  if (!file) return
  try {
    if (file.size > 1024 * 1024) throw new Error('配置文件过大')
    const old: LegacySettings | null = JSON.parse(await file.text())
    if (!old?.config || typeof old.config !== 'object') throw new Error('无法识别旧版配置')
    const shortcut = old.shortcutKey?.windowShow
    const opacity = old.config.viewTransparency
    settingsDraft.value = {
      ...settingsDraft.value,
      compact: old.config.stockView === 'simple',
      pinned: old.config.startToTop === true,
      opacity: typeof opacity === 'number' && Number.isFinite(opacity) ? Math.max(0, Math.min(100, opacity)) : defaults.opacity,
      shortcut: shortcut?.switch === false ? '' :
        typeof shortcut?.keyPad === 'string' ? shortcut.keyPad.replace(/\s*\+\s*/g, '+') : defaults.shortcut,
    }
    status.value = '已读取旧版设置，请确认后保存'
  } catch (error) {
    report(error)
  } finally {
    input.value = ''
  }
}

function saveSettings() {
  return run(async () => {
    const next = { ...settingsDraft.value }
    const assigned = new Set<string>()
    for (const [field, label] of shortcutFields) {
      const shortcut = normalizeShortcut(next[field])
      if (shortcut === null) throw new Error(`「${label}」的快捷键格式不正确`)
      if (shortcut && assigned.has(shortcut)) throw new Error('三个快捷键不能重复')
      if (shortcut) assigned.add(shortcut)
      next[field] = shortcut
    }
    await desktopCommand('set_shortcut', { shortcut: next.shortcut || null })
    try {
      await windowAction('setAlwaysOnTop', next.pinned)
    } catch (error) {
      await desktopCommand('set_shortcut', { shortcut: activeShortcuts.value.shortcut || null })
      throw error
    }
    settings.value = next
    localStorage.setItem('desktop-settings', JSON.stringify(settings.value))
    leaveSettings()
  })
}

watch([groupId, subscription, user], ([, symbols, account], _, onCleanup) => {
  quoteStatus.value = ''
  if (demo || !symbols || !account) return
  const controller = new AbortController()
  const requested = symbols.split(',')
  let timer: ReturnType<typeof setTimeout> | undefined
  async function poll() {
    try {
      const quotes = await loadQuotes(requested, controller.signal)
      if (controller.signal.aborted) return
      const current = group.value
      if (current) current.position = applyQuotes(current.position, quotes)
      quoteStatus.value = ''
    } catch (error) {
      if (!controller.signal.aborted) quoteStatus.value = errorMessage(error)
    }
    if (!controller.signal.aborted) timer = setTimeout(poll, 15_000)
  }
  onCleanup(() => {
    controller.abort()
    clearTimeout(timer)
  })
  poll()
})

watch(() => rows.value.slice(0, 5).map((item) => {
  return `${item.info_name} ${item.price ?? '–'} ${item.zdf == null ? '–' : item.zdf + '%'}`
}).join('\n'), (tooltip) => {
  desktopCommand('update_tray', { tooltip: tooltip || '盯盘管家' }).catch(report)
}, { immediate: true })

onMounted(async () => {
  const cleanup = await listenTray((action) => {
    if (action === 'settings') openSettings()
    if (action === 'watchlist' || action === 'watchlist-focused') {
      const input = document.activeElement
      const field = action === 'watchlist-focused' && input instanceof HTMLElement && input.dataset.shortcutField
      if (isShortcutField(field)) settingsDraft.value[field] = activeShortcuts.value.shortcut ?? ''
      else showWatchlist()
    }
    if (action === 'login') {
      if (demo) status.value = '离线样本无需登录'
      else if (!busy.value && panel.value !== 'startup') run(signOut)
    }
  }).catch((error) => { report(error); return () => {} })
  if (!alive) {
    cleanup()
    return
  }
  unlisten = cleanup
  window.addEventListener('focus', refreshOnFocus)
  window.addEventListener('keydown', handleKeydown)
  await Promise.allSettled([
    desktopCommand('set_shortcut', { shortcut: activeShortcuts.value.shortcut || null }).catch(report),
    windowAction('setAlwaysOnTop', settings.value.pinned).catch(report),
    demo ? refresh().catch(report) : run(restoreSession),
  ])
})
function refreshOnFocus() {
  if (!demo && user.value && panel.value === 'list') run(refresh)
}

onUnmounted(() => {
  alive = false
  unlisten?.()
  window.removeEventListener('focus', refreshOnFocus)
  window.removeEventListener('keydown', handleKeydown)
})

const quoteNumber = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const compactQuoteNumber = new Intl.NumberFormat('zh-CN', { useGrouping: false, maximumFractionDigits: 4 })
const percentNumber = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
type QuoteValue = number | string | null | undefined
const hasQuote = (value: QuoteValue): value is number | string => value != null && value !== '' && Number.isFinite(Number(value))
const formatPrice = (value: QuoteValue) => hasQuote(value)
  ? (compactList.value ? compactQuoteNumber : quoteNumber).format(Number(value))
  : '–'
const formatChange = (value: QuoteValue) => hasQuote(value) ? `${Number(value) > 0 ? '+' : ''}${percentNumber.format(Number(value))}%` : '–'

const StockChart = defineAsyncComponent(() => import('./StockChart.vue'))
</script>

<template>
  <div class="shell" :class="{ compact: compactList }" :style="{ '--opacity': (panel === 'settings' ? settingsDraft.opacity : settings.opacity) / 100 }">
    <div v-if="!compactList" class="shell-glow" aria-hidden="true"></div>
    <header class="toolbar" aria-label="应用工具栏" :data-tauri-drag-region="compactList ? '' : null">
      <template v-if="compactList">
        <div class="compact-controls">
          <select v-model="groupId" class="group-select" aria-label="分组" title="切换分组" :disabled="busy || !groups.length">
            <option v-for="item in groups" :key="item.group_id" :value="item.group_id">{{ item.group_name }}</option>
          </select>
          <div class="window-drag-handle" data-tauri-drag-region title="拖动窗口"></div>
          <button type="button" class="icon-button" aria-label="精简模式" aria-pressed="true" title="展开完整模式" @click="toggleCompact"><img :src="settingsIcon" alt=""></button>
        </div>
        <div class="toolbar-actions">
          <button type="button" class="icon-button" :aria-expanded="searchVisible" :disabled="!group" aria-label="搜索股票" title="搜索股票" @click="toggleSearch"><img :src="searchIcon" alt=""></button>
          <button type="button" class="icon-button" :aria-pressed="settings.pinned" :disabled="busy" aria-label="窗口置顶" title="窗口置顶" @click="toggleWindowPin"><img :src="pinIcon" alt=""></button>
          <button type="button" class="icon-button" aria-label="最小化" title="最小化" @click="windowAction('minimize').catch(report)"><img :src="minimizeIcon" alt=""></button>
          <button type="button" class="icon-button" aria-label="隐藏到托盘" title="隐藏到托盘" @click="windowAction('close').catch(report)"><img :src="closeIcon" alt=""></button>
        </div>
      </template>
      <template v-else>
        <select v-if="listVisible" v-model="groupId" class="group-select" aria-label="分组" :disabled="busy || !groups.length">
          <option v-for="item in groups" :key="item.group_id" :value="item.group_id">{{ item.group_name }}</option>
        </select>
        <p v-else class="brand">盯盘管家</p>
        <div class="toolbar-actions">
          <button v-if="listVisible" type="button" class="layout-button" aria-label="精简模式" aria-pressed="false" @click="toggleCompact">精简</button>
          <span v-if="demo" class="mode">离线样本</span>
          <button v-if="listVisible" type="button" class="icon-button" :aria-expanded="searchVisible" :disabled="!group" aria-label="搜索股票" title="搜索股票" @click="toggleSearch"><img :src="searchIcon" alt=""></button>
          <button type="button" class="icon-button" :disabled="panel === 'startup'" aria-label="设置" title="设置" @click="openSettings"><img :src="settingsIcon" alt=""></button>
        </div>
      </template>
    </header>

    <main class="content">
      <UpdatePanel :visible="panel === 'settings'" />
      <p v-if="status" class="notice" role="status">{{ status }}</p>
      <p v-if="panel === 'startup'" class="notice panel-enter" role="status">正在恢复会话…</p>
      <form v-else-if="panel === 'login'" class="surface login panel-enter" @submit.prevent="submitLogin">
        <div class="panel-heading">
          <h1>登录盯盘管家</h1>
          <p class="muted">登录后查看你的自选股票。</p>
        </div>
        <label>账号<input v-model="form.account" required autocomplete="username"></label>
        <label>密码<input v-model="form.password" type="password" required autocomplete="current-password"></label>
        <button class="primary" :disabled="busy">{{ busy ? '正在登录…' : '登录' }}</button>
      </form>
      <form v-else-if="panel === 'settings'" class="surface settings panel-enter" @submit.prevent="saveSettings">
        <div class="panel-heading">
          <h1>应用设置</h1>
          <p class="muted">调整窗口显示、菜单栏图标与快捷键。</p>
        </div>
        <label class="setting-row"><span>精简列表</span><input v-model="settingsDraft.compact" type="checkbox"></label>
        <label class="setting-row"><span>窗口置顶</span><input v-model="settingsDraft.pinned" type="checkbox"></label>
        <label class="setting-row"><span>窗口不透明度</span><input v-model.number="settingsDraft.opacity" type="range" min="0" max="100"></label>
        <div class="tray-icon-settings">
          <label class="setting-row">
            <span>菜单栏图标</span>
            <img :src="trayIconPreview" alt="" width="20" height="20">
            <select :value="trayIcon.id" :disabled="trayIconPending" @change="selectTrayIcon">
              <option v-for="option in trayOptions" :key="option.id" :value="option.id">{{ option.label }}</option>
              <option v-if="trayIcon.custom" value="custom">自定义图片</option>
            </select>
          </label>
          <label class="tray-icon-upload">上传图标<input type="file" accept="image/png,image/jpeg,image/webp" :disabled="trayIconPending" @change="uploadTrayIcon"></label>
          <p class="muted">切换后立即生效。支持 2 MB 以内的 PNG、JPEG、WebP。</p>
          <p v-if="trayIconError" class="notice" role="status">{{ trayIconError }}</p>
        </div>
        <label v-for="[field, label] in shortcutFields" :key="field" class="setting-row">
          <span>{{ label }}</span>
          <input v-model="settingsDraft[field]" :data-shortcut-field="field" placeholder="未设置" autocomplete="off" spellcheck="false" @keydown="recordShortcut($event, field)">
        </label>
        <p class="muted">点击输入框后按下组合键，或输入如 Alt+Z。留空可停用。唤出键全局生效，分组键在自选页面生效。</p>
        <label class="import-settings">导入旧版设置<input type="file" accept=".json,application/json" @change="importSettings"></label>
        <div class="settings-actions">
          <button type="button" :disabled="busy" @click="leaveSettings">取消</button>
          <button class="primary" :disabled="busy">保存设置</button>
        </div>
      </form>
      <StockChart v-else-if="selected" :stock="selected" :initial-period="settings.compact ? 'intraday' : '1d'" @close="selectedKey = ''" />
      <section v-else ref="watchlist" class="watchlist" @scroll.passive="saveListScroll">
        <form v-if="group" v-show="searchVisible" class="search panel-enter" @submit.prevent="search" @keydown.esc="toggleSearch">
          <input ref="searchInput" v-model="query" aria-label="股票名称或代码" placeholder="股票名称或代码">
          <button :disabled="busy">搜索</button>
        </form>
        <ul v-if="searchVisible && results.length" class="surface results panel-enter">
          <li v-for="item in results" :key="symbolKey(item)">
            <span class="result-name">{{ item.info_name }} <small>{{ item.info_code }}</small></span>
            <button :disabled="busy" @click="modify('add', item)">添加</button>
          </li>
        </ul>
        <p v-if="quoteStatus" class="notice" role="status">{{ quoteStatus }}</p>
        <p v-if="!rows.length" class="surface empty">暂无自选</p>
        <div v-else class="surface quote-table">
          <ul class="quotes">
            <li v-for="(row, index) in rows" :key="symbolKey(row)" class="quote-row">
              <button class="stock" @click="selectedKey = symbolKey(row)">
                <span class="stock-name" :title="compactList ? row.info_name : undefined">{{ row.info_name }}</span>
                <small v-if="!compactList">{{ row.info_code }}</small>
              </button>
              <WatchlistSparkline v-if="!compactList" :row="row" :user="user" :group-id="groupId" />
              <div class="quote-values">
                <span class="quote-change" :class="{ down: Number(row.zdf) < 0, up: Number(row.zdf) > 0 }">{{ formatChange(row.zdf) }}</span>
                <span class="quote-price">{{ formatPrice(row.price) }}</span>
              </div>
              <div v-if="!compactList" class="quote-actions">
                <button :disabled="busy || index === 0" aria-label="置顶" title="置顶" @click="modify('pin', row)"><img :src="pinIcon" alt=""></button>
                <button class="remove" :disabled="busy" aria-label="删除" title="删除" @click="modify('delete', row)"><img :src="deleteIcon" alt=""></button>
              </div>
            </li>
          </ul>
        </div>
      </section>
    </main>
  </div>
</template>

<style>
:root {
  color-scheme: light;
  font: 13px/1.45 "IBM Plex Sans", "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", sans-serif;
  color: var(--ink);
  --ink: #1a2330;
  --muted: #667284;
  --line: rgba(26, 35, 48, 0.09);
  --line-strong: rgba(26, 35, 48, 0.14);
  --surface: rgba(255, 255, 255, 0.78);
  --surface-solid: #ffffff;
  --accent: #1f5f8b;
  --accent-deep: #174a6d;
  --accent-soft: rgba(31, 95, 139, 0.1);
  --up: #d63b4a;
  --up-soft: rgba(214, 59, 74, 0.1);
  --down: #0d8a6a;
  --down-soft: rgba(13, 138, 106, 0.1);
  --shadow-sm: 0 1px 2px rgba(26, 35, 48, 0.04);
  --shadow-md: 0 8px 24px rgba(26, 35, 48, 0.06);
  --radius: 10px;
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: transparent;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
button, input, select {
  font: inherit;
  color: inherit;
  background: var(--surface-solid);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  padding: 6px 9px;
  transition: background .18s var(--ease), border-color .18s var(--ease), box-shadow .18s var(--ease), color .18s var(--ease), transform .18s var(--ease);
}
button { cursor: pointer; white-space: nowrap; }
button:enabled:hover { background: #f0f4f8; border-color: rgba(31, 95, 139, 0.28); }
button:enabled:active { transform: translateY(0.5px); }
button:disabled { cursor: default; opacity: .42; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
input { min-width: 0; }
input:focus, select:focus {
  border-color: rgba(31, 95, 139, 0.45);
  box-shadow: 0 0 0 3px var(--accent-soft);
  outline: none;
}
input::placeholder, .muted, small { color: var(--muted); }
input[type=checkbox], input[type=range] { accent-color: var(--accent); }
h1 { margin: 0; font-size: 17px; font-weight: 650; letter-spacing: -0.02em; line-height: 1.3; }
p { margin: 0; }
ul { margin: 0; padding: 0; list-style: none; }

@keyframes panel-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes glow-drift {
  0%, 100% { opacity: .9; transform: translate3d(0, 0, 0) scale(1); }
  50% { opacity: 1; transform: translate3d(2%, -1%, 0) scale(1.03); }
}

.shell {
  position: relative;
  isolation: isolate;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background:
    linear-gradient(180deg, rgba(236, 242, 248, var(--opacity)), rgba(247, 249, 252, var(--opacity)));
}
.shell-glow {
  pointer-events: none;
  position: absolute;
  inset: -20% -10% auto;
  height: 55%;
  background:
    radial-gradient(55% 70% at 12% 18%, rgba(31, 95, 139, 0.14), transparent 70%),
    radial-gradient(45% 55% at 88% 8%, rgba(13, 138, 106, 0.08), transparent 68%);
  animation: glow-drift 14s ease-in-out infinite;
  z-index: 0;
}
.toolbar, .content { position: relative; z-index: 1; }
.toolbar {
  min-height: 44px;
  padding: 6px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid var(--line);
  background: rgba(255, 255, 255, calc(var(--opacity) * 0.55));
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}
.brand {
  margin: 0;
  font-size: 13px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--ink);
}
.mode {
  color: var(--accent-deep);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  padding: 3px 7px;
  border-radius: 6px;
  background: var(--accent-soft);
}
.toolbar-actions { display: flex; align-items: center; gap: 4px; margin-left: auto; }
.icon-button {
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  background: transparent;
  border-radius: 8px;
}
.icon-button:enabled:hover { background: var(--accent-soft); }
.icon-button img, .quote-actions img { width: 14px; height: 14px; display: block; margin: auto; opacity: .7; }
.icon-button:enabled:hover img { opacity: .95; }
.content { display: flex; flex: 1; flex-direction: column; gap: 8px; min-width: 0; min-height: 0; overflow: auto; }
.content > .notice { margin: 8px 10px 0; }
.group-select {
  min-width: 0;
  max-width: 60%;
  padding: 4px 8px;
  font-weight: 600;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.8);
}
.watchlist { flex: 1; min-width: 0; min-height: 0; overflow: auto; }
.layout-button {
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 8px;
  color: var(--accent-deep);
  background: rgba(255, 255, 255, 0.7);
}
.search {
  display: flex;
  gap: 6px;
  margin: 8px 10px;
}
.search input {
  flex: 1;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: var(--shadow-sm);
}
.search button {
  color: var(--accent);
  font-weight: 600;
  background: var(--accent-soft);
  border-color: transparent;
}
.search button:enabled:hover {
  background: rgba(31, 95, 139, 0.16);
  border-color: transparent;
}
.surface { background: var(--surface); }
.quote-table, .empty, .results, .login, .settings {
  margin: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: rgba(255, 255, 255, 0.72);
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
.notice {
  padding: 7px 10px;
  color: var(--accent-deep);
  background: linear-gradient(180deg, #eef5fb, #e8f0f8);
  border: 1px solid rgba(31, 95, 139, 0.12);
  border-radius: 8px;
  overflow-wrap: anywhere;
}
.watchlist > .notice { margin: 6px 10px; }
.empty {
  padding: 28px 12px;
  text-align: center;
  color: var(--muted);
  font-weight: 500;
}
.quote-table { margin-top: 6px; overflow: hidden; }
.quote-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 44px minmax(58px, auto) auto;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  transition: background .18s var(--ease);
}
.quote-row + .quote-row { border-top: 1px solid var(--line); }
.quote-row:hover { background: rgba(31, 95, 139, 0.05); }
.stock {
  display: grid;
  justify-items: start;
  min-width: 0;
  padding: 2px;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: 6px;
}
.stock:enabled:hover { background: transparent; border-color: transparent; }
.stock-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.stock small {
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}
.quote-values { display: grid; text-align: right; font-variant-numeric: tabular-nums; gap: 1px; }
.quote-price { font-size: 11px; color: var(--muted); }
.quote-change {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: -0.02em;
  transition: color .2s var(--ease);
}
.quote-change.up {
  color: var(--up);
  text-shadow: 0 0 18px rgba(214, 59, 74, 0.18);
}
.quote-change.down {
  color: var(--down);
  text-shadow: 0 0 18px rgba(13, 138, 106, 0.16);
}
.quote-actions { display: flex; gap: 2px; opacity: 0.55; transition: opacity .18s var(--ease); }
.quote-row:hover .quote-actions { opacity: 1; }
.quote-actions button {
  width: 24px;
  height: 24px;
  border: 0;
  background: transparent;
  padding: 0;
  border-radius: 7px;
}
.quote-actions button:enabled:hover { background: var(--accent-soft); }
.quote-actions img { width: 12px; height: 12px; }
.quote-actions .remove:enabled:hover { background: var(--up-soft); }
.compact {
  --compact-text: #bdbdbd;
  padding: 0 28px 36px 22px;
  background: transparent;
  color: var(--compact-text);
  text-shadow: 0 1px 2px rgb(0 0 0 / 80%);
}
.compact .toolbar {
  min-height: 53px;
  padding: 0 4px 0 0;
  align-items: end;
  gap: 0;
  border-color: #ddd;
  background: transparent;
  backdrop-filter: none;
}
.compact .toolbar-actions { gap: 0; }
.compact-controls {
  position: absolute;
  inset: 0 4px auto 0;
  height: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.window-drag-handle {
  flex: 1;
  height: 20px;
  display: grid;
  place-items: center;
  cursor: move;
  -webkit-app-region: drag;
  app-region: drag;
}
.window-drag-handle::before {
  content: "";
  width: 26px;
  height: 5px;
  border-block: 1px solid currentColor;
  filter: drop-shadow(0 1px 1px rgb(0 0 0 / 80%));
}
.compact .icon-button {
  width: 32px;
  height: 28px;
  border-radius: 4px;
}
.compact .icon-button img {
  width: 18px;
  height: 18px;
  opacity: 1;
  filter: invert(1) drop-shadow(0 1px 1px rgb(0 0 0 / 80%));
}
.compact .icon-button:enabled:hover, .compact .icon-button[aria-pressed=true] {
  background: rgb(255 255 255 / 15%);
}
.compact-controls .icon-button { width: 24px; height: 22px; }
.compact-controls .icon-button[aria-pressed=true]:not(:hover) { background: transparent; }
.compact-controls .icon-button img { width: 14px; height: 14px; }
.compact .group-select {
  max-width: 50%;
  padding: 0 2px;
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 11px;
  text-overflow: ellipsis;
  text-shadow: inherit;
}
.compact .group-select option {
  background: var(--surface-solid);
  color: var(--ink);
  font-size: 13px;
}
.compact .watchlist { scrollbar-width: none; }
.compact .quote-table, .compact .empty, .compact .results, .compact .notice {
  margin-inline: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
  color: inherit;
}
.compact .quote-table { margin-block: 0; }
.compact .quote-row {
  grid-template-columns: minmax(0, 1fr) auto;
  min-height: 23px;
  padding: 0 8px;
  border: 0;
}
.compact .quote-row:hover { background: rgb(255 255 255 / 8%); }
.compact .stock { padding: 0; text-shadow: inherit; }
.compact .stock-name { font-size: 14px; font-weight: 500; }
.compact .quote-values { grid-template-columns: 59px 47px; gap: 3px; }
.compact .quote-price, .compact .quote-change {
  font-size: 12px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: inherit;
  text-shadow: inherit;
}
.compact .quote-price { grid-area: 1 / 1; }
.compact .search { margin-inline: 0; }
.compact .search input {
  border-color: rgb(255 255 255 / 45%);
  background: transparent;
  box-shadow: none;
  text-shadow: inherit;
}
.compact .search input::placeholder, .compact .result-name small,
.compact .search button, .compact .results button { color: inherit; }
.compact .search button, .compact .results button {
  background: transparent;
  text-shadow: inherit;
}
.compact .search button:enabled:hover, .compact .results button:enabled:hover {
  background: rgb(255 255 255 / 15%);
}
.results { margin: 0 10px 6px; }
.results li {
  padding: 7px 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.results li + li { border-top: 1px solid var(--line); }
.result-name { min-width: 0; font-weight: 600; }
.results button {
  color: var(--accent);
  font-weight: 600;
  background: var(--accent-soft);
  border-color: transparent;
}
.results button:enabled:hover { background: rgba(31, 95, 139, 0.16); }

.login, .settings {
  display: grid;
  gap: 12px;
  margin: 10px;
  padding: 16px;
  box-shadow: var(--shadow-md);
}
.panel-heading { display: grid; gap: 4px; }
.panel-enter { animation: panel-in .28s var(--ease) both; }
.login label, .import-settings { display: grid; gap: 5px; font-weight: 500; }
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 32px;
  padding: 4px 0;
  border-bottom: 1px solid var(--line);
  font-weight: 500;
}
.setting-row:last-of-type { border-bottom: 0; }
.setting-row input:not([type=checkbox]) { width: 48%; }
.tray-icon-settings { display: grid; gap: 6px; }
.tray-icon-settings .setting-row img { margin-left: auto; object-fit: contain; }
.tray-icon-upload { display: grid; gap: 5px; font-weight: 500; }
.tray-icon-upload input { width: 100%; font-size: 11px; }
.settings-actions { display: flex; justify-content: flex-end; gap: 8px; }
.import-settings input { width: 100%; font-size: 11px; }
.primary {
  background: linear-gradient(180deg, #256891, var(--accent));
  border-color: transparent;
  color: #fff;
  font-weight: 650;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.18) inset, 0 6px 14px rgba(31, 95, 139, 0.22);
}
.primary:enabled:hover {
  background: linear-gradient(180deg, #2a729d, var(--accent-deep));
  border-color: transparent;
}
</style>
