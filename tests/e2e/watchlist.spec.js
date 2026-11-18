import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', route => route.abort())
  await page.goto('/')
  await expect(page.getByRole('button', { name: /示例沪市/ })).toBeVisible()
})

test('切换分组并搜索、添加、置顶、删除，重启页面后保留结果', async ({ page }) => {
  await page.getByRole('combobox', { name: '分组' }).selectOption({ label: '基金' })
  const search = page.getByRole('textbox', { name: '股票名称或代码' })
  await expect(search).toBeHidden()
  await page.getByRole('button', { name: '搜索股票' }).click()
  await expect(search).toBeFocused()
  await search.fill('600000')
  await search.press('Enter')
  await page.getByRole('button', { name: '添加' }).click()
  const row = page.getByRole('listitem').filter({ hasText: '600000' })
  await row.getByRole('button', { name: '置顶' }).click()
  await expect(page.locator('.quotes li').first()).toContainText('600000')
  await search.press('Escape')
  await expect(search).toBeHidden()
  await page.reload()
  await page.getByRole('combobox', { name: '分组' }).selectOption({ label: '基金' })
  await expect(page.locator('.quotes li').first()).toContainText('600000')
  await row.getByRole('button', { name: '删除' }).click()
  await expect(row).toHaveCount(0)
})

test('打开图表、切换周期并返回自选', async ({ page }) => {
  await expect(page.locator('.sparkline polyline').first()).toBeVisible()
  await page.getByRole('button', { name: /示例沪市/ }).click()
  await expect(page.locator('canvas').first()).toBeVisible()
  for (const label of ['分时', '周 K', '月 K', '日 K']) {
    const control = page.getByRole('button', { name: label, exact: true })
    await control.click()
    await expect(control).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('正在加载历史行情')).toBeHidden()
  }
  await page.getByRole('button', { name: '返回自选' }).click()
  await expect(page.locator('canvas')).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: '分组' })).toBeVisible()
})

test('设置导入仅保留界面配置，并在最小尺寸显示精简列表', async ({ page }) => {
  await page.setViewportSize({ width: 290, height: 260 })
  await expect(page.getByRole('button', { name: '最小化' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '隐藏到托盘' })).toHaveCount(0)
  await page.getByRole('button', { name: '设置' }).click()
  await page.getByLabel('导入旧版设置').setInputFiles({
    name: 'legacy.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ config: { stockView: 'simple', startToTop: true, viewTransparency: 80 }, user: { token: 'fixture-only' } })),
  })
  await expect(page.getByLabel('精简列表')).toBeChecked()
  await page.getByRole('button', { name: '保存设置' }).click()
  await page.reload()
  await expect(page.locator('.shell')).toHaveClass('shell compact')
  await expect(page.locator('.sparkline')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('desktop-settings'))))
    .toEqual({ compact: true, pinned: true, opacity: 80, shortcut: 'Alt+Z' })
})

test('精简模式从原分组打开分时，返回和重启后恢复滚动位置', async ({ page }) => {
  await page.evaluate(async () => {
    const { loadGroups, saveDemoGroups } = await import('/src/market.js')
    const groups = await loadGroups()
    const fund = groups[1].position[0]
    groups[1].position = Array.from({ length: 20 }, (_, index) => ({
      ...fund,
      info_code: String(510300 + index),
      info_name: `示例基金 ${index + 1}`,
    }))
    saveDemoGroups(groups)
  })
  await page.reload()
  const group = page.getByRole('combobox', { name: '分组' })
  await group.selectOption({ label: '基金' })
  const compact = page.getByRole('button', { name: '精简模式' })
  await compact.click()
  await expect(compact).toHaveAttribute('aria-pressed', 'true')
  await page.setViewportSize({ width: 300, height: 280 })
  const list = page.locator('.watchlist')
  await list.evaluate(element => { element.scrollTop = 270 })
  await expect.poll(() => page.evaluate(() => localStorage.getItem('watchlist:demo:scroll:2'))).toBe('270')

  await page.getByRole('button', { name: '示例基金 10', exact: true }).click()
  await expect(page.getByRole('button', { name: '分时', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('canvas').first()).toBeVisible()
  await page.getByRole('button', { name: '返回自选' }).click()
  await expect(group).toHaveValue('2')
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(270)
  await group.selectOption({ label: '我的自选' })
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(0)
  await group.selectOption({ label: '基金' })
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(270)

  await page.reload()
  await expect(group).toHaveValue('2')
  await expect(compact).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(270)
  await compact.click()
  await expect(compact).toHaveAttribute('aria-pressed', 'false')
})
