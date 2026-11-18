<script setup>
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { desktopCommand, listenTray, resizeWindow, windowAction } from './desktop.js'
import WatchlistSparkline from './WatchlistSparkline.vue'
import UpdatePanel from './UpdatePanel.vue'
import settingsIcon from './icons/settings.svg'
import searchIcon from './icons/search.svg'
import pinIcon from './icons/pin.svg'
import deleteIcon from './icons/trash.svg'
import {
  addSymbol, applyQuotes, deleteSymbol, demo, loadGroups, login,
  loadQuotes, saveDemoGroups, searchSymbols, sessionScope, sortSymbols, symbolKey,
} from './market.js'

const defaults = { compact: false, pinned: false, opacity: 95, shortcut: 'Alt+Z' }
function readSettings() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem('desktop-settings') || '{}') }
  } catch {
    return { ...defaults }
  }
}
const settings = ref(readSettings())
const user = ref(null)
const skipRestoreKey = `skip-session-restore:${sessionScope}`
const groups = ref([])
const groupId = ref(null)
const group = computed(() => groups.value.find((item) => item.group_id === groupId.value))
const rows = computed(() => group.value?.position ?? [])
const selectedKey = ref('')
const selected = computed(() => rows.value.find((item) => symbolKey(item) === selectedKey.value))
const subscription = computed(() => rows.value.map(symbolKey).join(','))
const panel = ref(demo ? 'list' : 'startup')
const listVisible = computed(() => panel.value === 'list' && !selected.value)
const compactList = computed(() => listVisible.value && settings.value.compact)
const watchlist = ref(null)
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
      await resizeWindow(compact ? 300 : 390, compact ? 280 : 510)
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

function saveListScroll(event) {
  if (event.currentTarget === watchlist.value && scrollKey.value) {
    localStorage.setItem(scrollKey.value, String(event.currentTarget.scrollTop))
  }
}

function toggleCompact() {
  settings.value.compact = !settings.value.compact
  localStorage.setItem('desktop-settings', JSON.stringify(settings.value))
}
const form = ref({ account: '', password: '' })
const query = ref('')
const searchVisible = ref(false)
const searchInput = ref(null)

async function toggleSearch() {
  searchVisible.value = !searchVisible.value
  if (searchVisible.value) {
    await nextTick()
    searchInput.value?.focus()
  }
}
const results = ref([])
const status = ref('')
const quoteStatus = ref('')
const busy = ref(false)
let unlisten

function expired(error) {
  return ['001', '002'].includes(error.code)
}

async function report(error) {
  if (user.value && expired(error)) await signOut()

  status.value = error.message || String(error)
}

async function run(action) {
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
      .map((row) => [symbolKey(row), { price: row.price, zdf: row.zdf }]))
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
      : await desktopCommand('load_session', { scope: sessionScope })
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

