import { expect, test, type Route } from '@playwright/test'

type RequestRecord = {
  host?: string
  hostname?: string
  path: string
  token?: string
  searchParams?: URLSearchParams
}

for (const useTencent of [false, true]) {
  test(`真实模式登录、切到${useTencent ? '腾讯' : '东方财富备用节点'}报价并验证 K 线降级`, async ({ page }) => {
    const requests: RequestRecord[] = []
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.addInitScript(() => {
      window.chartLabels = []
      const fillText = CanvasRenderingContext2D.prototype.fillText
      CanvasRenderingContext2D.prototype.fillText = function (label, ...args) {
        if (this.canvas.classList.contains('jschart-drawing')) window.chartLabels.push(String(label))
        return fillText.call(this, label, ...args)
      }
    })
    const stock = { info_id: 7, info_market: 1, info_code: '600000', info_name: '模拟沪市' }
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
    await page.route('https://**/*', async route => {
      const request = route.request()
      const url = new URL(request.url())
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      requests.push({ host: url.host, path: url.pathname, token: request.headers().token })
      const json = (value: unknown) => route.fulfill({ headers, json: value })
      if (url.pathname.endsWith('/account/login')) return json({ status: '000', data: { token: 'fixture', account_id: 1 } })
      if (url.pathname.endsWith('/position/info')) {
        return json({ status: '000', data: { groups: [{ group_id: 1, group_name: '模拟自选', position: [stock] }] } })
      }
      if (url.pathname.endsWith('/ulist.np/get')) {
        expect(url.searchParams.get('fltt')).toBe('2')
        expect(url.searchParams.get('secids')).toBe('1.600000')
        if (useTencent || url.host === 'push2.eastmoney.com') return route.fulfill({ headers, status: 503 })
        if (url.host === '82.push2.eastmoney.com') {
          return json({ rc: 0, data: { diff: { 0: {
            f13: 1, f12: '600000', f2: 15.23, f3: 1.24, f5: 1234567, f6: 45678901,
          } } } })
        }
      }
      if (url.host === 'qt.gtimg.cn') {
        expect(url.pathname).toBe('/q=sh600000')
        const fields = Array(33).fill('')
        fields[2] = '600000'
        fields[3] = '15.23'
        fields[32] = '1.24'
        return route.fulfill({ headers, body: `v_sh600000="${fields.join('~')}";` })
      }
      if (url.pathname.endsWith('/trends2/get')) {
        if (useTencent) return route.fulfill({ headers, status: 503 })
        return json({ data: { code: '600000', market: 1, preClose: 10, trends: [
          '2026-11-12 09:30,10,200,10', '2026-11-12 10:30,11,300,10.6',
        ] } })
      }
      if (url.pathname.endsWith('/minute/query')) {
        expect(url.searchParams.get('code')).toBe('sh600000')
        if (!useTencent) return route.fulfill({ headers, status: 503 })
        const quote = Array(31).fill('')
        quote[2] = '600000'
        quote[4] = '10'
        quote[30] = '20261112103000'
        return json({ code: 0, data: { sh600000: {
          data: { date: '20261112', data: ['0930 10', '1030 11'] },
          qt: { sh600000: quote },
        } } })
      }
      if (url.pathname.endsWith('/kline/get') && url.host === 'push2his.eastmoney.com') return route.fulfill({ headers, status: 503 })
      if (url.pathname.endsWith('/kline/get') && url.host === 'push2.eastmoney.com') {
        return json({ data: { code: '600000', market: 1, klines: ['2026-11-12,10,11,12,9,1000'] } })
      }
      return route.abort()
    })

    await page.goto('/')
    await page.getByLabel('账号').fill('fixture')
    await page.getByLabel('密码').fill('fixture')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page.getByText('15.23', { exact: true })).toBeVisible()
    await expect(page.getByText('+1.24%', { exact: true })).toBeVisible()
    expect(requests.filter(item => item.path.endsWith('/ulist.np/get')).map(item => item.host))
          .toEqual(useTencent
        ? ['push2.eastmoney.com', '82.push2.eastmoney.com', '80.push2.eastmoney.com', 'push2delay.eastmoney.com', 'push2delay2.eastmoney.com']
        : ['push2.eastmoney.com', '82.push2.eastmoney.com'])
    await page.getByRole('button', { name: '精简模式' }).click()
    await expect(page.getByText('15.23', { exact: true })).toBeVisible()
    await expect(page.getByText('+1.24%', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '精简模式' }).click()
    await page.getByRole('button', { name: /模拟沪市/ }).click()
    await expect(page.locator('canvas.jschart-drawing')).toBeVisible()
    await expect.poll(() => requests.filter(item => item.path.endsWith('/kline/get')).map(item => item.host))
      .toEqual(['push2his.eastmoney.com', 'push2.eastmoney.com'])
    await expect(page.getByText('正在加载历史行情')).toBeHidden()
    await expect(page.getByText(/行情数据源暂不可用|历史行情格式错误/)).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.chartLabels)).toContain('收:11.00')
    expect(await page.evaluate(() => window.chartLabels)).not.toContain('*仅学习使用*')
    await page.evaluate(() => { window.chartLabels = [] })
    await page.getByRole('button', { name: '分时', exact: true }).click()
    const canvas = page.locator('canvas.jschart-drawing')
    await expect(canvas).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.chartLabels)).toContain('0%')
    const dimensions = await canvas.boundingBox()
    // Hit inside slot 61 (10:30), allowing for canvas pixel rounding.
    const x = 48 + (dimensions!.width - 48 - 55) * 61.65 / 242
    await canvas.hover({ position: { x, y: 65 } })
    await expect.poll(() => page.evaluate(() => window.chartLabels)).toContain('价:11.00')
    const labels = await page.evaluate(() => window.chartLabels)
    if (useTencent) expect(labels).not.toContain('均:10.60')
    else expect(labels).toContain('均:10.60')
    expect(await page.evaluate(() => window.chartLabels)).not.toContain('*仅学习使用*')
    expect(pageErrors).toEqual([])
    expect(requests.find(item => item.path.endsWith('/position/info'))?.token).toBe('fixture')
    expect(requests.filter(item => item.host !== 'api.hqzs.top').every(item => item.token === undefined)).toBe(true)
  })
}

