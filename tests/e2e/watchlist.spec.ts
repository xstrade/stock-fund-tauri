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
  await page.setViewportSize({ width: 230, height: 260 })
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
  await expect(page.getByRole('button', { name: '窗口置顶' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '最小化' })).toBeVisible()
  await expect(page.getByRole('button', { name: '隐藏到托盘' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '分组' })).toHaveCSS('font-size', '11px')
  await expect(page.locator('.window-drag-handle')).toHaveAttribute('data-tauri-drag-region', '')
  for (const selector of ['.shell', '.toolbar', '.quote-table']) {
    await expect(page.locator(selector)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(page.locator(selector)).toHaveCSS('background-image', 'none')
  }
  await expect(page.locator('.quote-price').nth(1)).toHaveText('12.6')
  const price = await page.locator('.quote-price').first().boundingBox()
  const change = await page.locator('.quote-change').first().boundingBox()
  expect(price).not.toBeNull()
  expect(change).not.toBeNull()
  expect(price!.x).toBeLessThan(change!.x)
  expect(price!.y).toBe(change!.y)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('desktop-settings') ?? 'null')))
    .toEqual({
      compact: true, pinned: true, opacity: 80, shortcut: 'Alt+Z',
      previousGroupShortcut: '', nextGroupShortcut: '',
    })
})

