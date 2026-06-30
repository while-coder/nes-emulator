<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue'
import { exit } from '@tauri-apps/plugin-process'
import {
  PAD_BUTTON_LIST,
  codeLabel,
  NesScreen,
  RomStorePanel,
  SaveStatePanel,
  SettingsModal,
  ShortcutsPanel,
  ToolbarMenu,
  settings,
  sha256Hex,
  navEnabled,
  hasGamepad,
  useRemoteNav,
  type SaveState,
} from '@nes-emulator/player'
import { isTauri, pickRomFile, storage } from './emulator/platform'

const screen = ref<InstanceType<typeof NesScreen> | null>(null)
// 启动时不恢复上次 ROM 名:仅有名字而引擎未载入会让按钮误显示为可用,故初始为未载入。
const romName = ref<string | null>(null)
// 当前卡带的稳定标识(sha256),把存档绑定到对应游戏;读档时据此找回 ROM。
const romKey = ref<string | null>(null)
const audioOn = ref(true)
const loading = ref(false)
const paused = ref(false)
const settingsOpen = ref(false)
const storeOpen = ref(false)
const savesOpen = ref(false)
const helpOpen = ref(false)
// 主界面返回键二次确认:首次按只飘字提示,2s 内再按才真退出,避免遥控器误触退出。
const exitHintVisible = ref(false)
let exitArmedAt = 0
let exitHintTimer: ReturnType<typeof setTimeout> | null = null

// 模态(游戏库/设置/存档列表/快捷键)打开时锁住游戏输入,改由模态接管手柄/键盘导航。
const inputLocked = computed(
  () => storeOpen.value || settingsOpen.value || savesOpen.value || helpOpen.value,
)

// Android TV 遥控器:工具栏焦点导航。无模态、且(未载入或已暂停)时由工具栏接管方向键;
// 游戏运行中则交还 NesScreen(方向键控制角色)。开机未载入时自动聚焦,解决"无入口"问题。
const toolbarRef = ref<HTMLElement | null>(null)
const toolbarNavActive = computed(
  () => navEnabled.value && !inputLocked.value && (!romName.value || paused.value),
)
useRemoteNav({
  container: toolbarRef,
  active: toolbarNavActive,
  autoFocus: true,
  priority: 0,
  onBack: handleBack, // 主界面返回键 → 分级返回(此处即直接退出 app)
})
// 焦点环作用到全局(含 Teleport 到 body 的下拉菜单):TV 或已连手柄时给 <html> 标记 tv-nav。
if (typeof document !== 'undefined') {
  watchEffect(() => {
    document.documentElement.classList.toggle('tv-nav', navEnabled.value)
  })
}