for (const instrument of [
  {
    name: '港股分时、K线和搜索添加',
    market: '116',
    code: '00700',
    nameText: '腾讯控股',
    search: '00700',
    quoteSymbol: 'hk00700',
    previousClose: '348.40',
    intradayPrice: '344.00',
    hoverPrice: '341.00',
    klineHost: 'push2.eastmoney.com',
    intradayHost: 'proxy.finance.qq.com',
  },
  {
    name: '美股分时、K线和搜索添加',
    market: '105',
    code: 'AAPL',
    nameText: '苹果',
    search: 'AAPL',
    quoteSymbol: 'usAAPL',
    previousClose: '352.45',
    intradayPrice: '349.21',
    hoverPrice: '350.00',
    klineHost: 'push2his.eastmoney.com',
    intradayHost: 'push2delay2.eastmoney.com',
  },
]) {
  test(instrument.name, async ({ page }) => {
    const requests: RequestRecord[] = []
    const pageErrors: string[] = []
    const positions: { info_id: number; info_market: number; info_code: string; info_name: string; stock_type: string; price: number; zdf: number }[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.addInitScript(() => {
      window.chartLabels = []
      const fillText = CanvasRenderingContext2D.prototype.fillText
      CanvasRenderingContext2D.prototype.fillText = function (label, ...args) {
        if (this.canvas.classList.contains('jschart-drawing')) window.chartLabels.push(String(label))
        return fillText.call(this, label, ...args)
      }
    })

    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
    const json = (route: Route, value: unknown) => route.fulfill({ headers, json: value })
    const stock = {
      info_id: 29, info_market: Number(instrument.market), info_code: instrument.code,
      info_name: instrument.nameText, stock_type: instrument.market === '116' ? '港股' : '美股',
      price: 349.21, zdf: -0.92,
    }
    await page.route('https://**/*', async route => {
      const request = route.request()
      const url = new URL(request.url())
      const hostname = url.hostname
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      requests.push({ hostname, path: url.pathname, searchParams: url.searchParams })

      if (url.pathname.endsWith('/account/login')) {
        return json(route, { status: '000', data: { token: 'fixture', account_id: 1 } })
      }
      if (url.pathname.endsWith('/position/info')) {
        return json(route, { status: '000', data: { groups: [{
          group_id: 1, group_name: '测试自选', position: [...positions],
        }] } })
      }
      if (url.pathname.endsWith('/position/operation/')) {
        const body = request.postDataJSON()
        expect(body).toMatchObject({
          group_id: 1, info_code: instrument.code, info_market: Number(instrument.market),
        })
        positions.push(stock)
        return json(route, { status: '000', data: {} })
      }
      if (url.pathname.endsWith('/Info/Search')) {
        expect(url.searchParams.get('and14')).toContain(instrument.search)
        return json(route, { Data: [{
          Name: instrument.nameText, Code: instrument.code,
          MktNum: Number(instrument.market), SecurityTypeName: stock.stock_type,
        }] })
      }
      if (url.pathname.endsWith('/ulist.np/get')) {
        const item = {
          f13: Number(instrument.market), f12: instrument.code,
          f2: Number(instrument.intradayPrice), f3: -0.92, f4: -3.24, f18: Number(instrument.previousClose),
          f5: 1234567, f6: 45678901,
        }
        return json(route, { rc: 0, data: { diff: { 0: item } } })
      }
      if (url.hostname === 'qt.gtimg.cn') {
        const fields = Array(38).fill('')
        fields[2] = instrument.market === '116' ? instrument.code : `${instrument.code}.OQ`
        fields[3] = instrument.intradayPrice
        fields[4] = instrument.previousClose
        fields[32] = '-0.92'
        return route.fulfill({ headers, body: `v_${instrument.quoteSymbol}="${fields.join('~')}";` })
      }
      if (url.pathname.endsWith('/kline/get')) {
        if (hostname !== instrument.klineHost) return route.fulfill({ headers, status: 503 })
        expect(url.searchParams.get('secid')).toBe(`${instrument.market}.${instrument.code}`)
        const klines = ['2026-11-18,350,349,353,348,1000']
        return json(route, { data: {
          code: instrument.code, market: Number(instrument.market), klines,
        } })
      }
      if (url.pathname.endsWith('/minute/query')) {
        expect(url.searchParams.get('code')).toBe(instrument.quoteSymbol)
        if (instrument.market !== '116') return route.fulfill({ headers, status: 503 })
        const quote = Array(31).fill('')
        quote[2] = instrument.code
        quote[4] = instrument.previousClose
        quote[30] = '2026/11/20 16:08:37'
        return json(route, { code: 0, data: { [instrument.quoteSymbol]: {
          data: {
            date: '20261120',
            data: [
              '0930 341.000 1855780 636947197.480',
              '0931 348.000 3311411 1139249072.680',
              '1559 343.600 38072159 13050368173.680',
              '1608 344.000 41094469 14089992865.680',
            ],
          },
          qt: { [instrument.quoteSymbol]: quote },
        } } })
      }
      if (url.pathname.endsWith('/trends2/get')) {
        if (hostname !== instrument.intradayHost) return route.fulfill({ headers, status: 503 })
        if (instrument.market !== '105') return route.fulfill({ headers, status: 503 })
        expect(url.searchParams.get('secid')).toBe('105.AAPL')
        expect(url.searchParams.get('iscca')).toBe('0')
        return json(route, { data: {
          code: 'AAPL', market: 105, preClose: 352.45,
          trends: [
            '2026-11-19 22:30,350.00,1000000,350.00',
            '2026-11-20 04:59,348.00,1500000,349.00',
            '2026-11-20 05:00,349.21,2000000,349.21',
          ],
        } })
      }
      return route.abort()
    })

    await page.goto('/')
    await page.getByLabel('账号').fill('fixture')
    await page.getByLabel('密码').fill('fixture')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.getByRole('button', { name: '搜索股票' }).click()
    await page.getByLabel('股票名称或代码').fill(instrument.search)
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await expect(page.getByText(instrument.code, { exact: false }).first()).toBeVisible()
    await page.getByRole('button', { name: '添加', exact: true }).click()
    await expect(page.getByRole('button', { name: new RegExp(instrument.nameText) })).toBeVisible()
    await page.getByRole('button', { name: new RegExp(instrument.nameText) }).click()
    const canvas = page.locator('canvas.jschart-drawing')
    await expect(canvas).toBeVisible()
    const currency = instrument.market === '116' ? '港元' : '美元'
    await expect(page.locator('.chart-metrics')).toContainText('123.46万股')
    await expect(page.locator('.chart-metrics')).toContainText(`4567.89万${currency}`)
    await page.getByLabel('展开或收起行情摘要').click()
    await expect(page.locator('.chart-metrics')).toContainText('昨收')
    await expect(page.locator('.chart-metrics')).toContainText(instrument.market === '116' ? '348.400' : '352.45')

    for (const [period, klt] of [['日 K', '101'], ['周 K', '102'], ['月 K', '103']]) {
      await page.getByRole('button', { name: period, exact: true }).click()
      await expect.poll(() => requests.some(item => item.path.endsWith('/kline/get') &&
        item.hostname === instrument.klineHost && item.searchParams?.get('klt') === klt)).toBe(true)
      await expect(page.getByText(/行情数据源暂不可用|历史行情格式错误/)).toHaveCount(0)
    }

    await page.evaluate(() => { window.chartLabels = [] })
    await page.getByRole('button', { name: '分时', exact: true }).click()
    const bounds = await canvas.boundingBox()
    const axisLength = instrument.market === '116' ? 331 : 390
    const x = 48 + (bounds!.width - 48 - 55) * 0.5 / axisLength
    await canvas.hover({ position: { x, y: 65 } })
    await expect.poll(() => page.evaluate((price) => window.chartLabels.some(label => label.includes(price)), instrument.hoverPrice)).toBe(true)
    const labels = await page.evaluate(() => window.chartLabels)
    expect(labels).not.toContain('*仅学习使用*')
    expect(pageErrors).toEqual([])
    expect(requests.some(item => item.path.endsWith('/Info/Search'))).toBe(true)
    expect(requests.some(item => item.path.endsWith('/position/operation/'))).toBe(true)
    if (instrument.market === '105') {
      expect(labels).toContain('16:00')
      expect(labels).not.toContain('22:30')
    } else {
      expect(requests.some(item => item.hostname === 'proxy.finance.qq.com' &&
        item.path.endsWith('/minute/query'))).toBe(true)
      expect(labels).toContain('16:00')
      expect(labels).not.toContain('16:08')
    }
  })
}
