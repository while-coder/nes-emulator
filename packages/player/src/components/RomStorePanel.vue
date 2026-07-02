<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { downloadRom, validateRomBytes, type DownloadProgress } from '../store/romDownloader'
import {
  emptyRomCatalog,
  listGenres,
  loadRomCatalog,
  romKey,
  searchRoms,
  type RomCatalog,
  type RomEntry,
} from '../store/romCatalog'
import {
  deleteCachedRom,
  getCachedRom,
  listCachedRoms,
  saveCachedRom,
  touchCachedRom,
  type CachedRom,
} from '../store/romLibrary'
import { navEnabled, useRemoteNav } from '../composables/useRemoteNav'
import RemoteSelect from './RemoteSelect.vue'

type StoreTab = 'downloaded' | 'online'

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{
  load: [{ name: string; bytes: Uint8Array; key: string }]
}>()

const catalog = ref<RomCatalog>(emptyRomCatalog())
const query = ref('')
const genre = ref('')
const activeTab = ref<StoreTab>('downloaded')
const cachedRoms = ref<CachedRom[]>([])
const busyKey = ref<string | null>(null)
const catalogLoading = ref(false)
const error = ref<string | null>(null)
const progressByKey = ref<Record<string, DownloadProgress>>({})

type SortMode = 'default' | 'name-asc' | 'name-desc' | 'size-asc' | 'size-desc' | 'publisher'

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'default', label: '默认排序' },
  { value: 'name-asc', label: '名称 A→Z' },
  { value: 'name-desc', label: '名称 Z→A' },
  { value: 'size-asc', label: '体积 小→大' },
  { value: 'size-desc', label: '体积 大→小' },
  { value: 'publisher', label: '按厂商' },
]

const PAGE_SIZE = 60
const page = ref(1)
const sort = ref<SortMode>('default')

function sortList<T>(
  list: T[],
  name: (item: T) => string,
  size: (item: T) => number,
  publisher: (item: T) => string,
): T[] {
  if (sort.value === 'default') return list
  const arr = list.slice()
  switch (sort.value) {
    case 'name-asc':
      return arr.sort((a, b) => name(a).localeCompare(name(b), 'zh-Hans-CN'))
    case 'name-desc':
      return arr.sort((a, b) => name(b).localeCompare(name(a), 'zh-Hans-CN'))
    case 'size-asc':
      return arr.sort((a, b) => size(a) - size(b))
    case 'size-desc':
      return arr.sort((a, b) => size(b) - size(a))
    case 'publisher':
      return arr.sort(
        (a, b) =>
          publisher(a).localeCompare(publisher(b), 'zh-Hans-CN') ||
          name(a).localeCompare(name(b), 'zh-Hans-CN'),
      )
    default:
      return arr
  }
}

const cachedKeys = computed(() => new Set(cachedRoms.value.map((rom) => rom.key)))
const genres = computed(() => listGenres(catalog.value.games))
const genreOptions = computed(() => [
  { value: '', label: '全部类型' },
  ...genres.value.map((item) => ({ value: item, label: item })),
])
const matchedGames = computed(() =>
  searchRoms(catalog.value.games, query.value, genre.value, false, cachedKeys.value),
)

const downloadedGames = computed(() => {
  const q = query.value.trim().toLocaleLowerCase('zh-Hans-CN')
  return cachedRoms.value.filter((rom) => {
    if (genre.value && rom.genre !== genre.value) return false
    if (!q) return true
    return [rom.name, rom.genre, rom.publisher, rom.mapper, ...(rom.tags ?? [])]
      .filter((value) => value !== undefined && value !== null)
      .join(' ')
      .toLocaleLowerCase('zh-Hans-CN')
      .includes(q)
  })
})

// 排序后的完整列表
const sortedMatched = computed(() =>
  sortList(
    matchedGames.value,
    (g) => g.name,
    (g) => g.file_size ?? 0,
    (g) => g.publisher ?? '',
  ),
)
const sortedDownloaded = computed(() =>
  sortList(
    downloadedGames.value,
    (r) => r.name,
    (r) => r.size ?? 0,
    (r) => r.publisher ?? '',
  ),
)

