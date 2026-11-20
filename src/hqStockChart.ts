import type { ChartPeriod, HistoryPoint, Stock } from './market'
import { isUSMarket } from './stockMarkets'

interface MinuteQuote {
  date: number
  time: number
  price: number | null
  open?: number
  high?: number
  low?: number
  vol: number | null
  avprice?: number | null
}

interface MinuteStock {
  symbol: string
  name: string
  date: number
  yclose: number | null
  minute: MinuteQuote[]
}

interface MinuteData {
  code: 0
  stock: [MinuteStock]
}

type KLineRow = [
  date: number, previousClose: number | null, open: number, high: number,
  low: number, close: number, volume: number | null, amount: null,
]

interface KLineData {
  code: 0
  symbol: string
  name: string
  ver: 2
  data: KLineRow[]
}

type ChartData = MinuteData | KLineData

interface ChartFrame<T> {
  SubFrame: [{ Frame: T }, ...unknown[]]
}

interface ChartRequest {
  Name: string
  PreventDefault: boolean
  Self: {
    Frame: ChartFrame<{ YSplitOperator: { FixedYMaxMin?: { Min: number; Max: number } } }>
  }
}

interface ChartOptions {
  Type: '分钟走势图' | '历史K线图'
  Symbol: string
  NetworkFilter(
    request: ChartRequest,
    callback: (data: ChartData | { code: 0; stock: [] }) => void,
  ): void
  [key: string]: unknown
}

interface ChartInstance {
  ChartDestroy(): void
  SetOption(options: ChartOptions): void
  OnSize(): void
  JSChartContainer: {
    IsOnTouch: boolean
    IsPauseUpdateByKeyboard(): boolean
    GetKData(): { DataOffset: number; Data: { Date: number }[] } | null
    Frame: ChartFrame<{ XPointCount: number }>
    CustomShow?: { Date: number; PageSize: number }
    TitlePaint: { IsShowDateTime: boolean }[]
  }
}

export interface HQChartApi {
  GetMinuteTimeStringData(): { GetTimeData(symbol: string): number[] }
  SetStyle(style: { DisableLogo: boolean }): void
  Init(host: HTMLElement): ChartInstance
}

const klinePeriods = { '1d': 0, '1w': 1, '1m': 2 }
const exchanges: Partial<Record<string, string>> = { 0: 'sz', 1: 'sh', 116: 'hk' }
const [chinaTime, newYorkTime] = ['Asia/Shanghai', 'America/New_York'].map((timeZone) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }))

function positivePrice(value: number | null | undefined) {
  return value != null && Number.isFinite(value) && value > 0 ? value : null
}

export function toChartData(stock: Stock, period: ChartPeriod, rows: HistoryPoint[]): ChartData | null {
  if (!Array.isArray(rows) || rows.some((row, index) =>
    ![row.time, row.open, row.high, row.low, row.close].every(Number.isFinite) ||
    Math.abs(row.time) > 8640000000000 ||
    (row.volume != null && (!Number.isFinite(row.volume) || row.volume < 0)) ||
    (row.volumeShares != null && (!Number.isFinite(row.volumeShares) || row.volumeShares < 0)) ||
    row.high < Math.max(row.open, row.close) ||
    row.low > Math.min(row.open, row.close) ||
    (index > 0 && row.time <= rows[index - 1].time))) {
    throw new Error('历史行情格式错误')
  }
  if (!rows.length) return null

  const code = String(stock.info_code)
  const market = String(stock.info_market)
  const beijing = market === '0' && /^(?:[48]|92)/.test(code)
  const american = isUSMarket(market)
  const exchange = american ? 'usa' : beijing ? 'bj' : exchanges[market]
  const symbol = exchange ? `${code}.${exchange}` : code
  // The mainland providers supply volume in lots. HQChart takes share counts.
  const lotSize = market === '0' || market === '1' ? 100 : 1
  const volume = (row: HistoryPoint) => row.volumeShares ?? (row.volume == null ? null : row.volume * lotSize)

  if (period === 'intraday') {
    if (!exchange) throw new Error('该市场暂不支持分时图')
    const clock = american ? newYorkTime : chinaTime
    const minute = rows.map((row) => {
      const parts = Object.fromEntries(clock.formatToParts(row.time * 1000).map(({ type, value }) => [type, value]))
      return {
        date: Number(parts.year + parts.month + parts.day),
        time: Number(parts.hour + parts.minute),
        price: row.close, open: row.open, high: row.high, low: row.low,
        vol: volume(row), avprice: positivePrice(row.averagePrice),
      }
    })
    const session = american ? minute.filter((row) => row.time >= 930 && row.time <= 1600) : minute
    const last = session[session.length - 1]
    if (!last) throw new Error('暂无交易时段内的分时行情')
    return { code: 0, stock: [{
      symbol, name: code, date: last.date,
      yclose: positivePrice(rows[rows.length - 1].previousClose),
      minute: session.filter((row) => row.date === last.date),
    }] }
  }

  return { code: 0, symbol, name: code, ver: 2, data: rows.map((row, index) => [
    Number(new Date(row.time * 1000).toISOString().slice(0, 10).replace(/-/g, '')),
    rows[index - 1]?.close ?? null, row.open, row.high, row.low, row.close, volume(row), null,
  ]) }
}

