import { loadProviderHistory, withDeadline } from './chartSources'
import type { ChartPeriod, HistoryPoint } from './chartSources'
import { matchesTencentQuote, tencentQuoteSymbol } from './stockMarkets'
import { isTauri } from '@tauri-apps/api/core'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

export type { ChartPeriod, HistoryPoint } from './chartSources'

export interface Session {
  token: string
  accountId: string
}

export type GroupId = string | number

export type QuoteMetrics = Partial<Record<keyof typeof metricFields, number>>

export interface Quote {
  price?: number | null
  zdf?: number | null
  metrics?: QuoteMetrics | null
}

export interface Stock extends Quote {
  info_id?: string | number
  info_name: string
  info_code: string
  info_market: string | number
  stock_type?: string
}

export interface WatchlistGroup {
  group_id: GroupId
  group_name: string
  position: Stock[]
}

interface AddSymbolData extends Pick<Stock, 'info_name' | 'info_code' | 'info_market' | 'stock_type'> {
  group_id: GroupId
  info_type: number
}

interface ServiceResult<T> {
  status: string
  message?: string
  data: T
}

interface SearchItem {
  Name: string
  Code: string
  MktNum: Stock['info_market']
  SecurityTypeName?: string
}

const demoMode = import.meta.env.VITE_DEMO_MODE
export const demo = demoMode === 'true' || (import.meta.env.DEV && demoMode !== 'false')
const apiBase = import.meta.env.VITE_API_BASE || 'https://api.hqzs.top/apis/'
export const sessionScope = new URL(apiBase.endsWith('/') ? apiBase : apiBase + '/').href

const symbols: (Stock & { price: number })[] = [
  { info_id: 1, info_name: '示例沪市 A', info_code: '600000', info_market: 1, price: 15.23, zdf: 1.24 },
  { info_id: 2, info_name: '示例深市 B', info_code: '000001', info_market: 0, price: 12.6, zdf: -0.68 },
  { info_id: 3, info_name: '示例基金 C', info_code: '510300', info_market: 1, price: 4.52, zdf: 0.35 },
]
const initialGroups: WatchlistGroup[] = [
  { group_id: 1, group_name: '我的自选', position: symbols.slice(0, 2) },
  { group_id: 2, group_name: '基金', position: symbols.slice(2) },
]

export const symbolKey = (row: Pick<Stock, 'info_market' | 'info_code'>) => `${row.info_market}.${row.info_code}`

async function request<T>(path: string, user: Session | null, body?: object, signal?: AbortSignal): Promise<T> {
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
  const result: ServiceResult<T> = await response.json()
  if (result.status !== '000') {
    throw Object.assign(new Error(result.message || '行情服务返回错误'), { code: result.status })
  }
  return result.data
}

export async function login(account: string, password: string): Promise<Session> {
  const data = await request<{ token?: string; account_id?: string | number } | null>('account/login', null, { account, password })
  if (!data?.token || data.account_id == null) throw new Error('账号服务未返回有效会话')
  return { token: data.token, accountId: String(data.account_id) }
}

export async function loadGroups(user: Session | null): Promise<WatchlistGroup[]> {
  if (demo) return JSON.parse(localStorage.getItem('demo-groups') || JSON.stringify(initialGroups))
  return (await request<{ groups?: WatchlistGroup[] } | null>('position/info?type=1', user))?.groups ?? []
}

export function saveDemoGroups(groups: WatchlistGroup[]) {
  localStorage.setItem('demo-groups', JSON.stringify(groups))
}

async function requestPublicData<T>(
  url: URL,
  errorLabel: string,
  signal?: AbortSignal,
  read: (response: Response) => Promise<T> = (response) => response.json(),
): Promise<T> {
  const response = await (isTauri() ? tauriFetch : fetch)(url, {
    signal,
    credentials: 'omit',
    redirect: 'error',
    maxRedirections: 0,
  })
  if (!response.ok) throw new Error(`${errorLabel}请求失败（${response.status}）`)
  return read(response)
}

