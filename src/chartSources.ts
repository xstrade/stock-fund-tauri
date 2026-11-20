import { isUSMarket, matchesTencentQuote, tencentHistorySymbol, tencentQuoteSymbol } from './stockMarkets'
import type { Stock } from './market'

export type ChartPeriod = 'intraday' | '1d' | '1w' | '1m'

export interface HistoryPoint {
  time: number
  open: number
  close: number
  high: number
  low: number
  volume: number | null
  volumeShares?: number | null
  previousClose?: number | null
  averagePrice?: number | null
}

type HistoryRequest = <T>(url: URL, errorLabel: string, signal: AbortSignal) => Promise<T>
type HistorySource = (signal: AbortSignal) => Promise<HistoryPoint[]>
type KlinePeriod = 'day' | 'week' | 'month'

interface SinaCandle {
  day: unknown
  open: unknown
  close: unknown
  high: unknown
  low: unknown
  volume: unknown
}

interface EastmoneyHistory {
  code: unknown
  market: unknown
  preClose?: unknown
  prePrice?: unknown
  trends: string[]
  klines: string[]
}

interface TencentHistory {
  code: number
  data?: Record<string, TencentStock | undefined>
}

type TencentStock = {
  qt?: Record<string, unknown[]>
  data?: { date: unknown; data: string[] }
} & Partial<Record<KlinePeriod | `qfq${KlinePeriod}`, unknown[][]>>

const timeoutMs = 2500
const limit = 500
const endDate = '2050-01-01'
const periods = { '1d': ['101', 'day'], '1w': ['102', 'week'], '1m': ['103', 'month'] } as const
const eastmoneyFields = 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13'

function checkCanceled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('行情请求已取消', 'AbortError')
}

export function withDeadline<T>(load: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  checkCanceled(signal)
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancel: (() => void) | undefined
  const interrupted = new Promise<never>((_, reject) => {
    cancel = () => {
      controller.abort()
      reject(new DOMException('行情请求已取消', 'AbortError'))
    }
    signal?.addEventListener('abort', cancel, { once: true })
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error('行情数据源请求超时'))
    }, timeoutMs)
  })
  const request = Promise.resolve().then(() => {
    checkCanceled(signal)
    return load(controller.signal)
  })
  return Promise.race([request, interrupted]).finally(() => {
    clearTimeout(timer)
    if (cancel) signal?.removeEventListener('abort', cancel)
  })
}

function dateText(value: unknown) {
  const date = String(value).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')
  const time = new Date(date + 'T00:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(time.getTime()) ||
      time.toISOString().slice(0, 10) !== date) throw new Error('行情日期无效')
  return date
}

function point(
  date: unknown,
  minute: string | null,
  open: unknown,
  close: unknown,
  high: unknown,
  low: unknown,
  volume: unknown,
): HistoryPoint {
  const day = dateText(date)
  if (minute !== null && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(minute)) throw new Error('分时时间无效')
  if (day > endDate) throw new Error('行情日期超出范围')
  const time = Date.parse(day + (minute === null ? 'T00:00:00Z' : `T${minute}:00+08:00`)) / 1000
  const prices = [open, close, high, low].map((value) => value == null || value === '' ? NaN : Number(value))
  // Forward-adjusted historical candles can legitimately have negative prices.
  if (prices.some((price) => !Number.isFinite(price) || (minute !== null && price <= 0)) ||
      prices.every((price) => price === 0) ||
      prices[2] < Math.max(prices[0], prices[1]) || prices[3] > Math.min(prices[0], prices[1])) {
    throw new Error('行情价格无效')
  }
  const amount = volume == null || volume === '' ? null : Number(volume)
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw new Error('成交量无效')
  return { time, open: prices[0], close: prices[1], high: prices[2], low: prices[3], volume: amount }
}

