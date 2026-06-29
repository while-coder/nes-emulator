<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  PAD_BUTTON_LIST,
  codeLabel,
  NesScreen,
  RomStorePanel,
  SettingsModal,
  settings,
} from '@nes-emulator/player'
import { isTauri, pickRomFile, storage } from './emulator/platform'

const screen = ref<InstanceType<typeof NesScreen> | null>(null)
const romName = ref<string | null>(storage.getLastRom())
const audioOn = ref(true)
const loading = ref(false)
const paused = ref(false)
const settingsOpen = ref(false)
const storeOpen = ref(false)

// 模态(游戏库/设置)打开时锁住游戏输入,改由模态接管手柄/键盘导航。
const inputLocked = computed(() => storeOpen.value || settingsOpen.value)

// 按键说明:展示玩家1的键盘映射,改键后自动同步。
const keyHint = computed(() => {
  const keymap = settings.players[0].keymap
  return PAD_BUTTON_LIST.filter((i) => keymap[i.btn])
    .map((i) => `${i.label}=${codeLabel(keymap[i.btn])}`)
    .join(' · ')
})

async function openRom() {
  const picked = await pickRomFile()
  if (!picked) return
  await loadRomBytes(picked.name, picked.bytes)
}

async function loadRomBytes(name: string, bytes: Uint8Array) {
  loading.value = true
  try {
    await screen.value?.loadRom(bytes)
    romName.value = name
    paused.value = false
    storage.setLastRom(name)
  } finally {
    loading.value = false
  }
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
  paused.value = false
}

function toggleFullscreen() {
  screen.value?.toggleFullscreen()
}

function toggleAudio() {
  audioOn.value = !audioOn.value
  screen.value?.setAudioEnabled(audioOn.value)
}

// 来自 NesScreen 的应用级快捷键(手柄空闲键 / 键盘):暂停-继续、打开游戏库。
function onSystemAction(action: string) {
  if (action === 'toggle-pause') {
    if (romName.value) togglePause()
  } else if (action === 'open-library') {
    storeOpen.value = true
  }
}
</script>

<template>
  <div class="app">
    <header class="toolbar">
      <h1 class="title">NES/FC 模拟器</h1>
      <div class="spacer" />
      <button class="btn" :disabled="loading" @click="openRom">
        {{ loading ? '载入中...' : '打开 ROM' }}
      </button>
      <button class="btn" @click="storeOpen = true">游戏库</button>
      <button class="btn" :disabled="!romName" @click="togglePause">
        {{ paused ? '继续' : '暂停' }}
      </button>
      <button class="btn" :disabled="!romName" @click="stopRom">中止</button>
      <button class="btn" :disabled="!romName" @click="reset">复位</button>
      <button class="btn" @click="toggleFullscreen">全屏</button>
      <button class="btn" @click="toggleAudio">{{ audioOn ? '音频开' : '音频关' }}</button>
      <button class="btn" @click="settingsOpen = true">设置</button>
    </header>

    <SettingsModal v-model:open="settingsOpen" />
    <RomStorePanel v-model:open="storeOpen" @load="(p) => loadRomBytes(p.name, p.bytes)" />

    <main class="stage">
      <NesScreen ref="screen" :input-locked="inputLocked" @system-action="onSystemAction" />
      <p v-if="!romName" class="hint">打开本地 .nes 文件开始游戏</p>
    </main>

    <footer class="footer">
      <span class="keys">键盘 {{ keyHint }}</span>
      <span class="meta">{{ romName ?? '未载入' }} · {{ isTauri ? 'Tauri App' : '浏览器预览' }}</span>
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
  background: #181818;
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
  background: #242424;
  border-bottom: 1px solid #343434;
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
  background: #3b3b3b;
  color: #eee;
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  white-space: nowrap;
  flex-shrink: 0;
}
.btn:hover:not(:disabled) {
  background: #4b4b4b;
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
  background: #242424;
  border-top: 1px solid #343434;
  color: #aaa;
  font-size: 12px;
}
.footer .keys {
  letter-spacing: 0.2px;
}
.footer .meta {
  color: #777;
}
</style>
