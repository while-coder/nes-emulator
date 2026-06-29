<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  PAD_BUTTON_LIST,
  codeLabel,
  NesScreen,
  RomStorePanel,
  SaveStatePanel,
  SettingsModal,
  settings,
  sha256Hex,
  type SaveState,
} from '@nes-emulator/player'
import { isTauri, pickRomFile, storage } from './emulator/platform'

const screen = ref<InstanceType<typeof NesScreen> | null>(null)
const romName = ref<string | null>(storage.getLastRom())
// 当前卡带的稳定标识(sha256),把存档绑定到对应游戏;读档时据此找回 ROM。
const romKey = ref<string | null>(null)
const audioOn = ref(true)
const loading = ref(false)
const paused = ref(false)
const settingsOpen = ref(false)
const storeOpen = ref(false)
const savesOpen = ref(false)

// 按键说明:展示玩家1的键盘映射,跟随设置动态生成,改键后自动同步。
const keyHint = computed(() => {
  const keymap = settings.players[0].keymap
  return PAD_BUTTON_LIST.filter((i) => keymap[i.btn])
    .map((i) => `${i.label}=${codeLabel(keymap[i.btn])}`)
    .join(' · ')
})

async function openRom() {
  const picked = await pickRomFile()
  if (!picked) return
  // 用 sha256 作 key,使本地文件与 ROM 库下载的同一游戏共享存档,并支持读档找回。
  const key = await sha256Hex(picked.bytes)
  await loadRomBytes(picked.name, picked.bytes, key)
}

async function loadRomBytes(name: string, bytes: Uint8Array, key: string) {
  loading.value = true
  try {
    await screen.value?.loadRom(bytes)
    romName.value = name
    romKey.value = key
    paused.value = false
    storage.setLastRom(name)
  } finally {
    loading.value = false
  }
}

function saveState() {
  screen.value?.quickSave()
}
function loadState() {
  screen.value?.quickLoad()
}

// 从存档列表读档:带 bytes 表示需先载入对应游戏,然后把状态套用到引擎。
async function onLoadSave(payload: {
  romKey: string
  name: string
  state: SaveState
  bytes?: Uint8Array
}) {
  if (payload.bytes) {
    await loadRomBytes(payload.name, payload.bytes, payload.romKey)
  }
  screen.value?.applyState(payload.state)
}

function reset() {
  screen.value?.reset()
  paused.value = false
}

function togglePause() {
  if (paused.value) {
    screen.value?.resume()
  } else {
    screen.value?.pause()
  }
  paused.value = !paused.value
}

function stopRom() {
  screen.value?.stop()
  romName.value = null
  romKey.value = null
  paused.value = false
}

function toggleFullscreen() {
  screen.value?.toggleFullscreen()
}

function toggleAudio() {
  audioOn.value = !audioOn.value
  screen.value?.setAudioEnabled(audioOn.value)
}
</script>

<template>
  <div class="app">
    <header class="toolbar">
      <h1 class="title">NES 模拟器</h1>
      <div class="spacer" />
      <button class="btn" :disabled="loading" @click="openRom">
        {{ loading ? '载入中…' : '打开 ROM' }}
      </button>
      <button class="btn" @click="storeOpen = true">ROM 库</button>
      <button class="btn" :disabled="!romName" @click="togglePause">
        {{ paused ? '继续' : '暂停' }}
      </button>
      <button class="btn" :disabled="!romName" @click="stopRom">中止</button>
      <button class="btn" :disabled="!romName" @click="reset">复位</button>
      <button class="btn" :disabled="!romName" @click="saveState">存档</button>
      <button class="btn" :disabled="!romName" @click="loadState">读档</button>
      <button class="btn" @click="savesOpen = true">存档列表</button>
      <button class="btn" @click="toggleFullscreen">全屏</button>
      <button class="btn" @click="toggleAudio">{{ audioOn ? '🔊' : '🔇' }}</button>
      <button class="btn" @click="settingsOpen = true">⚙ 设置</button>
    </header>

    <SettingsModal v-model:open="settingsOpen" />
    <RomStorePanel
      v-model:open="storeOpen"
      @load="(payload) => loadRomBytes(payload.name, payload.bytes, payload.key)"
    />
    <SaveStatePanel v-model:open="savesOpen" :current-rom-key="romKey" @load="onLoadSave" />

    <main class="stage">
      <NesScreen ref="screen" :rom-key="romKey" :rom-name="romName" />
      <p v-if="!romName" class="hint">点击「打开 ROM」选择一个 .nes 文件开始游戏</p>
    </main>

    <footer class="footer">
      <span class="keys">键盘 {{ keyHint }}</span>
      <span class="meta">{{ romName ?? '未载入' }} · {{ isTauri ? 'Tauri 模式' : 'Web 模式' }}</span>
    </footer>
  </div>
</template>

<style>
:root {
  color-scheme: dark;
}
* {
  box-sizing: border-box;
}
html,
body,
#app {
  margin: 0;
  height: 100%;
}
body {
  background: #1a1a1a;
  color: #e8e8e8;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  overflow: hidden;
}
</style>

<style scoped>
.app {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: #252525;
  border-bottom: 1px solid #333;
  overflow-x: auto;
}
.title {
  font-size: 16px;
  margin: 0;
  font-weight: 600;
  white-space: nowrap;
}
.spacer {
  flex: 1;
}
.btn {
  border: none;
  background: #3a3a3a;
  color: #eee;
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  white-space: nowrap;
  flex-shrink: 0;
}
.btn:hover:not(:disabled) {
  background: #4a4a4a;
}
.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px;
  position: relative;
}
.hint {
  position: absolute;
  bottom: 12px;
  color: #888;
  font-size: 13px;
  text-align: center;
}
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 16px;
  background: #252525;
  border-top: 1px solid #333;
  color: #aaa;
  font-size: 12px;
}
.footer .keys {
  letter-spacing: 0.2px;
}
.footer .meta {
  color: #666;
}
</style>