// 快捷键修饰键:桌面(Tauri)用 Ctrl,浏览器用 Shift(避开 Ctrl+L/N 等浏览器冲突)。
const modKey: 'ctrl' | 'shift' = isTauri ? 'ctrl' : 'shift'
const modLabel = isTauri ? 'Ctrl' : 'Shift'

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
// 快速新建存档:往存档列表追加一条(区别于覆盖式的快速存档)。
function newSave() {
  screen.value?.quickNewSave()
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

// 来自 NesScreen 的应用级快捷键(手柄空闲键 / 键盘):暂停-继续、打开游戏库、返回键。
function onSystemAction(action: string) {
  if (action === 'toggle-pause') {
    if (romName.value) togglePause()
  } else if (action === 'open-library') {
    storeOpen.value = true
  } else if (action === 'open-saves') {
    savesOpen.value = true
  } else if (action === 'back') {
    handleBack()
  }
}

// 返回键分级返回:面板打开→关面板;游戏中→停止游戏回主界面;主界面→飘字+二次确认才退出。
// 汇聚遥控器/手柄 BACK(经各 useRemoteNav.onBack 与 NesScreen 的 'back')与物理返回键(popstate)。
const EXIT_CONFIRM_MS = 2000
function handleBack() {
  if (helpOpen.value) helpOpen.value = false
  else if (settingsOpen.value) settingsOpen.value = false
  else if (savesOpen.value) savesOpen.value = false
  else if (storeOpen.value) storeOpen.value = false
  else if (romName.value) stopRom()
  else {
    const now = Date.now()
    if (now - exitArmedAt < EXIT_CONFIRM_MS) {
      if (exitHintTimer) { clearTimeout(exitHintTimer); exitHintTimer = null }
      exitHintVisible.value = false
      void exitApp()
      return
    }
    exitArmedAt = now
    exitHintVisible.value = true
    if (exitHintTimer) clearTimeout(exitHintTimer)
    exitHintTimer = setTimeout(() => {
      exitHintVisible.value = false
      exitHintTimer = null
    }, EXIT_CONFIRM_MS)
  }
}

// 退出 app:Tauri 用 process 插件 exit(0);浏览器预览降级 window.close()(失败静默)。
async function exitApp() {
  if (isTauri) {
    try {
      await exit(0)
    } catch (err) {
      console.warn('[app] 退出失败', err)
    }
  } else {
    window.close()
  }
}

// 物理返回键(Android):Tauri 无官方拦截 API,用 history 占位 + popstate 捕获物理返回,
// 转交分级返回。仅 Tauri 环境启用,避免干扰浏览器预览的前进/后退。
// 注:目标设备的 WebView 若不把物理返回映射到 history.back,此路径可能失效(需原生兜底)。
function onPopState() {
  handleBack()
  // 维持占位,使下一次物理返回仍触发 popstate(若已 exit 则页面已销毁)。
  history.pushState(null, '', location.href)
}
onMounted(() => {
  if (isTauri && typeof window !== 'undefined') {
    history.pushState(null, '', location.href)
    window.addEventListener('popstate', onPopState)
  }
})
onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('popstate', onPopState)
  }
  if (exitHintTimer) clearTimeout(exitHintTimer)
})
</script>

<template>
  <div class="app" :class="{ 'tv-nav': navEnabled }">
    <header ref="toolbarRef" class="toolbar">
      <h1 class="title">NES/FC 模拟器</h1>
      <div class="spacer" />
      <button class="btn" :disabled="loading" @click="openRom">
        {{ loading ? '载入中...' : '打开 ROM' }}
      </button>
      <button class="btn" @click="storeOpen = true">游戏库 <kbd>{{ modLabel }}+G</kbd></button>
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
      <button class="btn icon" @click="toggleFullscreen" :title="`全屏 (${modLabel}+F)`">⛶</button>
      <button class="btn icon" :title="audioOn ? '音频开' : '音频关'" @click="toggleAudio">
        {{ audioOn ? '🔊' : '🔇' }}
      </button>
      <button class="btn icon" title="设置" @click="settingsOpen = true">⚙</button>
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
      <p v-if="!romName" class="hint">打开本地 .nes 文件开始游戏</p>
    </main>

    <Transition name="toast">
      <div v-if="exitHintVisible" class="exit-hint" role="status">再按一次返回键退出</div>
    </Transition>

    <footer class="footer">
      <span class="keys">键盘 {{ keyHint }}</span>
      <button class="link-btn" @click="helpOpen = true">查看所有快捷键</button>
      <span v-if="navEnabled && !hasGamepad" class="tv-tip">游戏操作需连接手柄;遥控器用于菜单导航,返回键退出</span>
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
/* Android TV 遥控器焦点环:仅 TV(<html>.tv-nav)启用,桌面键鼠不受影响。
   补 :focus 兜底,因部分 Android WebView 对 button 不触发 :focus-visible。 */
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
/* 图标按钮:次要操作(中止/复位/全屏/音频/设置),方形紧凑,名称见悬停 title。 */
.btn.icon {
  padding: 6px 9px;
  font-size: 15px;
  line-height: 1;
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
  margin-left: auto;
}
.footer .tv-tip {
  color: #6ab0ff;
}
.link-btn {
  border: none;
  background: transparent;
  color: #6ab0ff;
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}
.link-btn:hover {
  text-decoration: underline;
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
</style>
