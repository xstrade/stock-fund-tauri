<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { CandlestickSeries, HistogramSeries, LineSeries, createChart } from 'lightweight-charts'
import { isTauri } from '@tauri-apps/api/core'
import { desktopCommand } from './desktop.js'
import { demo, loadHistory } from './market.js'
import backIcon from './icons/chevron-left.svg'

const props = defineProps({
  stock: { type: Object, required: true },
  initialPeriod: { type: String, default: '1d' },
})
const period = ref(props.initialPeriod)
const periods = [['intraday', '分时'], ['1d', '日 K'], ['1w', '周 K'], ['1m', '月 K']]
const surface = ref(null)
const status = ref('')
let chart
let candles
let volume
let average
let intraday
let stop

onMounted(() => {
  chart = createChart(surface.value, {
    autoSize: true,
    layout: { attributionLogo: false, background: { color: '#ffffff' }, textColor: '#586473' },
    grid: { vertLines: { color: '#eef0f3' }, horzLines: { color: '#eef0f3' } },
  })
  candles = chart.addSeries(CandlestickSeries, {
    upColor: '#c93f4f', downColor: '#14866b',
    borderVisible: false, wickUpColor: '#c93f4f', wickDownColor: '#14866b',
  })
  average = chart.addSeries(LineSeries, { color: '#ad7528', lineWidth: 1 })
  intraday = chart.addSeries(LineSeries, { color: '#356fa7', lineWidth: 2, visible: false })
  volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '' })
  volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })
  candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.25 } })
  stop = watch(() => [props.stock.info_code, props.stock.info_market, period.value], (_, previous, onCleanup) => {
    const controller = new AbortController()
    let timer
    onCleanup(() => {
      controller.abort()
      clearTimeout(timer)
    })
    const showIntraday = period.value === 'intraday'
    const localTime = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
    const formatTime = (time) => localTime.format(new Date(time * 1000))
    chart.applyOptions({
      localization: { timeFormatter: showIntraday ? formatTime : (time) => new Date(time * 1000).toISOString().slice(0, 10) },
      timeScale: { timeVisible: showIntraday, secondsVisible: false, tickMarkFormatter: showIntraday ? formatTime : () => null },
    })
    candles.applyOptions({ visible: !showIntraday })
    average.applyOptions({ visible: !showIntraday })
    intraday.applyOptions({ visible: showIntraday })
    status.value = '正在加载历史行情'
    for (const series of [candles, average, intraday, volume]) series.setData([])
    async function refresh(first) {
      try {
        const rows = await loadHistory(props.stock, period.value, controller.signal)
        if (controller.signal.aborted) return
        if (!Array.isArray(rows) || rows.some((row, i) =>
          ![row.time, row.open, row.high, row.low, row.close].every(Number.isFinite) ||
          (row.volume !== null && !Number.isFinite(row.volume)) ||
          row.high < Math.max(row.open, row.close, row.low) ||
          row.low > Math.min(row.open, row.close) ||
          (i > 0 && row.time <= rows[i - 1].time))) {
          throw new Error('历史行情格式错误')
        }
        if (showIntraday) intraday.setData(rows.map((row) => ({ time: row.time, value: row.close })))
        else candles.setData(rows)
        volume.setData(rows.filter((row) => row.volume !== null).map((row) => ({ time: row.time, value: row.volume, color: row.close >= row.open ? '#a64e5c' : '#297d68' })))
        if (!showIntraday) average.setData(rows.slice(4).map((row, i) => ({ time: row.time, value: rows.slice(i, i + 5).reduce((sum, item) => sum + item.close, 0) / 5 })))
        if (first) chart.timeScale().fitContent()
        status.value = rows.length ? '' : '暂无历史行情'
      } catch (error) {
        if (!controller.signal.aborted) status.value = error.message
      }
      if (!demo && !controller.signal.aborted) {
        timer = setTimeout(() => refresh(false), 30000)
      }
    }
    refresh(true)
  }, { immediate: true })
})

function openCredit() {
  if (isTauri()) {
    desktopCommand('open_chart_credit').catch((error) => { status.value = String(error) })
  } else {
    window.open('https://www.tradingview.com/', '_blank', 'noopener,noreferrer')
  }
}

onUnmounted(() => {
  stop?.()
  chart?.remove()
})
</script>

<template>
  <section class="chart">
    <div class="chart-heading">
      <div>
        <h1>{{ stock.info_name }}</h1>
        <small>{{ stock.info_code }}</small>
      </div>
      <button class="chart-back" type="button" @click="$emit('close')"><img :src="backIcon" alt="">返回自选</button>
    </div>
    <div class="periods" role="group" aria-label="图表周期">
      <button v-for="[value, label] in periods" :key="value" type="button" :aria-pressed="period === value" @click="period = value">{{ label }}</button>
    </div>
    <p v-if="status" role="status">{{ status }}</p>
    <div ref="surface" class="chart-surface"></div>
    <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer" @click.prevent="openCredit">图表由 TradingView Lightweight Charts 提供</a>
  </section>
</template>

<style scoped>
.chart { display: flex; flex: 1; flex-direction: column; min-width: 0; gap: 7px; padding: 8px 10px; }
.chart-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.chart-heading h1 { overflow-wrap: anywhere; }
.chart-back { display: flex; align-items: center; gap: 2px; color: var(--accent); font-size: 11px; }
.chart-back img { width: 13px; height: 13px; }
.periods { display: flex; gap: 3px; padding: 3px; border-radius: 5px; background: #f5f6f8; border: 1px solid var(--line); }
.periods button { flex: 1; padding: 4px; border: 0; background: transparent; color: var(--muted); }
.periods button[aria-pressed=true] { background: #e3ebf4; color: #285987; }
.chart-surface { flex: 1; min-height: 250px; border: 1px solid var(--line); border-radius: 5px; overflow: hidden; }
a { align-self: flex-start; font-size: 10px; color: var(--muted); }
</style>
