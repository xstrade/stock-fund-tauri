<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { WatchStopHandle } from 'vue'
import hqchart from 'hqchart/lib/umychart.vue.js'
import { createStockChart, toChartData } from './hqStockChart'
import { isTauri } from '@tauri-apps/api/core'
import { desktopCommand } from './desktop'
import { demo, loadHistory } from './market'
import type { ChartPeriod, QuoteMetrics, Stock } from './market'
import { isUSMarket } from './stockMarkets'
import backIcon from './icons/chevron-left.svg'

const props = withDefaults(defineProps<{
  stock: Stock
  initialPeriod?: ChartPeriod
}>(), { initialPeriod: '1d' })
defineEmits<{ close: [] }>()
const period = ref(props.initialPeriod)
const periods: [ChartPeriod, string][] = [['intraday', '分时'], ['1d', '日 K'], ['1w', '周 K'], ['1m', '月 K']]
const surface = ref<HTMLDivElement | null>(null)
const status = ref('')
const market = computed(() => String(props.stock.info_market))
const mainland = computed(() => market.value === '0' || market.value === '1')
const currencyUnit = computed(() => mainland.value ? '元' : market.value === '116' ? '港元' : isUSMarket(market.value) ? '美元' : '')
const volumeUnit = computed(() => mainland.value ? '手' : '股')
type MetricKind = 'price' | 'amount' | 'volume' | '%'
const detailFields: [label: string, key: keyof QuoteMetrics, kind?: MetricKind][] = [
  ['今开', 'open', 'price'], ['昨收', 'previousClose', 'price'],
  ['最高', 'high', 'price'], ['最低', 'low', 'price'],
  ['换手率', 'turnover', '%'], ['振幅', 'amplitude', '%'],
  ['量比', 'volumeRatio'], ['市盈率(TTM)', 'pe'],
  ['市净率', 'pb'], ['总市值', 'marketCap', 'amount'],
]

