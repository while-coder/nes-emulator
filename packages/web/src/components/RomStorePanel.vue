<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
import { deleteCachedRom, getCachedRom, listCachedRomKeys, saveCachedRom } from '../store/romLibrary'

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{
  load: [{ name: string; bytes: Uint8Array }]
}>()

const catalog = ref<RomCatalog>(emptyRomCatalog())
const query = ref('')
const genre = ref('')
const downloadedOnly = ref(false)
const cachedKeys = ref<Set<string>>(new Set())
const busyKey = ref<string | null>(null)
const catalogLoading = ref(false)
const error = ref<string | null>(null)
const progressByKey = ref<Record<string, DownloadProgress>>({})

const DISPLAY_LIMIT = 120

const genres = computed(() => listGenres(catalog.value.games))
const matchedGames = computed(() =>
  searchRoms(catalog.value.games, query.value, genre.value, downloadedOnly.value, cachedKeys.value),
)
const visibleGames = computed(() => matchedGames.value.slice(0, DISPLAY_LIMIT))

watch(
  open,
  (value) => {
    if (value) void prepareStore()
  },
  { immediate: true },
)

async function prepareStore() {
  await Promise.all([refreshCatalog(), refreshCachedIds()])
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

async function refreshCachedIds() {
  try {
    cachedKeys.value = await listCachedRomKeys()
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
        markUncached(key)
      }
    }
    if (!bytes) {
      bytes = await downloadRom(game, {
        onProgress: (progress) => setProgress(key, progress),
      })
      await saveCachedRom(game, bytes)
      markCached(key)
    }
    emit('load', { name: game.name, bytes })
    open.value = false
  } catch (err) {
    error.value = formatError(err)
  } finally {
    clearProgress(key)
    busyKey.value = null
  }
}

async function removeCached(game: RomEntry) {
  if (busyKey.value !== null) return
  const key = romKey(game)
  busyKey.value = key
  error.value = null
  try {
    await deleteCachedRom(key)
    markUncached(key)
  } catch (err) {
    error.value = formatError(err)
  } finally {
    busyKey.value = null
  }
}

function markCached(key: string) {
  const next = new Set(cachedKeys.value)
  next.add(key)
  cachedKeys.value = next
}

function markUncached(key: string) {
  const next = new Set(cachedKeys.value)
  next.delete(key)
  cachedKeys.value = next
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

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
</script>

<template>
  <div v-if="open" class="store-backdrop" @click.self="busyKey === null && (open = false)">
    <section class="store-panel" role="dialog" aria-modal="true" aria-labelledby="rom-store-title">
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

      <div class="store-tools">
        <input v-model="query" class="search" type="search" placeholder="搜索游戏、厂商、标签" />
        <select v-model="genre" class="select">
          <option value="">全部类型</option>
          <option v-for="item in genres" :key="item" :value="item">{{ item }}</option>
        </select>
        <label class="check">
          <input v-model="downloadedOnly" type="checkbox" />
          已下载
        </label>
      </div>

      <div class="store-summary">
        <span>{{ catalogLoading ? '正在同步目录' : `匹配 ${matchedGames.length} 个，显示 ${visibleGames.length} 个` }}</span>
        <span v-if="error" class="error">{{ error }}</span>
      </div>

      <div class="game-list">
        <article v-for="game in visibleGames" :key="romKey(game)" class="game-card">
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
              @click="removeCached(game)"
            >
              删除
            </button>
          </div>
        </article>

        <p v-if="visibleGames.length === 0" class="empty">没有匹配的 ROM</p>
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
.store-tools {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(130px, 180px) auto;
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
}
.game-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  padding: 12px;
  border: 1px solid #333942;
  border-radius: 8px;
  background: #252a31;
}
.game-card + .game-card {
  margin-top: 8px;
}
.game-main {
  min-width: 0;
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
  .game-card {
    grid-template-columns: 1fr;
  }
  .game-actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}
</style>