function sinaKlineSource(market: string, code: string, period: KlinePeriod, request: HistoryRequest): HistorySource | null {
  if (!['0', '1'].includes(market) || !/^\d{6}$/.test(code)) return null
  const symbol = tencentQuoteSymbol(market, code) ?? `bj${code}`
  const url = new URL('https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData')
  url.search = new URLSearchParams({
    symbol, scale: '240', ma: 'no', datalen: period === 'day' ? String(limit) : '1023',
  }).toString()
  return async (signal) => {
    const items = await request<SinaCandle[] | null>(url, '新浪 K 线', signal)
    if (!Array.isArray(items)) throw new Error('新浪 K 线格式错误')
    const daily = items.map((item) => point(item.day, null, item.open, item.close, item.high, item.low, item.volume))
    if (daily.some((row, index) => index > 0 && row.time <= daily[index - 1].time)) throw new Error('新浪 K 线日期无效')
    if (period === 'day') return daily.slice(-limit).map(({ volume, ...row }) => ({ ...row, volumeShares: volume, volume: null }))
    const buckets = new Map<number | string, HistoryPoint>()
    for (const row of daily) {
      const day = new Date(row.time * 1000)
      const monday = row.time - ((day.getUTCDay() + 6) % 7) * 86400
      const key = period === 'week' ? monday : day.toISOString().slice(0, 7)
      const previous = buckets.get(key)
      const volumeShares = previous && (previous.volumeShares == null || row.volume == null)
        ? null : (previous?.volumeShares ?? 0) + (row.volume ?? 0)
      buckets.set(key, {
        time: row.time, open: previous?.open ?? row.open, close: row.close,
        high: Math.max(previous?.high ?? row.high, row.high),
        low: Math.min(previous?.low ?? row.low, row.low),
        volume: null, volumeShares: previous ? volumeShares : row.volume,
      })
    }
    return [...buckets.values()].slice(-limit)
  }
}

function positivePrice(value: unknown) {
  const price = Number(value)
  return Number.isFinite(price) && price > 0 ? price : null
}