async function modify(action, row) {
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

async function importSettings(event) {
  const input = event.target
  const file = input.files[0]
  if (!file) return
  try {
    if (file.size > 1024 * 1024) throw new Error('配置文件过大')
    const old = JSON.parse(await file.text())
    if (!old?.config || typeof old.config !== 'object') throw new Error('无法识别旧版配置')
    const shortcut = old.shortcutKey?.windowShow
    const opacity = old.config.viewTransparency
    settings.value = {
      compact: old.config.stockView === 'simple',
      pinned: old.config.startToTop === true,
      opacity: Number.isFinite(opacity) ? Math.max(0, Math.min(100, opacity)) : defaults.opacity,
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
    await desktopCommand('set_shortcut', { shortcut: settings.value.shortcut.trim() || null })
    await windowAction('setAlwaysOnTop', settings.value.pinned)
    localStorage.setItem('desktop-settings', JSON.stringify(settings.value))
    panel.value = demo || user.value ? 'list' : 'login'
  })
}

watch([groupId, subscription, user], ([, symbols, account], _, onCleanup) => {
  quoteStatus.value = ''
  if (demo || !symbols || !account) return
  const controller = new AbortController()
  const requested = symbols.split(',')
  let timer
  async function poll() {
    try {
      const quotes = await loadQuotes(requested, controller.signal)
      if (controller.signal.aborted) return
      group.value.position = applyQuotes(group.value.position, quotes)
      quoteStatus.value = ''
    } catch (error) {
      if (!controller.signal.aborted) quoteStatus.value = error.message
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
    if (action === 'settings') panel.value = 'settings'
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
  await Promise.allSettled([
    desktopCommand('set_shortcut', { shortcut: settings.value.shortcut.trim() || null }).catch(report),
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
})

const quoteNumber = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const percentNumber = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hasQuote = (value) => value != null && value !== '' && Number.isFinite(Number(value))
const formatPrice = (value) => hasQuote(value) ? quoteNumber.format(value) : '–'
const formatChange = (value) => hasQuote(value) ? `${value > 0 ? '+' : ''}${percentNumber.format(value)}%` : '–'

const StockChart = defineAsyncComponent(() => import('./StockChart.vue'))
</script>

<template>
  <div class="shell" :class="{ compact: settings.compact }" :style="{ '--opacity': settings.opacity / 100 }">
    <header class="toolbar" aria-label="应用工具栏">
      <select v-if="listVisible" v-model="groupId" class="group-select" aria-label="分组" :disabled="busy || !groups.length">
        <option v-for="item in groups" :key="item.group_id" :value="item.group_id">{{ item.group_name }}</option>
      </select>
      <div class="toolbar-actions">
        <button v-if="listVisible" type="button" class="layout-button" aria-label="精简模式" :aria-pressed="compactList" @click="toggleCompact">{{ compactList ? '展开' : '精简' }}</button>
        <span v-if="demo" class="mode">离线样本</span>
        <button v-if="listVisible" type="button" class="icon-button" :aria-expanded="searchVisible" :disabled="!group" aria-label="搜索股票" title="搜索股票" @click="toggleSearch"><img :src="searchIcon" alt=""></button>
        <button type="button" class="icon-button" :disabled="panel === 'startup'" aria-label="设置" title="设置" @click="panel = 'settings'"><img :src="settingsIcon" alt=""></button>
      </div>
    </header>

    <main class="content">
      <UpdatePanel :visible="panel === 'settings'" />
      <p v-if="status" class="notice" role="status">{{ status }}</p>
      <p v-if="panel === 'startup'" class="notice" role="status">正在恢复会话…</p>
      <form v-else-if="panel === 'login'" class="surface login" @submit.prevent="submitLogin">
        <h1>登录盯盘管家</h1>
        <p class="muted">登录后查看你的自选股票。</p>
        <label>账号<input v-model="form.account" required autocomplete="username"></label>
        <label>密码<input v-model="form.password" type="password" required autocomplete="current-password"></label>
        <button class="primary" :disabled="busy">{{ busy ? '正在登录…' : '登录' }}</button>
      </form>
      <form v-else-if="panel === 'settings'" class="surface settings" @submit.prevent="saveSettings">
        <h1>应用设置</h1>
        <label class="setting-row"><span>精简列表</span><input v-model="settings.compact" type="checkbox"></label>
        <label class="setting-row"><span>窗口置顶</span><input v-model="settings.pinned" type="checkbox"></label>
        <label class="setting-row"><span>窗口不透明度</span><input v-model.number="settings.opacity" type="range" min="0" max="100"></label>
        <label class="setting-row"><span>窗口显示快捷键</span><input v-model="settings.shortcut" placeholder="Alt+Z"></label>
        <label class="import-settings">导入旧版设置<input type="file" accept=".json,application/json" @change="importSettings"></label>
        <button class="primary" :disabled="busy">保存设置</button>
      </form>
      <StockChart v-else-if="selected" :stock="selected" :initial-period="settings.compact ? 'intraday' : '1d'" @close="selectedKey = ''" />
      <section v-else ref="watchlist" class="watchlist" @scroll.passive="saveListScroll">
        <form v-if="group" v-show="searchVisible" class="search" @submit.prevent="search" @keydown.esc="toggleSearch">
          <input ref="searchInput" v-model="query" aria-label="股票名称或代码" placeholder="股票名称或代码">
          <button :disabled="busy">搜索</button>
        </form>
        <ul v-if="searchVisible && results.length" class="surface results">
          <li v-for="item in results" :key="symbolKey(item)">
            <span>{{ item.info_name }} <small>{{ item.info_code }}</small></span>
            <button :disabled="busy" @click="modify('add', item)">添加</button>
          </li>
        </ul>
        <p v-if="quoteStatus" class="notice" role="status">{{ quoteStatus }}</p>
        <p v-if="!rows.length" class="surface empty">暂无自选</p>
        <div v-else class="surface quote-table">
          <ul class="quotes">
            <li v-for="(row, index) in rows" :key="symbolKey(row)" class="quote-row">
              <button class="stock" @click="selectedKey = symbolKey(row)">
                <span class="stock-name">{{ row.info_name }}</span>
                <small>{{ row.info_code }}</small>
              </button>
              <WatchlistSparkline v-if="!settings.compact" :row="row" :user="user" :group-id="groupId" />
              <div class="quote-values">
                <span class="quote-change" :class="{ down: row.zdf < 0, up: row.zdf > 0 }">{{ formatChange(row.zdf) }}</span>
                <span class="quote-price">{{ formatPrice(row.price) }}</span>
              </div>
              <div v-if="!settings.compact" class="quote-actions">
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
  font: 13px/1.45 "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #272b32;
  --muted: #646c78;
  --line: #e7e9ed;
  --surface: #fff;
  --accent: #285987;
  --up: #be3645;
  --down: #087961;
}
* { box-sizing: border-box; }
body { margin: 0; }
button, input, select {
  font: inherit;
  color: inherit;
  background: #fff;
  border: 1px solid #dce0e5;
  border-radius: 5px;
  padding: 5px 8px;
}
button { cursor: pointer; white-space: nowrap; }
button:enabled:hover { background: #edf1f5; }
button:disabled { cursor: default; opacity: .45; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
input { min-width: 0; }
input::placeholder, .muted, small { color: var(--muted); }
input[type=checkbox], input[type=range] { accent-color: var(--accent); }
h1 { margin: 0; font-size: 16px; font-weight: 650; line-height: 1.3; }
p { margin: 0; }
ul { margin: 0; padding: 0; list-style: none; }

.shell { height: 100vh; display: flex; flex-direction: column; background: rgba(255, 255, 255, var(--opacity)); }
.toolbar {
  min-height: 43px;
  padding: 5px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid var(--line);
  background: rgba(247, 248, 250, var(--opacity));
}
.mode { color: var(--muted); font-size: 11px; white-space: nowrap; }
.toolbar-actions { display: flex; align-items: center; gap: 4px; margin-left: auto; }
.icon-button { width: 30px; height: 29px; padding: 0; border: 0; background: transparent; }
.icon-button img, .quote-actions img { width: 14px; height: 14px; display: block; margin: auto; opacity: .66; }
.content { display: flex; flex: 1; flex-direction: column; gap: 8px; min-width: 0; min-height: 0; overflow: auto; }
.content > .notice { margin: 8px 10px 0; }
.group-select { min-width: 0; max-width: 60%; padding: 4px 7px; font-weight: 600; }
.watchlist { flex: 1; min-width: 0; min-height: 0; overflow: auto; }
.layout-button { white-space: nowrap; font-size: 11px; padding: 3px 6px; }
.search { display: flex; gap: 6px; margin: 8px 10px; }
.search input { flex: 1; }
.search button { color: var(--accent); }
.surface { background: var(--surface); }
.quote-table, .empty { margin: 8px 10px; border: 1px solid var(--line); border-radius: 7px; background: transparent; }
.notice { padding: 5px 8px; color: #385675; background: #edf3f9; border-radius: 4px; overflow-wrap: anywhere; }
.watchlist > .notice { margin: 6px 10px; }
.empty { padding: 20px 10px; text-align: center; color: var(--muted); }
.quote-row { display: grid; grid-template-columns: minmax(0, 1fr) 40px minmax(55px, auto) auto; align-items: center; gap: 8px; padding: 6px 9px; }
.quote-row + .quote-row { border-top: 1px solid var(--line); }
.quote-row:hover { background: rgba(45, 87, 135, .05); }
.stock { display: grid; justify-items: start; min-width: 0; padding: 2px; text-align: left; background: transparent; border: 0; }
.stock-name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
.stock small { font-size: 10px; font-variant-numeric: tabular-nums; }
.quote-values { display: grid; text-align: right; font-variant-numeric: tabular-nums; }
.quote-price { font-size: 11px; color: var(--muted); }
.quote-change { font-size: 13px; font-weight: 650; }
.quote-change.up { color: var(--up); }
.quote-change.down { color: var(--down); }
.quote-actions { display: flex; gap: 1px; }
.quote-actions button { width: 23px; height: 24px; border: 0; background: transparent; padding: 0; }
.quote-actions img { width: 12px; height: 12px; }
.quote-actions .remove:enabled:hover { background: #fbe8eb; }
.compact .quote-row { grid-template-columns: minmax(0, 1fr) auto; padding-block: 4px; }
.compact .stock small { display: none; }
.results { margin: 0 10px 6px; border: 1px solid var(--line); border-radius: 5px; }
.results li { padding: 5px 8px; display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.results li + li { border-top: 1px solid var(--line); }

.login, .settings { display: grid; gap: 10px; margin: 4px 10px 10px; padding: 12px; border: 1px solid var(--line); border-radius: 6px; }
.login label, .import-settings { display: grid; gap: 4px; }
.setting-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 29px; }
.setting-row input:not([type=checkbox]) { width: 46%; }
.import-settings input { width: 100%; font-size: 11px; }
.primary { background: #285987; border-color: #285987; color: #fff; font-weight: 650; }
.primary:enabled:hover { background: #214b73; }
.update-panel { padding-inline: 10px; }
</style>
