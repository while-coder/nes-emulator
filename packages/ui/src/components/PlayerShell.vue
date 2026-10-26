<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watchEffect } from 'vue'
import {
  isTauri,
  pickRomFile,
  setLastRomName,
} from '../emulator/platform'
import { sha256Hex } from '../store/romDownloader'
import { navEnabled, useRemoteNav } from '../composables/useRemoteNav'
import { useAutoHideToolbar } from '../composables/useAutoHideToolbar'
import { useFullscreen } from '../composables/useFullscreen'
import NesScreen from './NesScreen.vue'
import RomStorePanel from './RomStorePanel.vue'
import SaveStatePanel from './SaveStatePanel.vue'
import SettingsModal from './SettingsModal.vue'
import ShortcutsPanel from './ShortcutsPanel.vue'
import ToolbarMenu from './ToolbarMenu.vue'
import PlayerFooter from './PlayerFooter.vue'
import type { SaveState } from '../emulator/runner'

type ToolbarMode = 'app' | 'web'
type BackResult = 'exit' | 'handled'

const props = withDefaults(
  defineProps<{
    title?: string
    hint?: string
    platformLabel?: string
    libraryLabel?: string
    toolbarMode?: ToolbarMode
    storageKey?: string
    openLoadingLabel?: string
    footerHideOnTouch?: boolean
    enableBackExit?: boolean
    onExit?: () => void | Promise<void>
  }>(),
  {
    title: 'NES/FC 模拟器',
    hint: '打开本地 .nes 文件开始游戏',
    platformLabel: 'Web 模式',
    libraryLabel: '游戏库',
    toolbarMode: 'app',
    storageKey: 'nes:lastRom',
    openLoadingLabel: '载入中...',
    footerHideOnTouch: false,
    enableBackExit: false,
    onExit: undefined,
  },
)

const screen = ref<InstanceType<typeof NesScreen> | null>(null)
const appRef = ref<HTMLElement | null>(null)
const { isFullscreen, usePseudo, toggle: toggleFullscreen } = useFullscreen(appRef)
const romName = ref<string | null>(null)
const romKey = ref<string | null>(null)
const audioOn = ref(true)
const loading = ref(false)
const paused = ref(false)
const settingsOpen = ref(false)
const storeOpen = ref(false)
const savesOpen = ref(false)
const helpOpen = ref(false)
const exitHintVisible = ref(false)
let exitArmedAt = 0
let exitHintTimer: ReturnType<typeof setTimeout> | null = null

const inputLocked = computed(
  () => storeOpen.value || settingsOpen.value || savesOpen.value || helpOpen.value,
)

const toolbarRef = ref<HTMLElement | null>(null)
const toolbarNavActive = computed(
  () => navEnabled.value && !inputLocked.value && (!romName.value || paused.value),
)
useRemoteNav({
  container: toolbarRef,
  active: toolbarNavActive,
  autoFocus: true,
  priority: 0,
  onBack: props.enableBackExit ? consumeBack : undefined,
})

const isPlaying = computed(() => !!romName.value && !paused.value)
const { visible: toolbarVisible, toggle: toggleToolbar } = useAutoHideToolbar(isPlaying)

if (typeof document !== 'undefined') {
  watchEffect(() => {
    document.documentElement.classList.toggle('tv-nav', navEnabled.value)
  })
}

const modKey: 'ctrl' | 'shift' = isTauri ? 'ctrl' : 'shift'
const modLabel = isTauri ? 'Ctrl' : 'Shift'
const shellClasses = computed(() => ({
  'tv-nav': navEnabled.value,
  'is-fullscreen': isFullscreen.value,
  'is-pseudo-fullscreen': isFullscreen.value && usePseudo.value,
  'toolbar-app': props.toolbarMode === 'app',
  'toolbar-web': props.toolbarMode === 'web',
}))

