<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { SaveState } from '../emulator/runner'
import type { DownloadProgress } from '../store/romDownloader'
import { acquireRomByKey } from '../store/romResolver'
import {
  deleteSaveStateByKey,
  listAllSaveStates,
  renameSaveState,
  saveKindOf,
  type SaveStateRecord,
} from '../store/saveState'
import { isTv } from '../emulator/platform'
import { useRemoteNav } from '../composables/useRemoteNav'

// 读档时交回父组件应用到引擎的载荷:带 bytes 表示需先载入对应游戏,
// 不带 bytes 表示当前已是该游戏、直接套用状态即可。
export type LoadSavePayload = {
  romKey: string
  name: string
  state: SaveState
  bytes?: Uint8Array
}

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{
  // 当前已载入游戏的 sha256 标识(未载入则为 null),用于「当前游戏」过滤与就地读档。
  currentRomKey?: string | null
}>()
const emit = defineEmits<{ load: [LoadSavePayload] }>()

const records = ref<SaveStateRecord[]>([])
const query = ref('')
// 过滤范围:'current' 当前游戏 / 'all' 全部 / 其余为某游戏的 sha256。
const filter = ref<'current' | 'all' | string>('all')
const busyKey = ref<string | null>(null)
const error = ref<string | null>(null)
const progress = ref<DownloadProgress | null>(null)

// inline 改名编辑态。
const editingKey = ref<string | null>(null)
const editingText = ref('')

// Android TV 遥控器:面板内焦点导航(搜索框/筛选/卡片读档·删除·重命名按钮/关闭)。
const panelRef = ref<HTMLElement | null>(null)
useRemoteNav({
  container: panelRef,
  active: computed(() => isTv && open.value),
  onBack: () => {
    if (busyKey.value === null) open.value = false
  },
  autoFocus: true,
  priority: 10,
})

watch(
  open,
  (value) => {
    if (!value) return
    filter.value = props.currentRomKey ? 'current' : 'all'
    query.value = ''
    error.value = null
    void refresh()
  },
  { immediate: true },
)

async function refresh() {
  try {
    records.value = await listAllSaveStates()
  } catch (err) {
    error.value = formatError(err)
  }
}

// 列表中出现过的游戏(去重),供过滤下拉展示。
const games = computed(() => {
  const map = new Map<string, string>()
  for (const r of records.value) if (!map.has(r.romKey)) map.set(r.romKey, r.name)
  return Array.from(map, ([key, name]) => ({ key, name }))
})

const filteredRecords = computed(() => {
  let list = records.value
  if (filter.value === 'current') {
    list = props.currentRomKey ? list.filter((r) => r.romKey === props.currentRomKey) : []
  } else if (filter.value !== 'all') {
    list = list.filter((r) => r.romKey === filter.value)
  }
  const q = query.value.trim().toLocaleLowerCase('zh-Hans-CN')
  if (q) {
    list = list.filter((r) =>
      [saveLabel(r), r.name].join(' ').toLocaleLowerCase('zh-Hans-CN').includes(q),
    )
  }
  return list
})

function saveLabel(record: SaveStateRecord): string {
  return record.label?.trim() || record.name
}

function isQuickSave(record: SaveStateRecord): boolean {
  return saveKindOf(record) === 'quick'
}

async function loadRecord(record: SaveStateRecord) {
  if (busyKey.value !== null) return
  error.value = null

  // 当前已是这个游戏:直接套用状态,无需重新载入 ROM。
  if (props.currentRomKey === record.romKey) {
    emit('load', { romKey: record.romKey, name: record.name, state: record.state })
    open.value = false
    return
  }

  // 否则据 sha256 找回 ROM(缓存优先,其次在线库下载)。
  busyKey.value = record.key
  progress.value = null
  try {
    const resolved = await acquireRomByKey(record.romKey, {
      onProgress: (p) => (progress.value = p),
    })
    if (!resolved) {
      error.value = null
      window.alert(`未在游戏库中找到《${record.name}》,无法读档。请先在 ROM 库中添加该游戏。`)
      return
    }
    emit('load', {
      romKey: record.romKey,
      name: resolved.name,
      state: record.state,
      bytes: resolved.bytes,
    })
    open.value = false
  } catch (err) {
    error.value = formatError(err)
  } finally {
    busyKey.value = null
    progress.value = null
  }
}

async function removeRecord(record: SaveStateRecord) {
  if (busyKey.value !== null) return
  busyKey.value = record.key
  error.value = null
  try {
    await deleteSaveStateByKey(record.key)
    await refresh()
  } catch (err) {
    error.value = formatError(err)
  } finally {
    busyKey.value = null
  }
}