function eastmoneySource(
  origin: string, market: string, code: string, intraday: boolean,
  klt: string, clientId: string, request: HistoryRequest,
): HistorySource {
  const url = new URL(intraday ? '/api/qt/stock/trends2/get' : '/api/qt/stock/kline/get', origin)
  const query: Record<string, string> = intraday
    ? { ndays: '1', iscr: '0', iscca: '0', fields2: 'f51,f53,f56,f58' }
    : { end: endDate.replaceAll('-', ''), fqt: '1', klt, lmt: String(limit), rtntype: '6',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61', ut: clientId }
  url.search = new URLSearchParams({
    ...query, fields1: intraday ? `${eastmoneyFields},f14` : eastmoneyFields, secid: `${market}.${code}`,
  }).toString()

  return async (signal) => {
    const { data } = await request<{ data?: EastmoneyHistory | null }>(url, '历史行情', signal)
    if (!data || String(data.code) !== code || String(data.market) !== market) throw new Error('行情证券代码不匹配')
    if (intraday) {
      const previousClose = positivePrice(data.preClose) ?? positivePrice(data.prePrice)
      return data.trends.map((row) => {
        const [stamp, price, volume, averagePrice] = row.split(',')
        const [date, minute] = stamp.split(' ')
        return {
          ...point(date, minute, price, price, price, price, volume),
          previousClose,
          averagePrice: positivePrice(averagePrice),
        }
      })
    }
    return data.klines.map((row) => {
      const [date, open, close, high, low, volume] = row.split(',')
      return point(date, null, open, close, high, low, volume)
    })
  }
}

function tencentSource(
  origin: string, market: string, code: string, intraday: boolean,
  period: KlinePeriod, request: HistoryRequest,
): HistorySource | null {
  const american = isUSMarket(market)
  const symbol = intraday ? tencentQuoteSymbol(market, code) : tencentHistorySymbol(market, code)
  if (!symbol || (intraday && american)) return null
  const hongKong = market === '116'
  const url = new URL(origin + (intraday ? '/appstock/app/minute/query' : '/appstock/app/newfqkline/get'))
  url.search = new URLSearchParams(intraday ? { code: symbol } : {
    param: `${symbol},${period},,${endDate},${limit},qfq`,
  }).toString()
  return async (signal) => {
    const payload = await request<TencentHistory | null>(url, '腾讯行情', signal)
    const stock = payload?.data?.[symbol]
    const quote = stock?.qt?.[symbol]
    if (payload?.code !== 0 || !stock || !Array.isArray(quote) || !matchesTencentQuote(symbol, market, code, quote[2])) {
      throw new Error('腾讯行情证券代码不匹配')
    }
    if (intraday) {
      const minuteData = stock.data
      if (!minuteData) throw new Error('行情日期无效')
      const date = dateText(minuteData.date)
      const previousClose = positivePrice(quote[4])
      const quoteTime = String(quote[30]).replace(/[-/: ]/g, '')
      if (!/^\d{8}(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(quoteTime) ||
          date !== dateText(quoteTime.slice(0, 8))) throw new Error('腾讯分时与行情日期不一致')
      const quoteMinute = quoteTime.slice(8, 12)
      const morningClose = hongKong ? '1200' : '1130'
      const marketClose = hongKong ? '1600' : '1500'
      const sharesPerLot = hongKong || /^sh68[89]\d{3}$/.test(symbol) ? 1 : 100
      const points = new Map<number, HistoryPoint>()
      let previousMinute = ''
      let previousVolume: number | null = null
      let estimatedAmount = 0
      let canEstimate = true
      for (const row of minuteData.data) {
        const [hhmm, price, totalVolume, totalAmount] = row.trim().split(/\s+/)
        if (!/^\d{4}$/.test(hhmm) || hhmm < previousMinute) throw new Error('腾讯分时时间无效')
        previousMinute = hhmm
        const closingAuction = hongKong && hhmm > marketClose && hhmm <= '1610'
        const time = closingAuction ? marketClose : hhmm
        if (!(time >= '0930' && time <= morningClose) && !(time >= '1300' && time <= marketClose)) continue
        if (hhmm > quoteMinute) throw new Error('腾讯分时超出行情时间')
        const cumulative: number | null = totalVolume && Number.isFinite(Number(totalVolume)) && Number(totalVolume) >= 0
          ? Number(totalVolume) * sharesPerLot : null
        const baseline: number | null = time === '0930' && points.size === 0 ? 0 : previousVolume
        const delta = cumulative != null && baseline != null && cumulative >= baseline ? cumulative - baseline : null
        previousVolume = cumulative
        const value = point(date, `${time.slice(0, 2)}:${time.slice(2)}`, price, price, price, price, null)
        if (delta == null) canEstimate = false
        else estimatedAmount += value.close * delta
        const averagePrice = cumulative != null && cumulative > 0
          ? positivePrice(Number(totalAmount) / cumulative) ?? (canEstimate ? estimatedAmount / cumulative : null)
          : null
        const preceding = points.get(value.time)?.volumeShares
        points.set(value.time, {
          ...value, previousClose,
          volumeShares: delta == null ? null : (preceding ?? 0) + delta,
          averagePrice,
        })
      }
      return [...points.values()]
    }

    const adjusted = stock[`qfq${period}`]
    const rows = adjusted?.length ? adjusted : stock[period]
    if (!Array.isArray(rows)) throw new Error('腾讯 K 线序列为空')
    const inShares = hongKong || american || /^sh68[89]\d{3}$/.test(symbol)
    return rows.slice(-limit).map(([date, open, close, high, low, volume]) => {
      const row = point(date, null, open, close, high, low, volume)
      return inShares ? { ...row, volume: null, volumeShares: row.volume } : row
    })
  }
}

export async function loadProviderHistory(
  row: Pick<Stock, 'info_market' | 'info_code'>,
  period: ChartPeriod,
  signal: AbortSignal | undefined,
  request: HistoryRequest,
  clientId: string,
): Promise<HistoryPoint[]> {
  const intraday = period === 'intraday'
  const config = intraday ? ['', 'day'] as const : periods[period]
  if (!config) throw new Error('不支持的行情周期')
  const [klt, tencentPeriod] = config
  const market = String(row.info_market)
  const code = String(row.info_code)
  const eastmoney = (origin: string) => eastmoneySource(origin, market, code, intraday, klt, clientId, request)
  const tencent = (origin: string) => tencentSource(origin, market, code, intraday, tencentPeriod, request)
  const american = isUSMarket(market)
  const delay = 'https://push2delay.eastmoney.com'
  const delay2 = 'https://push2delay2.eastmoney.com'
  const proxy = 'https://proxy.finance.qq.com/ifzqgtimg'
  const tencentWeb = 'https://web.ifzq.gtimg.cn'
  const sources = intraday ? [
    tencent(proxy),
    tencent(tencentWeb),
    eastmoney(american ? delay2 : delay),
    eastmoney(american ? delay : delay2),
    eastmoney('https://push2.eastmoney.com'),
    eastmoney('https://push2his.eastmoney.com'),
  ] : [
    eastmoney('https://push2his.eastmoney.com'),
    eastmoney('https://push2.eastmoney.com'),
    tencent(proxy),
    tencent(tencentWeb),
    sinaKlineSource(market, code, tencentPeriod, request),
    eastmoney(delay),
    eastmoney(delay2),
  ]
  for (const source of sources) {
    if (!source) continue
    checkCanceled(signal)
    try {
      const points = await withDeadline(source, signal)
      checkCanceled(signal)
      if (points.length && points.every((value, index) => index === 0 || value.time > points[index - 1].time)) return points
    } catch {
      checkCanceled(signal)
    }
  }
  throw new Error('行情数据源暂不可用')
}