// 当前标签页的完整列表，分页基于它计算
const activeList = computed(() =>
  activeTab.value === 'downloaded' ? sortedDownloaded.value : sortedMatched.value,
)
const totalCount = computed(() => activeList.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / PAGE_SIZE)))
const pageStart = computed(() => (page.value - 1) * PAGE_SIZE)
const pageEnd = computed(() => Math.min(pageStart.value + PAGE_SIZE, totalCount.value))

const visibleGames = computed(() =>
  sortedMatched.value.slice(pageStart.value, pageStart.value + PAGE_SIZE),
)
const visibleDownloaded = computed(() =>
  sortedDownloaded.value.slice(pageStart.value, pageStart.value + PAGE_SIZE),
)

// 搜索、筛选、排序或切换标签时回到第一页
watch([query, genre, sort, activeTab], () => {
  page.value = 1
})

// 列表变短（例如删除后）时收敛当前页，避免停在空页
watch(totalPages, (pages) => {
  if (page.value > pages) page.value = pages
})

function goPage(target: number) {
  page.value = Math.min(Math.max(1, target), totalPages.value)
}

// Android TV 遥控器:面板内焦点几何导航(标签 / 搜索框 / 筛选 / 卡片按钮 / 翻页)。
// 与 SaveStatePanel 共用 useRemoteNav,priority=10 让面板打开时夺走按键;BACK 关面板。
// 不用 autoFocus:默认首焦点是右上角关闭键,几何寻路从那儿走不到左侧标签;
// 改为打开时手动把焦点落在当前标签按钮,DPad 左右即可切换标签。
const panelRef = ref<HTMLElement | null>(null)
const downloadedTabRef = ref<HTMLButtonElement | null>(null)
const onlineTabRef = ref<HTMLButtonElement | null>(null)
const { focusElement } = useRemoteNav({
  container: panelRef,
  active: computed(() => navEnabled.value && open.value),
  onBack: () => {
    if (busyKey.value === null) open.value = false
  },
  autoFocus: false,
  priority: 10,
})

// 返回键兜底:useRemoteNav 仅在 navEnabled(已按方向键/连手柄)时活跃;
// 某些 TV 遥控器 BACK 不触发 navMode,需要面板自己监听 Escape/Backspace/GoBack 以保证可关。
function onPanelBackKey(e: KeyboardEvent): void {
  if (!open.value || busyKey.value !== null) return
  const k = e.key
  if (k === 'Escape' || k === 'GoBack' || k === 'BrowserBack') {
    e.preventDefault()
    open.value = false
    return
  }
  if (k === 'Backspace') {
    // 文本框里退格交还原生编辑(搜索框删字符)
    const tag = (e.target as HTMLElement | null)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    e.preventDefault()
    open.value = false
  }
}

watch(
  open,
  async (value) => {
    if (!value) {
      window.removeEventListener('keydown', onPanelBackKey)
      return
    }
    window.addEventListener('keydown', onPanelBackKey)
    void prepareStore()
    // 等 v-if 渲染面板节点,再把焦点落到当前标签按钮上。
    await nextTick()
    requestAnimationFrame(() => {
      const tab = activeTab.value === 'downloaded' ? downloadedTabRef.value : onlineTabRef.value
      if (tab) focusElement(tab)
    })
  },
  { immediate: true },
)

onBeforeUnmount(() => window.removeEventListener('keydown', onPanelBackKey))

async function prepareStore() {
  await Promise.all([refreshCatalog(), refreshCached()])
}

async function refreshCatalog() {
  catalogLoading.value = true
  error.value = null
  try {
    catalog.value = await loadRomCatalog()
  } catch (err) {
    error.value = formatError(err)
  } finally {
    catalogLoading.value = false
  }
}

async function refreshCached() {
  try {
    cachedRoms.value = await listCachedRoms()
  } catch (err) {
    error.value = formatError(err)
  }
}

