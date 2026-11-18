import { expect, test } from '@playwright/test'

for (const useTencent of [false, true]) {
  test(`真实模式登录、切到${useTencent ? '腾讯' : '东方财富备用节点'}报价并验证 K 线降级`, async ({ page }) => {
    const requests = []
    const stock = { info_id: 7, info_market: 1, info_code: '600000', info_name: '模拟沪市' }
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
    await page.route('https://**/*', async route => {
      const request = route.request()
      const url = new URL(request.url())
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      requests.push({ host: url.host, path: url.pathname, token: request.headers().token })
      const json = (value) => route.fulfill({ headers, json: value })
      if (url.pathname.endsWith('/account/login')) return json({ status: '000', data: { token: 'fixture', account_id: 1 } })
      if (url.pathname.endsWith('/position/info')) {
        return json({ status: '000', data: { groups: [{ group_id: 1, group_name: '模拟自选', position: [stock] }] } })
      }
      if (url.pathname.endsWith('/ulist.np/get')) {
        expect(url.searchParams.get('fltt')).toBe('2')
        expect(url.searchParams.get('secids')).toBe('1.600000')
        if (useTencent || url.host === 'push2.eastmoney.com') return route.fulfill({ headers, status: 503 })
        if (url.host === '82.push2.eastmoney.com') {
          return json({ rc: 0, data: { diff: { 0: { f13: 1, f12: '600000', f2: 15.23, f3: 1.24 } } } })
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
        return json({ data: { code: '600000', market: 1, trends: ['2026-11-12 09:30,10,200,10', '2026-11-12 09:31,11,300,10'] } })
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
        ? ['push2.eastmoney.com', '82.push2.eastmoney.com', '80.push2.eastmoney.com', 'push2delay.eastmoney.com']
        : ['push2.eastmoney.com', '82.push2.eastmoney.com'])
    await page.getByRole('button', { name: '精简模式' }).click()
    await expect(page.getByText('15.23', { exact: true })).toBeVisible()
    await expect(page.getByText('+1.24%', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '精简模式' }).click()
    await page.getByRole('button', { name: /模拟沪市/ }).click()
    await expect(page.locator('canvas').first()).toBeVisible()
    await expect.poll(() => requests.filter(item => item.path.endsWith('/kline/get')).map(item => item.host))
      .toEqual(['push2his.eastmoney.com', 'push2.eastmoney.com'])
    await expect(page.getByText('正在加载历史行情')).toBeHidden()
    await expect(page.getByText(/行情数据源暂不可用|历史行情格式错误/)).toHaveCount(0)
    expect(requests.find(item => item.path.endsWith('/position/info')).token).toBe('fixture')
    expect(requests.filter(item => item.host !== 'api.hqzs.top').every(item => item.token === undefined)).toBe(true)
  })
}
