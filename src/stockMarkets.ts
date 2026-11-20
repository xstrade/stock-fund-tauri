const usMarkets: Readonly<Record<string, string>> = { 105: 'OQ', 106: 'N', 107: 'AM', 153: 'PS' }

export function isUSMarket(market: string) {
  return Object.prototype.hasOwnProperty.call(usMarkets, market)
}

export function tencentQuoteSymbol(market: string, code: string) {
  if (market === '116' && /^\d{5}$/.test(code)) return `hk${code}`
  if (market === '0' && /^\d{6}$/.test(code) && !/^(?:[48]|92)/.test(code)) return `sz${code}`
  if (market === '1' && /^\d{6}$/.test(code)) return `sh${code}`
  if (isUSMarket(market) && /^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)*$/.test(code)) return `us${code}`
  return null
}

export function tencentHistorySymbol(market: string, code: string) {
  const symbol = tencentQuoteSymbol(market, code)
  return symbol && isUSMarket(market) ? `${symbol}.${usMarkets[market]}` : symbol
}

export function matchesTencentQuote(symbol: string, market: string, code: string, returnedCode: unknown) {
  if (!symbol.startsWith('us')) return returnedCode === code
  const venue = usMarkets[market]
  if (market === '153') return returnedCode === `${code}.PS` || returnedCode === `${code}.OTC`
  return returnedCode === `${code}.${venue}`
}
