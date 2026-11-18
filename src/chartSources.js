const timeoutMs = 2500
const limit = 500
const endDate = '2050-01-01'
const periods = { '1d': [101, 'day'], '1w': [102, 'week'], '1m': [103, 'month'] }
const eastmoneyFields = 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13'

function checkCanceled(signal) {
  if (signal?.aborted) throw new DOMException('行情请求已取消', 'AbortError')
}

export function withDeadline(load, signal) {
  checkCanceled(signal)
  const controller = new AbortController()
  let timer
  let cancel
  const interrupted = new Promise((_, reject) => {
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
    signal?.removeEventListener('abort', cancel)
  })
}

function dateText(value) {
  const date = String(value).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')
  const time = new Date(date + 'T00:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(time.getTime()) ||
      time.toISOString().slice(0, 10) !== date) throw new Error('行情日期无效')
  return date
}

function point(date, minute, open, close, high, low, volume) {
  const day = dateText(date)
  if (minute !== null && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(minute)) throw new Error('分时时间无效')
  if (day > endDate) throw new Error('行情日期超出范围')
  const time = Date.parse(day + (minute === null ? 'T00:00:00Z' : `T${minute}:00+08:00`)) / 1000
  const prices = [open, close, high, low].map(Number)
  if (prices.some((price) => !Number.isFinite(price) || price <= 0) ||
      prices[2] < Math.max(prices[0], prices[1]) || prices[3] > Math.min(prices[0], prices[1])) {
    throw new Error('行情价格无效')
  }
  const amount = volume == null || volume === '' ? null : Number(volume)
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw new Error('成交量无效')
  return { time, open: prices[0], close: prices[1], high: prices[2], low: prices[3], volume: amount }
}

function eastmoneySource(origin, market, code, intraday, klt, clientId, request) {
  const url = new URL(intraday ? '/api/qt/stock/trends2/get' : '/api/qt/stock/kline/get', origin)
  const query = intraday
    ? { ndays: '1', iscr: '0', fields2: 'f51,f53,f56,f58' }
    : { end: endDate.replaceAll('-', ''), fqt: '1', klt, lmt: limit, rtntype: '6',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61', ut: clientId }
  url.search = new URLSearchParams({ ...query, fields1: eastmoneyFields, secid: `${market}.${code}` })

  return async (signal) => {
    const { data } = await request(url, '历史行情', signal)
    if (String(data?.code) !== code || String(data.market) !== market) throw new Error('行情证券代码不匹配')
    if (intraday) {
      return data.trends.map((row) => {
        const [stamp, price, volume] = row.split(',')
        const [date, minute] = stamp.split(' ')
        return point(date, minute, price, price, price, price, volume)
      })
    }
    return data.klines.map((row) => {
      const [date, open, close, high, low, volume] = row.split(',')
      return point(date, null, open, close, high, low, volume)
    })
  }
}

function tencentSource(market, code, intraday, period, request) {
  if (!/^[01]$/.test(market) || !/^\d{6}$/.test(code) || (market === '0' && /^(?:[48]|92)/.test(code))) return null
  const symbol = `${market === '1' ? 'sh' : 'sz'}${code}`
  const url = new URL(intraday
    ? 'https://web.ifzq.gtimg.cn/appstock/app/minute/query'
    : 'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get')
  url.search = new URLSearchParams(intraday ? { code: symbol } : {
    param: `${symbol},${period},,${endDate},${limit},qfq`,
  })
  return async (signal) => {
    const payload = await request(url, '腾讯行情', signal)
    const stock = payload?.data?.[symbol]
    const quote = stock?.qt?.[symbol]
    if (payload?.code !== 0 || !Array.isArray(quote) || quote[2] !== code) throw new Error('腾讯行情证券代码不匹配')
    if (intraday) {
      const date = dateText(stock.data?.date)
      const quoteTime = String(quote[30])
      if (!/^\d{8}(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(quoteTime) ||
          date !== dateText(quoteTime.slice(0, 8))) throw new Error('腾讯分时与行情日期不一致')
      const quoteMinute = quoteTime.slice(8, 12)
      const points = new Map()
      for (const row of stock.data.data) {
        const [hhmm, price] = row.trim().split(/\s+/)
        if (!/^\d{4}$/.test(hhmm)) throw new Error('腾讯分时时间无效')
        if (!(hhmm >= '0930' && hhmm <= '1130') && !(hhmm >= '1300' && hhmm <= '1500')) continue
        if (hhmm > quoteMinute) throw new Error('腾讯分时超出行情时间')
        const value = point(date, `${hhmm.slice(0, 2)}:${hhmm.slice(2)}`, price, price, price, price, null)
        points.set(value.time, value)
      }
      return [...points.values()].sort((a, b) => a.time - b.time)
    }

    const rows = stock[`qfq${period}`] ?? (/^(?:sh000|sz399)/.test(symbol) ? stock[period] : null)
    if (!Array.isArray(rows)) throw new Error('腾讯 K 线序列为空')
    return rows.slice(-limit).map(([date, open, close, high, low]) => point(date, null, open, close, high, low, null))
  }
}

export async function loadProviderHistory(row, period, signal, request, clientId) {
  const intraday = period === 'intraday'
  const [klt, tencentPeriod] = periods[period] ?? []
  if (!intraday && !klt) throw new Error('不支持的行情周期')
  const market = String(row.info_market)
  const code = String(row.info_code)
  const eastmoney = (origin) => eastmoneySource(origin, market, code, intraday, klt, clientId, request)
  const sources = [
    eastmoney('https://push2his.eastmoney.com'),
    eastmoney('https://push2.eastmoney.com'),
    tencentSource(market, code, intraday, tencentPeriod, request),
    eastmoney('https://push2delay.eastmoney.com'),
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