function startEdit(record: SaveStateRecord) {
  editingKey.value = record.key
  editingText.value = saveLabel(record)
  void nextTick(() => {
    const el = document.querySelector<HTMLInputElement>('.rename-input')
    el?.focus()
    el?.select()
  })
}

async function commitEdit(record: SaveStateRecord) {
  if (editingKey.value !== record.key) return
  const next = editingText.value.trim()
  editingKey.value = null
  if (!next || next === saveLabel(record)) return
  try {
    await renameSaveState(record.key, next)
    await refresh()
  } catch (err) {
    error.value = formatError(err)
  }
}

function cancelEdit() {
  editingKey.value = null
}

function progressLabel(): string {
  const p = progress.value
  if (!p) return '读取中'
  if (p.ratio !== null) return `${Math.round(p.ratio * 100)}%`
  return '下载中'
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
</script>

<template>
  <div v-if="open" class="store-backdrop" @click.self="busyKey === null && (open = false)">
    <section ref="panelRef" class="store-panel" role="dialog" aria-modal="true" aria-labelledby="save-panel-title">
      <header class="store-header">
        <div>
          <h2 id="save-panel-title">存档列表</h2>
          <p>{{ records.length }} 条存档 · 共 {{ games.length }} 个游戏</p>
        </div>
        <button class="close-btn" :disabled="busyKey !== null" aria-label="关闭" @click="open = false">×</button>
      </header>

      <div class="store-tools">
        <input v-model="query" class="search" type="search" placeholder="搜索存档名、游戏名" />
        <select v-model="filter" class="select">
          <option v-if="currentRomKey" value="current">当前游戏</option>
          <option value="all">全部游戏</option>
          <option v-for="g in games" :key="g.key" :value="g.key">{{ g.name }}</option>
        </select>
      </div>

      <div class="store-summary">
        <span>显示 {{ filteredRecords.length }} 条</span>
        <span v-if="error" class="error">{{ error }}</span>
      </div>

      <div class="save-list">
        <article v-for="record in filteredRecords" :key="record.key" class="save-card">
          <div class="save-main">
            <div class="save-title-row">
              <span
                class="badge"
                :class="isQuickSave(record) ? 'badge-quick' : 'badge-normal'"
                :title="isQuickSave(record) ? '快速存档(S 键覆盖式单槽)' : '普通存档'"
              >
                {{ isQuickSave(record) ? '快速' : '普通' }}
              </span>
              <input
                v-if="editingKey === record.key"
                v-model="editingText"
                class="rename-input"
                type="text"
                @keydown.enter.prevent="commitEdit(record)"
                @keydown.esc.prevent="cancelEdit"
                @blur="commitEdit(record)"
              />
              <h3 v-else :title="saveLabel(record)" @click="startEdit(record)">
                {{ saveLabel(record) }}
              </h3>
              <button
                v-if="editingKey !== record.key"
                class="icon-btn"
                title="重命名"
                :disabled="busyKey !== null"
                @click="startEdit(record)"
              >
                ✎
              </button>
            </div>
            <p class="meta">{{ record.name }}</p>
            <p class="meta time">{{ formatTime(record.savedAt) }}</p>
          </div>

          <div class="save-actions">
            <span v-if="busyKey === record.key" class="progress">{{ progressLabel() }}</span>
            <button class="btn primary" :disabled="busyKey !== null" @click="loadRecord(record)">
              读档
            </button>
            <button class="btn" :disabled="busyKey !== null" @click="removeRecord(record)">
              删除
            </button>
          </div>
        </article>

        <p v-if="filteredRecords.length === 0" class="empty">
          {{ records.length === 0 ? '还没有任何存档' : '没有匹配的存档' }}
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.store-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: rgba(0, 0, 0, 0.58);
}
.store-panel {
  width: min(720px, 100%);
  max-height: min(720px, 100%);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #202328;
  color: #ececec;
  border: 1px solid #383d45;
  border-radius: 8px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.42);
}
.store-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
  border-bottom: 1px solid #343941;
}
.store-header h2 {
  margin: 0;
  font-size: 18px;
  line-height: 1.2;
}
.store-header p {
  margin: 5px 0 0;
  color: #9da5b3;
  font-size: 12px;
}
.close-btn {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border: none;
  border-radius: 6px;
  background: #333840;
  color: #eee;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}
.close-btn:hover {
  background: #454c56;
}
.close-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.store-tools {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(120px, 180px);
  gap: 10px;
  padding: 12px 18px;
  border-bottom: 1px solid #30353d;
}
.search,
.select {
  min-width: 0;
  height: 34px;
  border: 1px solid #434a54;
  border-radius: 6px;
  background: #171a1f;
  color: #eee;
  padding: 0 10px;
  font-size: 14px;
}
.store-summary {
  min-height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 18px;
  color: #9da5b3;
  font-size: 12px;
  border-bottom: 1px solid #30353d;
}
.error {
  color: #ffb0a6;
  text-align: right;
}
.save-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 18px 18px;
}
.save-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  padding: 12px;
  border: 1px solid #333942;
  border-radius: 8px;
  background: #252a31;
}
.save-card + .save-card {
  margin-top: 8px;
}
.save-main {
  min-width: 0;
}
.save-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.badge {
  flex: 0 0 auto;
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.4;
}
.badge-quick {
  background: rgba(214, 179, 106, 0.18);
  color: #e3c178;
  border: 1px solid rgba(214, 179, 106, 0.4);
}
.badge-normal {
  background: rgba(47, 111, 159, 0.18);
  color: #8fc4ec;
  border: 1px solid rgba(47, 111, 159, 0.4);
}
.save-title-row h3 {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  cursor: text;
}
.save-title-row h3:hover {
  color: #9fd0ef;
}
.rename-input {
  flex: 1;
  min-width: 0;
  height: 28px;
  border: 1px solid #2f6f9f;
  border-radius: 6px;
  background: #171a1f;
  color: #eee;
  padding: 0 8px;
  font-size: 14px;
}
.icon-btn {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: #9da5b3;
  font-size: 13px;
  cursor: pointer;
}
.icon-btn:hover:not(:disabled) {
  background: #3a3f48;
  color: #ececec;
}
.meta {
  margin: 5px 0 0;
  color: #a2aab6;
  font-size: 12px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta.time {
  color: #8a93a0;
}
.save-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.progress {
  min-width: 44px;
  color: #d6b36a;
  font-size: 12px;
  text-align: right;
}
.btn {
  height: 32px;
  border: none;
  border-radius: 6px;
  background: #3a3f48;
  color: #eee;
  padding: 0 12px;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}
.btn.primary {
  background: #2f6f9f;
}
.btn:hover:not(:disabled) {
  filter: brightness(1.12);
}
.btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.empty {
  margin: 40px 0;
  color: #9da5b3;
  text-align: center;
}

@media (max-width: 720px) {
  .store-backdrop {
    align-items: stretch;
    padding: 10px;
  }
  .store-tools {
    grid-template-columns: 1fr;
  }
  .store-summary {
    align-items: flex-start;
    flex-direction: column;
  }
  .error {
    text-align: left;
  }
  .save-card {
    grid-template-columns: 1fr;
  }
  .save-actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}

/* 手机横屏:压缩 chrome、卡片维持单行,把垂直空间让给列表。同 RomStorePanel。 */
@media (orientation: landscape) and (max-height: 540px) {
  .store-backdrop {
    padding: 0;
  }
  .store-panel {
    max-height: 100%;
    width: 100%;
    border-radius: 0;
    border-left: none;
    border-right: none;
  }
  .store-header {
    padding: 6px 12px;
  }
  .store-header h2 {
    font-size: 14px;
  }
  .store-header p {
    display: none;
  }
  .close-btn {
    width: 28px;
    height: 28px;
    font-size: 20px;
  }
  .store-tools {
    padding: 6px 12px;
    gap: 6px;
    grid-template-columns: minmax(120px, 1fr) minmax(100px, 160px);
  }
  .search,
  .select {
    height: 28px;
    font-size: 12px;
  }
  .store-summary {
    min-height: 0;
    padding: 3px 12px;
    flex-direction: row;
    align-items: center;
    font-size: 11px;
  }
  .save-list {
    padding: 6px 12px 8px;
  }
  .save-card {
    grid-template-columns: minmax(0, 1fr) auto;
    padding: 6px 8px;
    gap: 8px;
  }
  .save-card + .save-card {
    margin-top: 6px;
  }
  .save-title-row h3 {
    font-size: 13px;
  }
  .meta {
    margin-top: 2px;
    font-size: 11px;
  }
  /* 横屏空间紧,隐藏时间一行,保留游戏名 */
  .meta.time {
    display: none;
  }
  .save-actions {
    justify-content: flex-end;
    flex-wrap: nowrap;
  }
  .btn {
    height: 28px;
    padding: 0 10px;
    font-size: 12px;
  }
}
</style>