export function createStockChart(JSChart: HQChartApi, host: HTMLElement, period: ChartPeriod) {
  const intraday = period === 'intraday'
  const requestName = intraday ? 'MinuteChartContainer::RequestMinuteData' : 'KLineChartContainer::RequestHistoryData'
  let chart: ChartInstance | undefined
  let deliver: (() => void) | undefined
  let layout: string | undefined
  let currentData: ChartData

  function destroy() {
    chart?.ChartDestroy()
    host.textContent = ''
    chart = undefined
    deliver = undefined
  }

  function render(data: ChartData) {
    currentData = data
    if ('stock' in data) {
      const stock = data.stock[0]
      // HQChart addresses minute bars by their index on the exchange's time axis.
      const slots = JSChart.GetMinuteTimeStringData().GetTimeData(stock.symbol)
      const quotes = new Map(stock.minute.map((row) => [row.time, row]))
      const lastSlot = slots.reduce((found, time, index) => quotes.has(time) ? index : found, -1)
      if (lastSlot < 0) throw new Error('暂无交易时段内的分时行情')
      const minute = slots.slice(0, lastSlot + 1)
        .map((time) => quotes.get(time) ?? { date: stock.date, time, price: null, vol: null })
      currentData = { ...data, stock: [{ ...stock, minute }] }
    }
    const stock = 'stock' in currentData ? currentData.stock[0] : currentData
    const hasPreviousClose = 'yclose' in stock && stock.yclose != null
    const hasAverage = 'minute' in stock && stock.minute.every((row) => row.price == null || row.avprice != null)
    const hasVolume = 'minute' in stock ? stock.minute.some((row) => row.vol != null) : stock.data.some((row) => row[6] != null)
    const nextLayout = [hasPreviousClose, hasAverage, hasVolume].join()
    if (chart && nextLayout === layout) {
      const engine = chart.JSChartContainer
      if (engine.IsOnTouch || engine.IsPauseUpdateByKeyboard()) return false
      if (!intraday) {
        const visible = engine.GetKData()
        const count = engine.Frame.SubFrame[0].Frame.XPointCount
        if (visible && visible.DataOffset + count < visible.Data.length) {
          engine.CustomShow = { Date: visible.Data[visible.DataOffset].Date, PageSize: count }
        }
      }
      // HQChart sets the delivery callback during SetOption.
      deliver!()
      return true
    }

    destroy()
    layout = nextLayout
    JSChart.SetStyle({ DisableLogo: true })
    chart = JSChart.Init(host)
    try {
      chart.SetOption({
        Type: intraday ? '分钟走势图' : '历史K线图',
        Symbol: stock.symbol,
        Language: 'CN',
        IsAutoUpdate: false,
        IsShowRightMenu: false,
        EnableVerifyRecvData: true,
        NetworkFilter(request, callback) {
          request.PreventDefault = true
          if (request.Name === requestName) {
            deliver = () => {
              const quote = 'stock' in currentData ? currentData.stock[0] : undefined
              if (quote && quote.yclose == null) {
                const prices = quote.minute.map((row) => row.price).filter((price) => price != null)
                request.Self.Frame.SubFrame[0].Frame.YSplitOperator.FixedYMaxMin = {
                  Min: Math.min(...prices), Max: Math.max(...prices),
                }
              }
              callback(currentData)
            }
            deliver()
          } else if (request.Name === 'KLineChartContainer::RequestFlowCapitalData') {
            callback({ code: 0, stock: [] })
          }
        },
        Border: { Left: intraday ? 48 : 8, Right: 55, Top: 22, Bottom: 20 },
        CorssCursorInfo: { Left: 2, Right: intraday && hasPreviousClose ? 1 : 2, Bottom: 1 },
        ...(intraday ? {
          DayCount: 1,
          MinuteLine: { IsShowAveragePrice: hasAverage, SplitType: hasPreviousClose ? 0 : 2 },
          MinuteTitle: { IsShowName: false, IsShowTime: true },
          MinuteVol: { BarColorType: 1 },
          Frame: [
            { SplitCount: 5, IsShowLeftText: true, IsShowRightText: hasPreviousClose },
            { SplitCount: 2, Height: hasVolume ? 4 : 0 },
          ],
        } : {
          IsApiPeriod: true,
          KLine: { Period: klinePeriods[period], Right: 0, DrawType: 0, DragMode: 1, KLineDoubleClick: false },
          KLineTitle: { IsShowName: false, IsShowSettingInfo: false, IsShowDateTime: host.clientWidth >= 320 },
          Windows: (hasVolume ? ['MA', 'VOL'] : ['MA']).map((Index) => ({
            Index, IsSinlgeLine: true, IsShowTitleArrow: false,
          })),
          Frame: [{ SplitCount: 5, Height: 8 }, { SplitCount: 3, Height: 3 }],
        }),
      })
    } catch (error) {
      destroy()
      throw error
    }
    return true
  }

  const resize = new ResizeObserver(() => {
    if (!chart) return
    const engine = chart.JSChartContainer
    if (!engine) return
    if (!intraday) engine.TitlePaint[0].IsShowDateTime = host.clientWidth >= 320
    chart.OnSize()
  })
  resize.observe(host)
  return {
    render,
    destroy() {
      resize.disconnect()
      destroy()
    },
  }
}