async function play(game: RomEntry) {
  if (busyKey.value !== null) return
  const key = romKey(game)
  busyKey.value = key
  error.value = null
  try {
    let bytes: Uint8Array | null = null
    const cached = await getCachedRom(key)
    if (cached) {
      try {
        await validateRomBytes(game, cached.bytes)
        bytes = cached.bytes
      } catch {
        await deleteCachedRom(key)
      }
    }
    if (!bytes) {
      bytes = await downloadRom(game, {
        onProgress: (progress) => setProgress(key, progress),
      })
      await saveCachedRom(game, bytes)
    }
    await touchCachedRom(key)
    await refreshCached()
    emit('load', { name: game.name, bytes, key })
    open.value = false
  } catch (err) {
    error.value = formatError(err)
  } finally {
    clearProgress(key)
    busyKey.value = null
  }
}

async function playCached(rom: CachedRom) {
  if (busyKey.value !== null) return
  busyKey.value = rom.key
  error.value = null
  try {
    const cached = await getCachedRom(rom.key)
    if (!cached) {
      await refreshCached()
      throw new Error('该 ROM 缓存已失效，请到在线库重新下载')
    }
    await touchCachedRom(rom.key)
    await refreshCached()
    emit('load', { name: cached.name, bytes: cached.bytes, key: rom.key })
    open.value = false
  } catch (err) {
    error.value = formatError(err)
  } finally {
    busyKey.value = null
  }
}

async function removeCachedByKey(key: string) {
  if (busyKey.value !== null) return
  busyKey.value = key
  error.value = null
  try {
    await deleteCachedRom(key)
    await refreshCached()
  } catch (err) {
    error.value = formatError(err)
  } finally {
    busyKey.value = null
  }
}

function setProgress(key: string, progress: DownloadProgress) {
  progressByKey.value = { ...progressByKey.value, [key]: progress }
}

function clearProgress(key: string) {
  const next = { ...progressByKey.value }
  delete next[key]
  progressByKey.value = next
}

function progressLabel(game: RomEntry): string {
  const progress = progressByKey.value[romKey(game)]
  if (!progress) return ''
  if (progress.ratio !== null) return `${Math.round(progress.ratio * 100)}%`
  return formatSize(progress.received)
}

function playLabel(game: RomEntry): string {
  const key = romKey(game)
  if (busyKey.value === key) return cachedKeys.value.has(key) ? '载入中' : '下载中'
  return cachedKeys.value.has(key) ? '启动' : '下载并启动'
}

