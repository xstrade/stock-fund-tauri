<script setup>
import { onMounted, ref } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { desktopCommand } from './desktop.js'

defineProps({ visible: Boolean })

const desktop = isTauri()
const phase = ref('idle')
const update = ref(null)
const failure = ref('')
const restarting = ref(false)

async function check() {
  if (!desktop || ['checking', 'installing', 'installed'].includes(phase.value)) return
  phase.value = 'checking'
  failure.value = ''
  update.value = null
  try {
    const result = await desktopCommand('check_app_update')
    phase.value = result.status
    if (result.status === 'available') update.value = result
  } catch (error) {
    phase.value = 'idle'
    failure.value = String(error)
  }
}

async function install() {
  if (phase.value !== 'available' || !update.value) return
  phase.value = 'installing'
  failure.value = ''
  try {
    await desktopCommand('install_app_update', { version: update.value.version })
    phase.value = 'installed'
    update.value = null
  } catch (error) {
    phase.value = 'available'
    failure.value = String(error)
  }
}

async function restart() {
  if (phase.value !== 'installed' || restarting.value) return
  restarting.value = true
  failure.value = ''
  try {
    await desktopCommand('restart_after_update')
  } catch (error) {
    failure.value = String(error)
    restarting.value = false
  }
}

onMounted(check)
</script>

<template>
  <section v-if="desktop && (visible || update || phase === 'installed')" class="update-panel" aria-label="应用更新">
    <p v-if="phase === 'disabled'">当前安装包未配置更新源。</p>
    <p v-else-if="phase === 'checking'" role="status">正在检查更新…</p>
    <p v-else-if="phase === 'current'" role="status">当前已是最新版本。</p>
    <template v-else-if="phase === 'installed'">
      <p role="status">更新安装完成。</p>
      <button type="button" :disabled="restarting" @click="restart">重新启动</button>
    </template>
    <template v-if="update">
      <p>发现新版本 {{ update.version }}</p>
      <p v-if="visible && update.notes" class="update-notes">{{ update.notes }}</p>
      <button type="button" :disabled="phase === 'installing'" @click="install">
        {{ phase === 'installing' ? '正在下载并验证签名…' : '下载并安装' }}
      </button>
    </template>
    <p v-if="failure" role="alert">{{ failure }}</p>
    <button
      v-if="visible && ['idle', 'current', 'available'].includes(phase)"
      type="button"
      @click="check"
    >检查更新</button>
  </section>
</template>

<style scoped>
.update-panel { margin-block: 8px; }
.update-panel button { margin-inline-end: 6px; }
.update-notes { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 7rem; overflow: auto; }
</style>
