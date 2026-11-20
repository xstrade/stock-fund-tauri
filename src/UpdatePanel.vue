<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { desktopCommand } from './desktop'

defineProps({ visible: Boolean })

const desktop = isTauri()
type AvailableUpdate = { status: 'available'; version: string; notes: string | null }
type UpdateResult = AvailableUpdate | { status: 'current' | 'disabled' }
type UpdatePhase = UpdateResult['status'] | 'idle' | 'checking' | 'installing' | 'installed'

const phase = ref<UpdatePhase>('idle')
const update = ref<AvailableUpdate | null>(null)
const failure = ref('')
const restarting = ref(false)

async function check() {
  if (!desktop || ['checking', 'installing', 'installed'].includes(phase.value)) return
  phase.value = 'checking'
  failure.value = ''
  update.value = null
  try {
    const result = await desktopCommand<UpdateResult>('check_app_update')
    if (!result) throw new Error('未收到更新检查结果')
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
      <button type="button" class="update-action" :disabled="restarting" @click="restart">重新启动</button>
    </template>
    <template v-if="update">
      <p class="update-title">发现新版本 {{ update.version }}</p>
      <p v-if="visible && update.notes" class="update-notes">{{ update.notes }}</p>
      <button type="button" class="update-action" :disabled="phase === 'installing'" @click="install">
        {{ phase === 'installing' ? '正在下载并验证签名…' : '下载并安装' }}
      </button>
    </template>
    <p v-if="failure" class="update-failure" role="alert">{{ failure }}</p>
    <button
      v-if="visible && ['idle', 'current', 'available'].includes(phase)"
      type="button"
      class="update-check"
      @click="check"
    >检查更新</button>
  </section>
</template>

<style scoped>
.update-panel {
  margin: 8px 10px 0;
  padding: 10px 12px;
  display: grid;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: rgba(255, 255, 255, 0.72);
  box-shadow: var(--shadow-sm);
  color: var(--accent-deep);
}
.update-title { font-weight: 650; color: var(--ink); }
.update-action {
  justify-self: start;
  color: #fff;
  font-weight: 650;
  background: linear-gradient(180deg, #256891, var(--accent));
  border-color: transparent;
  box-shadow: 0 6px 14px rgba(31, 95, 139, 0.18);
}
.update-action:enabled:hover {
  background: linear-gradient(180deg, #2a729d, var(--accent-deep));
  border-color: transparent;
}
.update-check {
  justify-self: start;
  color: var(--accent);
  font-weight: 600;
  background: var(--accent-soft);
  border-color: transparent;
}
.update-check:enabled:hover {
  background: rgba(31, 95, 139, 0.16);
  border-color: transparent;
}
.update-notes {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 7rem;
  overflow: auto;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(31, 95, 139, 0.05);
  color: var(--muted);
}
.update-failure { color: var(--up); }
</style>