function formatMetric(value: number | null | undefined, kind?: MetricKind) {
  if (value == null || !Number.isFinite(value)) return '—'
  if (kind === 'price') {
    const digits = market.value === '116' || (mainland.value && String(props.stock.stock_type ?? '').includes('ETF')) ? 3 : 2
    return value.toFixed(digits)
  }
  if (kind === 'amount' || kind === 'volume') {
    const unit = kind === 'amount' ? currencyUnit.value : volumeUnit.value
    if (Math.abs(value) >= 100000000) return `${(value / 100000000).toFixed(2)}亿${unit}`
    if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(2)}万${unit}`
    return `${value.toLocaleString('zh-CN')}${unit}`
  }
  return `${value.toFixed(2)}${kind ?? ''}`
}

let stop: WatchStopHandle | undefined

onMounted(() => {
  stop = watch(() => [props.stock.info_code, props.stock.info_market, period.value], (_, _previous, onCleanup) => {
    const controller = new AbortController()
    const stock = props.stock
    const selectedPeriod = period.value
    let chart: ReturnType<typeof createStockChart> | undefined
    let lastData: string | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    onCleanup(() => {
      controller.abort()
      clearTimeout(timer)
      chart?.destroy()
    })

    status.value = '正在加载历史行情'
    async function refresh() {
      try {
        const rows = await loadHistory(stock, selectedPeriod, controller.signal)
        const host = surface.value
        if (controller.signal.aborted || !host) return
        const data = toChartData(stock, selectedPeriod, rows)
        if (data) {
          const snapshot = JSON.stringify(data)
          if (snapshot !== lastData) {
            chart ??= createStockChart(hqchart.JSChart, host, selectedPeriod)
            if (chart.render(data)) lastData = snapshot
          }
        } else {
          chart?.destroy()
          chart = undefined
          lastData = undefined
        }
        status.value = data ? '' : '暂无历史行情'
      } catch (error) {
        if (!controller.signal.aborted) status.value = error instanceof Error ? error.message : String(error)
      } finally {
        if (!demo && !controller.signal.aborted) timer = setTimeout(refresh, 30000)
      }
    }
    refresh()
  }, { immediate: true })
})

function openCredit() {
  if (isTauri()) {
    desktopCommand('open_chart_credit').catch((error) => { status.value = String(error) })
  } else {
    window.open('https://github.com/jones2000/HQChart', '_blank', 'noopener,noreferrer')
  }
}

onUnmounted(() => stop?.())
</script>

<template>
  <section class="chart panel-enter">
    <div class="chart-heading">
      <div class="chart-title">
        <h1>{{ stock.info_name }}</h1>
        <small>{{ stock.info_code }}</small>
      </div>
      <button class="chart-back" type="button" @click="$emit('close')"><img :src="backIcon" alt="">返回自选</button>
    </div>
    <details v-if="stock.metrics" class="chart-metrics">
      <summary aria-label="展开或收起行情摘要">
        <span>成交量 <strong>{{ formatMetric(stock.metrics.volume, 'volume') }}</strong></span>
        <span>成交额 <strong>{{ formatMetric(stock.metrics.amount, 'amount') }}</strong></span>
      </summary>
      <dl>
        <div v-for="[label, key, kind] in detailFields" :key="key">
          <dt>{{ label }}</dt>
          <dd>{{ formatMetric(stock.metrics[key], kind) }}</dd>
        </div>
      </dl>
    </details>
    <div class="periods" role="group" aria-label="图表周期">
      <button v-for="[value, label] in periods" :key="value" type="button" :aria-pressed="period === value" @click="period = value">{{ label }}</button>
    </div>
    <p v-if="status" class="chart-status" role="status">{{ status }}</p>
    <div class="chart-surface"><div ref="surface" class="chart-canvas"></div></div>
    <a href="https://github.com/jones2000/HQChart" target="_blank" rel="noopener noreferrer" @click.prevent="openCredit">图表由 HQChart 提供</a>
  </section>
</template>

<style scoped>
.chart {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  gap: 8px;
  padding: 8px 10px 10px;
  animation: panel-in .28s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes panel-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.chart-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.chart-title { display: grid; gap: 1px; min-width: 0; }
.chart-heading h1 { overflow-wrap: anywhere; letter-spacing: -0.02em; }
.chart-title small {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}
.chart-back {
  display: flex;
  align-items: center;
  gap: 2px;
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
  background: var(--accent-soft);
  border-color: transparent;
  border-radius: 8px;
  padding: 4px 9px;
}
.chart-back:enabled:hover {
  background: rgba(31, 95, 139, 0.16);
  border-color: transparent;
}
.chart-back img { width: 13px; height: 13px; }
.chart-metrics {
  color: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.chart-metrics summary { cursor: pointer; padding: 2px 1px; }
.chart-metrics summary span { display: inline-block; margin-inline-end: 10px; }
.chart-metrics strong, .chart-metrics dd { color: var(--ink); font-weight: 600; }
.chart-metrics dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(58px, 1fr));
  gap: 6px 10px;
  margin: 5px 0 0;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.65);
}
.chart-metrics dd { margin: 0; }
.periods {
  display: flex;
  gap: 3px;
  padding: 3px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-sm);
}
.periods button {
  flex: 1;
  padding: 5px 4px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  font-weight: 600;
}
.periods button[aria-pressed=false]:enabled:hover {
  background: rgba(31, 95, 139, 0.06);
  border-color: transparent;
}
.periods button[aria-pressed=true] {
  background: linear-gradient(180deg, #256891, var(--accent));
  color: #fff;
  box-shadow: 0 4px 10px rgba(31, 95, 139, 0.2);
}
.chart-status {
  padding: 6px 9px;
  color: var(--accent-deep);
  background: linear-gradient(180deg, #eef5fb, #e8f0f8);
  border: 1px solid rgba(31, 95, 139, 0.12);
  border-radius: 8px;
}
.chart-surface {
  flex: 1;
  position: relative;
  min-height: 130px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.72);
  box-shadow: var(--shadow-sm);
}
.chart-canvas { position: absolute; inset: 0; }
a {
  align-self: flex-start;
  font-size: 10px;
  color: var(--muted);
  text-decoration: none;
  transition: color .18s ease;
}
a:hover { color: var(--accent); }
@media (max-height: 350px) {
  .chart { gap: 5px; padding-block: 5px; }
  .chart-title small { display: none; }
  .chart-heading h1 { font-size: 14px; }
  .periods { padding: 2px; }
  .periods button { padding-block: 2px; }
  .chart-surface { min-height: 96px; }
}
</style>