export async function searchSymbols(query: string): Promise<Stock[]> {
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
  }).toString()
  const result = await requestPublicData<{ Data?: SearchItem[] } | null>(url, '股票搜索')
  return (Array.isArray(result?.Data) ? result.Data : []).map((item) => ({
    info_name: item.Name, info_code: item.Code, info_market: item.MktNum, stock_type: item.SecurityTypeName,
  }))
}

export const sortSymbols = (user: Session | null, group: GroupId, ids: Stock['info_id'][]) =>
  request(`position/operation/sort/${encodeURIComponent(group)}`, user, ids)
export const deleteSymbol = (user: Session | null, group: GroupId, id: Stock['info_id']) =>
  request(`position/operation/${encodeURIComponent(String(id))}`, user, { group_id: group, is_delete: true })
export const addSymbol = (user: Session | null, data: AddSymbolData) => request('position/operation/', user, data)

export async function loadHistory(row: Stock, period: ChartPeriod, signal?: AbortSignal): Promise<HistoryPoint[]> {
  if (demo) {
    const intraday = period === 'intraday'
    const interval = intraday ? 0 : { '1d': 86400, '1w': 604800, '1m': 2592000 }[period]
    const price = Number(row.price)
    const tradingDay = Date.UTC(2026, 9, 9) / 1000
    let tradedValue = 0
    let tradedVolume = 0
    return Array.from({ length: intraday ? 241 : 180 }, (_, i) => {
      const close = price * (0.92 + i / 2200 + Math.sin(i / 5) / 32)
      const open = close * (1 + Math.sin(i * 2.1) / 65)
      const volume = 10000 + Math.round((1 + Math.cos(i)) * 30000)
      if (intraday) {
        // The next bar after 11:30 represents the minute ending at 13:01.
        const time = tradingDay + (90 + i + (i > 120 ? 90 : 0)) * 60
        tradedVolume += volume
        tradedValue += close * volume
        return { time, open: close, close, high: close, low: close, volume,
          previousClose: row.price, averagePrice: tradedValue / tradedVolume }
      }
      const time = tradingDay - interval * (179 - i)
      return { time, open, close, high: Math.max(open, close) * 1.009, low: Math.min(open, close) * 0.993, volume }
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
  'push2delay2.eastmoney.com',
]

function quoteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const metricFields = {
  open: 'f17', previousClose: 'f18', high: 'f15', low: 'f16',
  volume: 'f5', amount: 'f6', turnover: 'f8', amplitude: 'f7',
  volumeRatio: 'f10', pe: 'f115', pb: 'f23', marketCap: 'f20',
}

const metricKeys = Object.keys(metricFields) as (keyof QuoteMetrics)[]
type QuoteSource = Record<string, unknown>

function quoteMetrics(source: QuoteSource) {
  const metrics: QuoteMetrics = {}
  for (const key of metricKeys) {
    const value = quoteNumber(source[metricFields[key]])
    if (value != null) metrics[key] = value
  }
  return Object.keys(metrics).length ? metrics : null
}

function hasTradingTotals(quote: Quote) {
  return quote.metrics?.volume != null && quote.metrics?.amount != null
}

export async function loadQuotes(symbols: Iterable<string>, signal: AbortSignal) {
  const remaining = new Set(symbols)
  const quotes = new Map<string, Quote>()
  for (const host of quoteHosts) {
    const url = new URL(`https://${host}/api/qt/ulist.np/get`)
    url.search = new URLSearchParams({
      fltt: '2', fields: ['f2', 'f3', 'f4', 'f12', 'f13', ...Object.values(metricFields)].join(','),
      secids: [...remaining].join(','), _: String(Date.now()),
    }).toString()
    try {
      const payload = await withDeadline((requestSignal) =>
        requestPublicData<{ rc?: number; data?: { diff?: Record<string, QuoteSource> } } | null>(url, '实时行情', requestSignal), signal)
      const diff = payload?.data?.diff
      if (payload?.rc !== 0 || !diff || typeof diff !== 'object') continue
      for (const item of Object.values(diff)) {
        const key = `${item?.f13}.${item?.f12}`
        if (!remaining.has(key)) continue
        const price = quoteNumber(item.f2)
        const zdf = quoteNumber(item.f3)
        const previousClose = quoteNumber(item.f18)
        const lastPrice = price === 0 && zdf === 0 && item.f4 === 0 ? previousClose : price
        if (lastPrice != null || zdf != null) {
          const quote = { price: lastPrice, zdf, metrics: quoteMetrics(item) }
          if (!quotes.has(key) || hasTradingTotals(quote)) quotes.set(key, quote)
          if (hasTradingTotals(quote)) remaining.delete(key)
        }
      }
      if (!remaining.size) return quotes
    } catch (error) {
      if (signal.aborted) throw error
    }
  }
  try {
    const fallback = await withDeadline((requestSignal) => loadTencentQuotes(remaining, requestSignal), signal)
    for (const [key, quote] of fallback) {
      if (!quotes.has(key) || hasTradingTotals(quote)) quotes.set(key, quote)
    }
  } catch (error) {
    if (signal.aborted) throw error
  }
  if (quotes.size) return quotes
  throw new Error('实时行情暂不可用，正在重试')
}

async function loadTencentQuotes(requested: Set<string>, signal: AbortSignal) {
  const symbols = new Map<string, { key: string; market: string; code: string }>()
  for (const key of requested) {
    const separator = key.indexOf('.')
    const market = key.slice(0, separator)
    const code = key.slice(separator + 1)
    const symbol = tencentQuoteSymbol(market, code)
    if (symbol) symbols.set(symbol, { key, market, code })
  }
  const quotes = new Map<string, Quote>()
  if (!symbols.size) return quotes
  const url = new URL(`https://qt.gtimg.cn/q=${[...symbols.keys()].join(',')}`)
  const body = await requestPublicData(url, '腾讯实时行情', signal, async (response) =>
    new TextDecoder('gb18030').decode(await response.arrayBuffer()))
  for (const match of body.matchAll(/^v_([\w.-]+)="([^"]*)";/gm)) {
    const identity = symbols.get(match[1])
    if (!identity) continue
    const fields = match[2].split('~')
    if (!matchesTencentQuote(match[1], identity.market, identity.code, fields[2])) continue
    const number = (index: number) => fields[index]?.trim() ? quoteNumber(Number(fields[index])) : null
    const price = number(3)
    const zdf = number(32)
    if (price == null && zdf == null) continue
    const mainland = identity.market === '0' || identity.market === '1'
    const volume = number(6)
    const amount = number(37)
    const cap = number(45)
    const metrics = quoteMetrics({
      f17: number(5), f18: number(4), f15: number(33), f16: number(34),
      f5: volume == null ? null : volume / (mainland && /^sh68[89]/.test(match[1]) ? 100 : 1),
      f6: amount == null ? null : amount * (mainland ? 10000 : 1),
      f7: number(43), f8: mainland ? number(38) : null,
      f10: mainland ? number(49) : null, f115: mainland && number(52) != null ? number(39) : null,
      f23: mainland ? number(46) : null, f20: cap == null ? null : cap * 100000000,
    })
    quotes.set(identity.key, { price, zdf, metrics })
  }
  return quotes
}

export function applyQuotes(rows: Stock[], quotes: ReadonlyMap<string, Quote>) {
  let changed = false
  const updated = rows.map((row) => {
    const quote = quotes.get(symbolKey(row))
    if (!quote) return row
    const { price, zdf, metrics } = quote
    if (row.price === price && row.zdf === zdf &&
        metricKeys.every((key) => row.metrics?.[key] === metrics?.[key])) return row
    changed = true
    return { ...row, price, zdf, metrics }
  })
  return changed ? updated : rows
}