test('精简模式从原分组打开分时，返回和重启后恢复滚动位置', async ({ page }) => {
  await page.evaluate(async () => {
    const marketModulePath: string = '/src/market.ts'
    const { loadGroups, saveDemoGroups } = await import(marketModulePath)
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
  await expect(group.locator('option:checked')).toHaveText('基金')
  await page.setViewportSize({ width: 230, height: 365 })
  const list = page.locator('.watchlist')
  await list.evaluate(element => { element.scrollTop = 160 })
  await expect.poll(() => page.evaluate(() => localStorage.getItem('watchlist:demo:scroll:2'))).toBe('160')

  await page.getByRole('button', { name: '示例基金 10', exact: true }).click()
  await expect(page.getByRole('button', { name: '分时', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('canvas').first()).toBeVisible()
  await page.getByRole('button', { name: '返回自选' }).click()
  await expect(group).toHaveValue('2')
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(160)
  await group.selectOption({ label: '我的自选' })
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(0)
  await group.selectOption({ label: '基金' })
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(160)

  await page.reload()
  await expect(group).toHaveValue('2')
  await expect(compact).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(160)
  await compact.click()
  await expect(compact).toHaveAttribute('aria-pressed', 'false')
})

test('自定义快捷键可唤出自选并左右切换分组，设置在重启后保留', async ({ page }) => {
  await page.getByRole('button', { name: '设置' }).click()
  await page.getByLabel('唤出自选页面').fill('Alt+Q')
  const previousGroupShortcut = page.getByLabel('向左切换分组')
  await previousGroupShortcut.press('Alt+ArrowLeft')
  await expect(previousGroupShortcut).toHaveValue('Alt+ArrowLeft')
  await page.getByLabel('向右切换分组').fill('Alt+ArrowRight')
  await page.getByRole('button', { name: '保存设置' }).click()

  const group = page.getByRole('combobox', { name: '分组' })
  await expect(group).toBeVisible()
  await group.press('Alt+ArrowRight')
  await expect(group).toHaveValue('2')
  await page.keyboard.press('Alt+ArrowLeft')
  await expect(group).toHaveValue('1')

  await page.getByRole('button', { name: '示例沪市' }).click()
  await page.keyboard.press('Alt+Q')
  await expect(group).toBeVisible()

  await page.reload()
  await page.getByRole('button', { name: '设置' }).click()
  await expect(page.getByLabel('唤出自选页面')).toHaveValue('Alt+Q')
  await expect(page.getByLabel('向左切换分组')).toHaveValue('Alt+ArrowLeft')
  await expect(page.getByLabel('向右切换分组')).toHaveValue('Alt+ArrowRight')
})

test('重复快捷键提示冲突且不覆盖已保存的设置', async ({ page }) => {
  await page.getByRole('button', { name: '设置' }).click()
  await page.getByLabel('唤出自选页面').fill('Alt+Q')
  await page.getByLabel('向左切换分组').fill('Alt+ArrowLeft')
  await page.getByLabel('向右切换分组').fill('Alt+ArrowRight')
  await page.getByRole('button', { name: '保存设置' }).click()
  await expect(page.getByRole('combobox', { name: '分组' })).toBeVisible()

  const savedSettings = await page.evaluate(() => localStorage.getItem('desktop-settings'))
  await page.getByRole('button', { name: '设置' }).click()
  await page.getByLabel('向左切换分组').fill('Alt+Q')
  await page.getByRole('button', { name: '保存设置' }).click()

  await expect(page.getByRole('status')).toContainText('三个快捷键不能重复')
  await expect(page.getByRole('button', { name: '保存设置' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('desktop-settings'))).toBe(savedSettings)
})

test('模拟 Tauri 快捷键注册失败并通过托盘事件返回自选', async ({ page }) => {
  await page.route(url => new URL(url).pathname === '/', async route => {
    const response = await route.fetch()
    const html = (await response.text()).replace(
      '<script type="module" src="/src/main.ts"></script>',
      `<script type="module">
        import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js'
        mockWindows('main')
        window.isTauri = true
        window.__shortcutBridge = { active: null, attempts: [] }
        mockIPC((command, args) => {
          if (command === 'set_shortcut') {
            window.__shortcutBridge.attempts.push(args.shortcut)
            if (args.shortcut === 'Alt+W') throw new Error('快捷键已被占用')
            window.__shortcutBridge.active = args.shortcut
          }
          return null
        }, { shouldMockEvents: true })
      </script>
      <script type="module" src="/src/main.ts"></script>`,
    )
    await route.fulfill({ response, body: html })
  })
  await page.reload()
  await page.getByRole('button', { name: '设置' }).click()
  await page.getByLabel('唤出自选页面').fill('Alt+Q')
  await page.getByRole('button', { name: '保存设置' }).click()
  await expect(page.getByRole('combobox', { name: '分组' })).toBeVisible()

  const savedSettings = await page.evaluate(() => localStorage.getItem('desktop-settings'))
  await page.getByRole('button', { name: '设置' }).click()
  await page.getByLabel('唤出自选页面').fill('Alt+W')
  await page.getByRole('button', { name: '保存设置' }).click()
  await expect.poll(() => page.evaluate(() => window.__shortcutBridge.attempts)).toContain('Alt+W')
  await expect(page.getByRole('status')).toContainText('快捷键已被占用')
  expect(await page.evaluate(() => localStorage.getItem('desktop-settings'))).toBe(savedSettings)
  expect(await page.evaluate(() => window.__shortcutBridge.active)).toBe('Alt+Q')
  expect(await page.evaluate(() => window.__shortcutBridge.attempts)).toContain('Alt+W')

  const emitWatchlist = (action = 'watchlist') => page.evaluate(async (payload) => {
    const eventModulePath: string = '/node_modules/@tauri-apps/api/event.js'
    const { emit } = await import(eventModulePath)
    await emit('tray-action', payload)
  }, action)
  const previousGroupShortcut = page.getByLabel('向左切换分组')
  await previousGroupShortcut.focus()
  await emitWatchlist('watchlist-focused')
  await expect(previousGroupShortcut).toHaveValue('Alt+Q')
  await emitWatchlist()
  await expect(page.getByRole('combobox', { name: '分组' })).toBeVisible()
  await page.getByRole('button', { name: '示例沪市' }).click()
  await expect(page.locator('canvas').first()).toBeVisible()
  await emitWatchlist()
  await expect(page.getByRole('combobox', { name: '分组' })).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)
})