async function openRom() {
  const picked = await pickRomFile()
  if (!picked) return
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
    setLastRomName(name, props.storageKey)
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

function newSave() {
  screen.value?.quickNewSave()
}

async function onLoadSave(payload: {
  romKey: string
  name: string
  state: SaveState
  bytes?: Uint8Array
}) {
  if (payload.bytes) {
    await loadRomBytes(payload.name, payload.bytes, payload.romKey)
  }
  await screen.value?.applyState(payload.state)
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

function toggleAudio() {
  audioOn.value = !audioOn.value
  screen.value?.setAudioEnabled(audioOn.value)
}

function onSystemAction(action: string) {
  if (action === 'toggle-pause') {
    if (romName.value) togglePause()
  } else if (action === 'open-library') {
    storeOpen.value = true
  } else if (action === 'open-saves') {
    savesOpen.value = true
  } else if (action === 'back') {
    if (props.enableBackExit) consumeBack()
  } else if (action === 'toggle-fullscreen') {
    void toggleFullscreen()
  }
}

const EXIT_CONFIRM_MS = 2000
function handleBack(): BackResult {
  if (helpOpen.value) {
    helpOpen.value = false
    return 'handled'
  }
  if (settingsOpen.value) {
    settingsOpen.value = false
    return 'handled'
  }
  if (savesOpen.value) {
    savesOpen.value = false
    return 'handled'
  }
  if (storeOpen.value) {
    storeOpen.value = false
    return 'handled'
  }
  if (romName.value) {
    stopRom()
    return 'handled'
  }
  if (!props.enableBackExit) return 'handled'

  const now = Date.now()
  if (now - exitArmedAt < EXIT_CONFIRM_MS) {
    if (exitHintTimer) {
      clearTimeout(exitHintTimer)
      exitHintTimer = null
    }
    exitHintVisible.value = false
    return 'exit'
  }
  exitArmedAt = now
  exitHintVisible.value = true
  if (exitHintTimer) clearTimeout(exitHintTimer)
  exitHintTimer = setTimeout(() => {
    exitHintVisible.value = false
    exitHintTimer = null
  }, EXIT_CONFIRM_MS)
  return 'handled'
}

function consumeBack() {
  if (handleBack() === 'exit') void props.onExit?.()
}

defineExpose({
  handleBack,
  consumeBack,
})

onBeforeUnmount(() => {
  if (exitHintTimer) clearTimeout(exitHintTimer)
})
</script>

<template>
  <div
    ref="appRef"
    class="app"
    :class="shellClasses"
  >
    <div v-if="isPlaying" class="toolbar-hotzone" @pointerup="toggleToolbar" />
    <button
      v-if="isPlaying && !toolbarVisible"
      class="toolbar-handle"
      title="显示菜单栏"
      @pointerup="toggleToolbar"
    >
      ☰
    </button>
    <header
      ref="toolbarRef"
      class="toolbar"
      :class="{ floating: isPlaying, hidden: isPlaying && !toolbarVisible }"
    >
      <h1 class="title">{{ title }}</h1>
      <div class="spacer" />

      <template v-if="toolbarMode === 'web'">
        <button class="btn primary" :disabled="loading" @click="openRom">
          {{ loading ? openLoadingLabel : '打开 ROM' }}
        </button>
        <button
          class="btn icon"
          :disabled="!romName"
          :title="(paused ? '继续' : '暂停') + ' (' + modLabel + '+P)'"
          @click="togglePause"
        >
          {{ paused ? '▶' : '⏸' }}
        </button>
        <button
          class="btn icon"
          @click="toggleFullscreen"
          :title="`${isFullscreen ? '退出全屏' : '全屏'} (${modLabel}+F)`"
        >
          {{ isFullscreen ? '⛗' : '⛶' }}
        </button>
        <div class="secondary">
          <button class="btn" @click="storeOpen = true">
            {{ libraryLabel }} <kbd>{{ modLabel }}+G</kbd>
          </button>
          <ToolbarMenu label="存档">
            <button class="menu-item" :disabled="!romName" @click="saveState">
              快速存档 <kbd>{{ modLabel }}+S</kbd>
            </button>
            <button class="menu-item" :disabled="!romName" @click="loadState">
              快速读档 <kbd>{{ modLabel }}+L</kbd>
            </button>
            <button class="menu-item" :disabled="!romName" @click="newSave">
              新建存档 <kbd>{{ modLabel }}+N</kbd>
            </button>
            <button class="menu-item" @click="savesOpen = true">
              存档列表 <kbd>{{ modLabel }}+A</kbd>
            </button>
          </ToolbarMenu>
          <span class="divider" />
          <button class="btn icon" :disabled="!romName" @click="stopRom" title="中止">⏹</button>
          <button class="btn icon" :disabled="!romName" @click="reset" title="复位">↻</button>
          <span class="divider" />
          <button class="btn icon" :title="audioOn ? '音频开' : '音频关'" @click="toggleAudio">
            {{ audioOn ? '🔊' : '🔇' }}
          </button>
          <button class="btn icon" title="设置" @click="settingsOpen = true">⚙</button>
        </div>
        <ToolbarMenu label="☰" class="more-menu">
          <button class="menu-item" @click="storeOpen = true">
            {{ libraryLabel }} <kbd>{{ modLabel }}+G</kbd>
          </button>
          <button class="menu-item" :disabled="!romName" @click="saveState">
            快速存档 <kbd>{{ modLabel }}+S</kbd>
          </button>
          <button class="menu-item" :disabled="!romName" @click="loadState">
            快速读档 <kbd>{{ modLabel }}+L</kbd>
          </button>
          <button class="menu-item" :disabled="!romName" @click="newSave">
            新建存档 <kbd>{{ modLabel }}+N</kbd>
          </button>
          <button class="menu-item" @click="savesOpen = true">
            存档列表 <kbd>{{ modLabel }}+A</kbd>
          </button>
          <button class="menu-item" :disabled="!romName" @click="reset">复位</button>
          <button class="menu-item" :disabled="!romName" @click="stopRom">中止</button>
          <button class="menu-item" @click="toggleAudio">
            {{ audioOn ? '音频:开' : '音频:关' }}
          </button>
          <button class="menu-item" @click="settingsOpen = true">设置</button>
        </ToolbarMenu>
      </template>

      <template v-else>
        <button class="btn" :disabled="loading" @click="openRom">
          {{ loading ? openLoadingLabel : '打开 ROM' }}
        </button>
        <button class="btn" @click="storeOpen = true">
          {{ libraryLabel }} <kbd>{{ modLabel }}+G</kbd>
        </button>
        <ToolbarMenu label="存档">
          <button class="menu-item" :disabled="!romName" @click="saveState">
            快速存档 <kbd>{{ modLabel }}+S</kbd>
          </button>
          <button class="menu-item" :disabled="!romName" @click="loadState">
            快速读档 <kbd>{{ modLabel }}+L</kbd>
          </button>
          <button class="menu-item" :disabled="!romName" @click="newSave">
            新建存档 <kbd>{{ modLabel }}+N</kbd>
          </button>
          <button class="menu-item" @click="savesOpen = true">
            存档列表 <kbd>{{ modLabel }}+A</kbd>
          </button>
        </ToolbarMenu>
        <button
          class="btn icon"
          :disabled="!romName"
          :title="(paused ? '继续' : '暂停') + ' (' + modLabel + '+P)'"
          @click="togglePause"
        >
          {{ paused ? '▶' : '⏸' }}
        </button>
        <button class="btn icon" :disabled="!romName" @click="stopRom" title="中止">⏹</button>
        <button class="btn icon" :disabled="!romName" @click="reset" title="复位">↻</button>
        <button
          class="btn icon"
          @click="toggleFullscreen"
          :title="`${isFullscreen ? '退出全屏' : '全屏'} (${modLabel}+F)`"
        >
          {{ isFullscreen ? '⛗' : '⛶' }}
        </button>
        <button class="btn icon" :title="audioOn ? '音频开' : '音频关'" @click="toggleAudio">
          {{ audioOn ? '🔊' : '🔇' }}
        </button>
        <button class="btn icon" title="设置" @click="settingsOpen = true">⚙</button>
      </template>
    </header>

    <SettingsModal v-model:open="settingsOpen" />
    <RomStorePanel v-model:open="storeOpen" @load="(p) => loadRomBytes(p.name, p.bytes, p.key)" />
    <SaveStatePanel v-model:open="savesOpen" :current-rom-key="romKey" @load="onLoadSave" />
    <ShortcutsPanel v-model:open="helpOpen" :modifier="modKey" />

    <main class="stage">
      <NesScreen
        ref="screen"
        :input-locked="inputLocked || paused"
        :modifier="modKey"
        :rom-key="romKey"
        :rom-name="romName"
        @system-action="onSystemAction"
      />
      <p v-if="!romName" class="hint">{{ hint }}</p>
    </main>

    <Transition name="toast">
      <div v-if="exitHintVisible" class="exit-hint" role="status">再按一次返回键退出</div>
    </Transition>

    <PlayerFooter
      :rom-name="romName"
      :platform-label="platformLabel"
      :hide-on-touch="footerHideOnTouch"
      @help="helpOpen = true"
    />
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
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
}
input,
textarea,
[contenteditable='true'] {
  user-select: text;
  -webkit-user-select: text;
  -webkit-touch-callout: default;
}
.tv-nav :focus-visible,
.tv-nav button:focus,
.tv-nav a:focus,
.tv-nav input:focus,
.tv-nav select:focus,
.tv-nav textarea:focus,
.tv-nav [tabindex]:focus,
.tv-nav [data-nav]:focus {
  outline: 3px solid #4ea1ff;
  outline-offset: 2px;
  border-radius: 6px;
}
</style>

<style scoped>
.app {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}
.app.is-pseudo-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 2000;
}
.app.is-fullscreen :deep(.frame) {
  border-radius: 0;
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
.toolbar.floating {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 500;
  background: rgba(36, 36, 36, 0.94);
  transition: transform 0.25s ease;
}
.toolbar.floating.hidden {
  transform: translateY(-100%);
}
.toolbar-hotzone {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 52px;
  z-index: 400;
  cursor: pointer;
  touch-action: manipulation;
}
.toolbar-web .toolbar-hotzone {
  height: calc(52px + max(0px, env(safe-area-inset-top)));
}
.toolbar-handle {
  position: absolute;
  top: max(0px, env(safe-area-inset-top));
  left: 50%;
  transform: translateX(-50%);
  z-index: 550;
  padding: 4px 26px 7px;
  font-size: 17px;
  line-height: 1.2;
  color: #fff;
  background: rgba(0, 0, 0, 0.62);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-top: none;
  border-bottom-left-radius: 14px;
  border-bottom-right-radius: 14px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
  cursor: pointer;
}
.toolbar-web .toolbar-handle {
  top: calc(max(0px, env(safe-area-inset-top)) + 10px);
  touch-action: manipulation;
  padding: 6px 26px 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.16);
  border-top-left-radius: 14px;
  border-top-right-radius: 14px;
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
.btn.primary {
  background: #2f6bd8;
  font-weight: 600;
}
.btn.primary:hover:not(:disabled) {
  background: #3d7ce8;
}
.btn kbd {
  margin-left: 4px;
  padding: 1px 5px;
  border-radius: 4px;
  background: #2a2a2a;
  border: 1px solid #555;
  font-family: ui-monospace, 'Cascadia Code', monospace;
  font-size: 11px;
  color: #bbb;
}
.btn.icon {
  padding: 6px 9px;
  font-size: 15px;
  line-height: 1;
}
.secondary {
  display: flex;
  align-items: center;
  gap: 8px;
}
.divider {
  width: 1px;
  align-self: stretch;
  margin: 2px 2px;
  background: #3d3d3d;
  flex-shrink: 0;
}
.more-menu {
  display: none;
}
@media (max-width: 720px), (pointer: coarse) {
  .secondary {
    display: none;
  }
  .more-menu {
    display: block;
  }
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
.exit-hint {
  position: fixed;
  left: 50%;
  bottom: 80px;
  transform: translateX(-50%);
  padding: 10px 20px;
  border-radius: 22px;
  background: rgba(0, 0, 0, 0.82);
  color: #fff;
  font-size: 14px;
  letter-spacing: 0.3px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  pointer-events: none;
  z-index: 1000;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
}
@media (orientation: landscape) and (max-height: 540px) {
  .toolbar-web .toolbar {
    padding: 4px 8px;
    gap: 4px;
  }
  .toolbar-web .title {
    display: none;
  }
  .toolbar-web .btn {
    padding: 4px 10px;
    font-size: 13px;
  }
  .toolbar-web .btn.icon {
    padding: 4px 7px;
    font-size: 14px;
  }
  .toolbar-web .btn kbd {
    display: none;
  }
  .toolbar-web .stage {
    padding: 0;
  }
  .toolbar-web .hint {
    bottom: 4px;
    font-size: 12px;
  }
}
</style>
