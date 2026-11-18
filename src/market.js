import { loadProviderHistory, withDeadline } from './chartSources.js'
import { isTauri } from '@tauri-apps/api/core'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

export const demo = import.meta.env.VITE_DEMO_MODE !== 'false'
const apiBase = import.meta.env.VITE_API_BASE || 'https://api.hqzs.top/apis/'
export const sessionScope = new URL(apiBase.endsWith('/') ? apiBase : apiBase + '/').href

const symbols = [
  { info_id: 1, info_name: '示例沪市 A', info_code: '600000', info_market: 1, price: 15.23, zdf: 1.24 },
  { info_id: 2, info_name: '示例深市 B', info_code: '000001', info_market: 0, price: 12.6, zdf: -0.68 },
  { info_id: 3, info_name: '示例基金 C', info_code: '510300', info_market: 1, price: 4.52, zdf: 0.35 },
]
const initialGroups = [
  { group_id: 1, group_name: '我的自选', position: symbols.slice(0, 2) },
  { group_id: 2, group_name: '基金', position: symbols.slice(2) },
]

export const symbolKey = (row) => `${row.info_market}.${row.info_code}`

async function request(path, user, body, signal) {
  const url = new URL(path, sessionScope)
  const response = await (isTauri() ? tauriFetch : fetch)(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      platform: '1',
      token: user?.token ?? '',
      accountId: String(user?.accountId ?? ''),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    maxRedirections: 0,
    signal,
  })
  if (!response.ok) throw new Error(`请求失败（${response.status}）`)
  const result = await response.json()
  if (result.status !== '000') {
    const error = new Error(result.message || '行情服务返回错误')
    error.code = result.status
    throw error
  }
  return result.data
}

export async function login(account, password) {
  const data = await request('account/login', null, { account, password })
  if (!data?.token || data.account_id == null) throw new Error('账号服务未返回有效会话')
  return { token: data.token, accountId: String(data.account_id) }
}

export async function loadGroups(user) {
  if (demo) return JSON.parse(localStorage.getItem('demo-groups') || JSON.stringify(initialGroups))
  return (await request('position/info?type=1', user))?.groups ?? []
}

export function saveDemoGroups(groups) {
  localStorage.setItem('demo-groups', JSON.stringify(groups))
}

async function requestPublicData(url, errorLabel, signal, read = (response) => response.json()) {
  const response = await (isTauri() ? tauriFetch : fetch)(url, {
    signal,
    credentials: 'omit',
    redirect: 'error',
    maxRedirections: 0,
  })
  if (!response.ok) throw new Error(`${errorLabel}请求失败（${response.status}）`)
  return read(response)
}

export async function searchSymbols(query) {
  if (demo) return symbols.filter((item) => item.info_name.includes(query) || item.info_code.includes(query))

  const url = new URL('https://searchapi.eastmoney.com/api/Info/Search')
  url.search = new URLSearchParams({
    appid: 'el1902262',
    type: '14',
    token: import.meta.env.VITE_STOCK_SEARCH_KEY || 'CCSDCZSDCXYMYZYYSYYXSMDDSMDHHDJT',
    and14: `MultiMatch/Name,Code,PinYin/${query}/true`,
    returnfields14: 'Name,Code,PinYin,MarketType,JYS,MktNum,JYS4App,MktNum4App,ID,Classify,IsExactMatch,SecurityType,SecurityTypeName',
    pageIndex14: '1',
    pageSize14: '10',
    isAssociation14: `false${Date.now()}`,
  })
  const result = await requestPublicData(url, '股票搜索')
  return (Array.isArray(result?.Data) ? result.Data : []).map((item) => ({
    info_name: item.Name, info_code: item.Code, info_market: item.MktNum, stock_type: item.SecurityTypeName,
  }))
}

export const sortSymbols = (user, group, ids) => request(`position/operation/sort/${encodeURIComponent(group)}`, user, ids)
export const deleteSymbol = (user, group, id) => request(`position/operation/${encodeURIComponent(id)}`, user, { group_id: group, is_delete: true })
export const addSymbol = (user, data) => request('position/operation/', user, data)

