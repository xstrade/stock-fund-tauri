<script lang="ts">
const maxConcurrentRequests = 3
const pending: (() => Promise<void> | undefined)[] = []
let active = 0

function drainQueue() {
  while (active < maxConcurrentRequests && pending.length) {
    const start = pending.shift()
    active += 1
    Promise.resolve()
      .then(start)
      .finally(() => {
        active -= 1
        drainQueue()
      })
  }
}

function enqueue(signal: AbortSignal, run: () => Promise<void>) {
  const start = () => {
    signal.removeEventListener('abort', remove)
    if (!signal.aborted) return run()
  }
  const remove = () => {
    const index = pending.indexOf(start)
    if (index !== -1) pending.splice(index, 1)
  }
  pending.push(start)
  signal.addEventListener('abort', remove, { once: true })
  drainQueue()
}
</script>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { demo, loadHistory, symbolKey } from './market'
import type { GroupId, Session, Stock } from './market'

const props = withDefaults(defineProps<{
  row: Stock
  user?: Session | null
  groupId: GroupId | null
}>(), { user: null })

const element = ref<SVGSVGElement | null>(null)
const inViewport = ref(false)
const pageVisible = ref(false)
const prices = ref<number[]>([])
let observer: IntersectionObserver | undefined

const identity = [() => symbolKey(props.row), () => props.groupId, () => props.user]
watch(identity, () => { prices.value = [] })
watch([...identity, inViewport, pageVisible], (_, previous, onCleanup) => {
  if (!inViewport.value || !pageVisible.value || (!demo && !props.user)) return

  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const request = () => enqueue(controller.signal, async () => {
    const attempt = new AbortController()
    const abortAttempt = () => attempt.abort()
    controller.signal.addEventListener('abort', abortAttempt, { once: true })
    const deadline = setTimeout(abortAttempt, 12000)
    try {
      const points = await loadHistory(props.row, 'intraday', attempt.signal)
      if (!controller.signal.aborted) {
        prices.value = Array.isArray(points)
          ? points.filter((point) => Number.isFinite(point?.close)).map((point) => point.close)
          : []
      }
    } catch {
      // Keep the last successful chart if the quote service is temporarily unavailable.
    } finally {
      clearTimeout(deadline)
      controller.signal.removeEventListener('abort', abortAttempt)
    }
    if (!demo && !controller.signal.aborted) timer = setTimeout(request, 30000)
  })
  onCleanup(() => {
    controller.abort()
    clearTimeout(timer)
  })
  request()
})

function updatePageVisibility() {
  pageVisible.value = !document.hidden
}

onMounted(() => {
  updatePageVisibility()
  document.addEventListener('visibilitychange', updatePageVisibility)
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(([entry]) => { inViewport.value = entry.isIntersecting })
    if (element.value) observer.observe(element.value)
  } else {
    inViewport.value = true
  }
})

onUnmounted(() => {
  observer?.disconnect()
  document.removeEventListener('visibilitychange', updatePageVisibility)
})

const gradientId = computed(() => `spark-fill-${symbolKey(props.row).replace(/\W/g, '-')}`)

const points = computed(() => {
  const values = prices.value
  if (values.length < 2) return ''
  const low = Math.min(...values)
  const range = Math.max(...values) - low
  return values.map((price, index) => {
    const x = 1 + index * 48 / (values.length - 1)
    const y = range === 0 ? 10 : 19 - (price - low) * 18 / range
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
})

const areaPoints = computed(() => {
  if (!points.value) return ''
  const coords = points.value.split(' ')
  return `${coords[0]} ${points.value} ${coords[coords.length - 1].split(',')[0]},20 1,20`
})

const trend = computed(() => {
  const values = prices.value
  const change = values[values.length - 1] - values[0]
  return change > 0 ? 'rising' : change < 0 ? 'falling' : ''
})
</script>

<template>
  <svg ref="element" class="sparkline" :class="trend" viewBox="0 0 50 20" aria-hidden="true">
    <defs>
      <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="currentColor" stop-opacity="0.28" />
        <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
      </linearGradient>
    </defs>
    <polygon v-if="areaPoints" :points="areaPoints" :fill="`url(#${gradientId})`" />
    <polyline v-if="points" :points="points" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>

<style scoped>
.sparkline {
  display: block;
  flex: 0 0 44px;
  width: 44px;
  height: 18px;
  color: #7a8798;
  transition: color .2s ease;
}
.rising { color: var(--up); }
.falling { color: var(--down); }
</style>