function metaLine(game: RomEntry): string {
  const parts = [
    game.genre,
    game.publisher,
    game.mapper !== undefined ? `Mapper ${game.mapper}` : null,
    game.file_size ? formatSize(game.file_size) : null,
  ]
  return parts.filter(Boolean).join(' · ')
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function cachedMetaLine(rom: CachedRom): string {
  const parts = [
    rom.genre,
    rom.publisher,
    rom.mapper !== undefined ? `Mapper ${rom.mapper}` : null,
    rom.size ? formatSize(rom.size) : null,
  ]
  return parts.filter(Boolean).join(' · ')
}

function lastPlayedLabel(rom: CachedRom): string {
  if (!rom.lastPlayedAt) return '最后使用：未使用'
  return `最后使用：${formatTime(rom.lastPlayedAt)}`
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
    <section ref="panelRef" class="store-panel" role="dialog" aria-modal="true" aria-labelledby="rom-store-title">
      <header class="store-header">
        <div>
          <h2 id="rom-store-title">ROM 库</h2>
          <p>
            {{ catalogLoading ? '读取目录中' : `${catalog.games.length} 个游戏` }}
            · {{ catalog.captured_at ?? catalog.updated_at ?? 'Gitee 目录' }}
          </p>
        </div>
        <button class="close-btn" :disabled="busyKey !== null" aria-label="关闭" @click="open = false">×</button>
      </header>

      <div class="store-tabs" role="tablist">
        <button
          ref="downloadedTabRef"
          :class="['tab', activeTab === 'downloaded' ? 'active' : '']"
          role="tab"
          :aria-selected="activeTab === 'downloaded'"
          @click="activeTab = 'downloaded'"
        >
          已下载 ({{ cachedRoms.length }})
        </button>
        <button
          ref="onlineTabRef"
          :class="['tab', activeTab === 'online' ? 'active' : '']"
          role="tab"
          :aria-selected="activeTab === 'online'"
          @click="activeTab = 'online'"
        >
          在线库 ({{ catalog.games.length }})
        </button>
      </div>

      <div class="store-tools">
        <input v-model="query" class="search" type="search" placeholder="搜索游戏、厂商、标签" />
        <RemoteSelect v-model="genre" class="select" :options="genreOptions" />
        <RemoteSelect v-model="sort" class="select" :options="SORT_OPTIONS" />
      </div>

      <div class="store-summary">
        <span v-if="activeTab === 'downloaded'">
          已下载 {{ downloadedGames.length }} 个游戏{{ totalCount ? `，显示第 ${pageStart + 1}-${pageEnd} 个` : '' }}
        </span>
        <span v-else>{{ catalogLoading ? '正在同步目录' : `匹配 ${matchedGames.length} 个${totalCount ? `，显示第 ${pageStart + 1}-${pageEnd} 个` : ''}` }}</span>
        <span v-if="error" class="error">{{ error }}</span>
      </div>

      <div v-if="activeTab === 'downloaded'" class="game-list">
        <article
          v-for="rom in visibleDownloaded"
          :key="rom.key"
          class="game-card"
        >
          <div class="game-main">
            <div class="game-title-row">
              <h3>{{ rom.name }}</h3>
              <span class="cache-state cached">已下载</span>
            </div>
            <p class="meta">{{ cachedMetaLine(rom) }}</p>
            <p class="meta played">{{ lastPlayedLabel(rom) }}</p>
            <div v-if="rom.tags?.length" class="tags">
              <span v-for="tag in rom.tags.slice(0, 4)" :key="tag">{{ tag }}</span>
            </div>
          </div>

          <div class="game-actions">
            <button class="btn primary" :disabled="busyKey !== null" @click="playCached(rom)">
              {{ busyKey === rom.key ? '载入中' : '启动' }}
            </button>
            <button class="btn" :disabled="busyKey !== null" @click="removeCachedByKey(rom.key)">
              删除
            </button>
          </div>
        </article>

        <p v-if="downloadedGames.length === 0" class="empty">
          {{ cachedRoms.length === 0 ? '还没有下载任何 ROM，去在线库下载吧' : '没有匹配的 ROM' }}
        </p>
      </div>

      <div v-else class="game-list">
        <article
          v-for="game in visibleGames"
          :key="romKey(game)"
          class="game-card"
        >
          <div class="game-main">
            <div class="game-title-row">
              <h3>{{ game.name }}</h3>
              <span :class="['cache-state', cachedKeys.has(romKey(game)) ? 'cached' : '']">
                {{ cachedKeys.has(romKey(game)) ? '已下载' : '未下载' }}
              </span>
            </div>
            <p class="meta">{{ metaLine(game) }}</p>
            <div v-if="game.tags?.length" class="tags">
              <span v-for="tag in game.tags.slice(0, 4)" :key="tag">{{ tag }}</span>
            </div>
          </div>

          <div class="game-actions">
            <span v-if="busyKey === romKey(game) && progressLabel(game)" class="progress">
              {{ progressLabel(game) }}
            </span>
            <button class="btn primary" :disabled="busyKey !== null" @click="play(game)">
              {{ playLabel(game) }}
            </button>
            <button
              v-if="cachedKeys.has(romKey(game))"
              class="btn"
              :disabled="busyKey !== null"
              @click="removeCachedByKey(romKey(game))"
            >
              删除
            </button>
          </div>
        </article>

        <p v-if="visibleGames.length === 0" class="empty">没有匹配的 ROM</p>
      </div>

      <div v-if="totalPages > 1" class="store-pager">
        <button class="pager-btn" :disabled="page <= 1" @click="goPage(1)">« 首页</button>
        <button class="pager-btn" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <span class="page-info">{{ page }} / {{ totalPages }}</span>
        <button class="pager-btn" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
        <button class="pager-btn" :disabled="page >= totalPages" @click="goPage(totalPages)">末页 »</button>
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
  width: min(1040px, 100%);
  max-height: min(760px, 100%);
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
.store-tabs {
  display: flex;
  gap: 4px;
  padding: 10px 18px 0;
  border-bottom: 1px solid #30353d;
}
.tab {
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #9da5b3;
  padding: 8px 14px;
  font-size: 14px;
  cursor: pointer;
}
.tab:hover {
  color: #d6dbe2;
}
.tab.active {
  color: #ececec;
  border-bottom-color: #2f6f9f;
}
.store-tools {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(120px, 170px) minmax(120px, 170px);
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
.check {
  height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #c6ccd5;
  font-size: 13px;
  white-space: nowrap;
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
.game-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 18px 18px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 10px;
  align-content: start;
}
.game-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid #333942;
  border-radius: 8px;
  background: #252a31;
}
.game-main {
  min-width: 0;
  flex: 1;
}
.game-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.game-title-row h3 {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.cache-state {
  flex: 0 0 auto;
  padding: 2px 6px;
  border-radius: 5px;
  background: #3a3f48;
  color: #aeb6c2;
  font-size: 11px;
}
.cache-state.cached {
  background: #24473c;
  color: #89d8b2;
}
.meta {
  margin: 5px 0 0;
  color: #a2aab6;
  font-size: 12px;
  line-height: 1.35;
}
.meta.played {
  color: #8a93a0;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.tags span {
  border: 1px solid #48515d;
  border-radius: 5px;
  color: #c6ccd5;
  padding: 2px 6px;
  font-size: 11px;
}
.game-actions {
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
  grid-column: 1 / -1;
  margin: 40px 0;
  color: #9da5b3;
  text-align: center;
}
.store-pager {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 18px;
  background: #202328;
  border-top: 1px solid #30353d;
}
.pager-btn {
  height: 30px;
  min-width: 56px;
  padding: 0 12px;
  border: 1px solid #3a414c;
  border-radius: 6px;
  background: #2a2f37;
  color: #d6dbe2;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.pager-btn:hover:not(:disabled) {
  background: #343b45;
  border-color: #4a525e;
}
.pager-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.page-info {
  min-width: 72px;
  padding: 0 6px;
  color: #c6ccd5;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
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
  .game-list {
    grid-template-columns: 1fr;
  }
  .game-actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}

/* 手机横屏:总高 ~360-400px,默认 chrome 会吃掉 ~240px 让列表几乎不可见。
   全屏铺满 + 大幅压缩 header/tools/summary/pager,并把卡片维持在单行(横向 grid)
   再隐藏次要元信息(标签 / 最后使用),让列表区至少 5-6 行可见。 */
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
  .store-tabs {
    padding: 2px 12px 0;
  }
  .tab {
    padding: 4px 10px;
    font-size: 12px;
  }
  .store-tools {
    padding: 6px 12px;
    gap: 6px;
    grid-template-columns: minmax(120px, 1fr) minmax(80px, 130px) minmax(80px, 130px);
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
  .game-list {
    padding: 6px 12px 8px;
    grid-template-columns: 1fr;
    gap: 6px;
  }
  .game-card {
    flex-direction: row;
    align-items: center;
    padding: 6px 8px;
    gap: 8px;
  }
  .game-title-row h3 {
    font-size: 13px;
  }
  .meta {
    margin-top: 2px;
    font-size: 11px;
  }
  .meta.played,
  .tags {
    display: none;
  }
  .game-actions {
    justify-content: flex-end;
    flex-wrap: nowrap;
  }
  .btn {
    height: 28px;
    padding: 0 10px;
    font-size: 12px;
  }
  .store-pager {
    padding: 4px 12px;
    gap: 4px;
  }
  .pager-btn {
    height: 26px;
    min-width: 44px;
    padding: 0 8px;
    font-size: 12px;
  }
  .page-info {
    min-width: 56px;
    font-size: 12px;
  }
}
</style>