export async function loadHistory(row, period, signal) {
  if (demo) {
    const interval = { intraday: 60, '1d': 86400, '1w': 604800, '1m': 2592000 }[period]
    const start = Math.floor(Date.UTC(2026, 9, 1, period === 'intraday' ? 7 : 0) / 1000)
    return Array.from({ length: 180 }, (_, i) => {
      const close = row.price * (0.92 + i / 2200 + Math.sin(i / 5) / 32)
      const open = close * (1 + Math.sin(i * 2.1) / 65)
      return { time: start - interval * (179 - i), open, close, high: Math.max(open, close) * 1.009, low: Math.min(open, close) * 0.993, volume: 10000 + Math.round((1 + Math.cos(i)) * 30000) }
    })
  }
  const endpoint = import.meta.env.VITE_HISTORY_URL
  if (endpoint) {
    const url = new URL(endpoint)
    url.searchParams.set('symbol', symbolKey(row))
    url.searchParams.set('period', period)
    return requestPublicData(url, '历史行情', signal)
  }

  const clientId = import.meta.env.VITE_HISTORY_CLIENT_ID || 'fa5fd1943c7b386f172d6893dbfba10b'
  return loadProviderHistory(row, period, signal, requestPublicData, clientId)
}

const quoteHosts = [
  'push2.eastmoney.com',
  '82.push2.eastmoney.com',
  '80.push2.eastmoney.com',
  'push2delay.eastmoney.com',
]

function quoteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export async function loadQuotes(symbols, signal) {
  const requested = new Set(symbols)
  for (const host of quoteHosts) {
    const url = new URL(`https://${host}/api/qt/ulist.np/get`)
    url.search = new URLSearchParams({
      fltt: '2', fields: 'f2,f3,f4,f12,f13,f18',
      secids: [...requested].join(','), _: String(Date.now()),
    })
    try {
      const payload = await withDeadline((requestSignal) =>
        requestPublicData(url, '实时行情', requestSignal), signal)
      const diff = payload?.data?.diff
      if (payload?.rc !== 0 || !diff || typeof diff !== 'object') continue
      const quotes = new Map()
      for (const item of Object.values(diff)) {
        const key = `${item?.f13}.${item?.f12}`
        if (!requested.has(key)) continue
        const price = quoteNumber(item.f2)
        const zdf = quoteNumber(item.f3)
        const previousClose = quoteNumber(item.f18)
        const lastPrice = price === 0 && zdf === 0 && item.f4 === 0 ? previousClose : price
        if (lastPrice != null || zdf != null) quotes.set(key, { price: lastPrice, zdf })
      }
      if (quotes.size) return quotes
    } catch (error) {
      if (signal.aborted) throw error
    }
  }
  try {
    const quotes = await withDeadline((requestSignal) => loadTencentQuotes(requested, requestSignal), signal)
    if (quotes.size) return quotes
  } catch (error) {
    if (signal.aborted) throw error
  }
  throw new Error('实时行情暂不可用，正在重试')
}

async function loadTencentQuotes(requested, signal) {
  const prefixes = { 0: 'sz', 1: 'sh', 116: 'hk' }
  const symbols = new Map()
  for (const key of requested) {
    const [market, code] = key.split('.')
    if (prefixes[market] && /^\d{5,6}$/.test(code)) symbols.set(prefixes[market] + code, key)
  }
  const quotes = new Map()
  if (!symbols.size) return quotes
  const url = new URL(`https://qt.gtimg.cn/q=${[...symbols.keys()].join(',')}`)
  const body = await requestPublicData(url, '腾讯实时行情', signal, async (response) =>
    new TextDecoder('gb18030').decode(await response.arrayBuffer()))
  for (const match of body.matchAll(/^v_(\w+)="([^"]*)";/gm)) {
    const key = symbols.get(match[1])
    if (!key) continue
    const fields = match[2].split('~')
    if (fields[2] !== match[1].slice(2)) continue
    const price = fields[3]?.trim() ? quoteNumber(Number(fields[3])) : null
    const zdf = fields[32]?.trim() ? quoteNumber(Number(fields[32])) : null
    if (price != null || zdf != null) quotes.set(key, { price, zdf })
  }
  return quotes
}

export function applyQuotes(rows, quotes) {
  let changed = false
  const updated = rows.map((row) => {
    const quote = quotes.get(symbolKey(row))
    if (!quote) return row
    const { price, zdf } = quote
    if (row.price === price && row.zdf === zdf) return row
    changed = true
    return { ...row, price, zdf }
  })
  return changed ? updated : rows
}
