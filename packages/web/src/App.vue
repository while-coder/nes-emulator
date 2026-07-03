<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import {
  NesScreen,
  RomStorePanel,
  SaveStatePanel,
  SettingsModal,
  ShortcutsPanel,
  ToolbarMenu,
  navEnabled,
  settings,
  sha256Hex,
  useAutoHideToolbar,
  useFullscreen,
  useInputMonitor,
  useRemoteNav,
  type SaveState,
} from '@nes-emulator/player'
import { isTauri, pickRomFile, storage } from './emulator/platform'

const screen = ref<InstanceType<typeof NesScreen> | null>(null)
// 全屏目标为整个应用根容器:工具栏+画面+footer 一起铺满,任何状态下都可操作、可退出。
const appRef = ref<HTMLElement | null>(null)
const { isFullscreen, usePseudo, toggle: toggleFullscreen } = useFullscreen(appRef)
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

// 模态(游戏库/设置/存档列表/快捷键)打开时锁住游戏输入,改由模态接管手柄/键盘导航。
const inputLocked = computed(
  () => storeOpen.value || settingsOpen.value || savesOpen.value || helpOpen.value,
)

// Web 预览也需要注册一个顶层遥控导航实例;npm run dev 启动的正是这个入口。
// 未载入游戏或游戏暂停时,方向键用于工具栏焦点导航;游戏运行中则交给 NesScreen。
const toolbarRef = ref<HTMLElement | null>(null)
const toolbarNavActive = computed(
  () => navEnabled.value && !inputLocked.value && (!romName.value || paused.value),
)
useRemoteNav({
  container: toolbarRef,
  active: toolbarNavActive,
  autoFocus: true,
  priority: 0,
})

// 游戏运行(已载入且未暂停)时自动隐藏顶部工具栏,鼠标移到顶部/触屏点顶部唤出。
const isPlaying = computed(() => !!romName.value && !paused.value)
const {
  visible: toolbarVisible,
  handlePointerMove: onToolbarPointerMove,
  toggle: toggleToolbar,
} = useAutoHideToolbar(isPlaying)

// 焦点环作用到全局,保证 Teleport 到 body 的下拉菜单也能显示遥控焦点。
if (typeof document !== 'undefined') {
  watchEffect(() => {
    document.documentElement.classList.toggle('tv-nav', navEnabled.value)
  })
}

// 快捷键修饰键:桌面(Tauri)用 Ctrl,浏览器用 Shift(避开 Ctrl+L/N 等浏览器冲突)。
const modKey: 'ctrl' | 'shift' = isTauri ? 'ctrl' : 'shift'
const modLabel = isTauri ? 'Ctrl' : 'Shift'

// 调试:当前按下的按键(键盘/手柄/遥控),仅在设置开启时显示于状态栏。
const { label: inputLabel } = useInputMonitor()

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

// 来自 NesScreen 的应用级快捷键(手柄空闲键 / 键盘 F1·F3):暂停-继续、打开游戏库。
function onSystemAction(action: string) {
  if (action === 'toggle-pause') {
    if (romName.value) togglePause()
  } else if (action === 'open-library') {
    storeOpen.value = true
  } else if (action === 'open-saves') {
    savesOpen.value = true
  } else if (action === 'toggle-fullscreen') {
    void toggleFullscreen()
  }
}
</script>

<template>
  <div
    ref="appRef"
    class="app"
    :class="{
      'tv-nav': navEnabled,
      'is-fullscreen': isFullscreen,
      'is-pseudo-fullscreen': isFullscreen && usePseudo,
    }"
    @mousemove="onToolbarPointerMove"
  >
    <!-- 触屏顶部热区:工具栏隐藏时点此唤出(桌面用鼠标 hover) -->
    <div v-if="isPlaying" class="toolbar-hotzone" @click="toggleToolbar" />
    <!-- 顶部唤出手柄:游戏时工具栏自动隐藏,点此(或桌面把鼠标移到顶部)滑出菜单栏。 -->
    <button
      v-if="isPlaying && !toolbarVisible"
      class="toolbar-handle"
      title="显示菜单栏"
      @click="toggleToolbar"
    >
      ☰
    </button>
    <header
      ref="toolbarRef"
      class="toolbar"
      :class="{ floating: isPlaying, hidden: isPlaying && !toolbarVisible }"
    >
      <h1 class="title">NES 模拟器</h1>
      <div class="spacer" />
      <!-- 主按钮:最高频操作,任何宽度下都直接可见。 -->
      <button class="btn" :disabled="loading" @click="openRom">
        {{ loading ? '载入中…' : '打开 ROM' }}
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
      <!-- 次要按钮:桌面平铺展开;触屏/窄屏隐藏,改由下方 ☰ 菜单收纳。 -->
      <div class="secondary">
        <button class="btn" @click="storeOpen = true">ROM 库 <kbd>{{ modLabel }}+G</kbd></button>
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
        <button class="btn icon" :disabled="!romName" @click="stopRom" title="中止">⏹</button>
        <button class="btn icon" :disabled="!romName" @click="reset" title="复位">↻</button>
        <button class="btn icon" :title="audioOn ? '音频开' : '音频关'" @click="toggleAudio">
          {{ audioOn ? '🔊' : '🔇' }}
        </button>
        <button class="btn icon" title="设置" @click="settingsOpen = true">⚙</button>
      </div>
      <!-- ☰ 更多:仅触屏/窄屏出现,把次要操作平铺进下拉,避免竖屏横向滚动。 -->
      <ToolbarMenu label="☰" class="more-menu">
        <button class="menu-item" @click="storeOpen = true">
          ROM 库 <kbd>{{ modLabel }}+G</kbd>
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
    </header>

    <SettingsModal v-model:open="settingsOpen" />
    <RomStorePanel
      v-model:open="storeOpen"
      @load="(payload) => loadRomBytes(payload.name, payload.bytes, payload.key)"
    />
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
      <p v-if="!romName" class="hint">点击「打开 ROM」选择一个 .nes 文件开始游戏</p>
    </main>

    <footer class="footer">
      <button class="link-btn" @click="helpOpen = true">查看所有快捷键</button>
      <span v-if="settings.misc.showInputDebug" class="input-debug">
        按键 <b>{{ inputLabel || '—' }}</b>
      </span>
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
  /* 移动端长按容易触发文字选中 / iOS 放大镜 / 系统 callout,影响游玩。
     全局禁用,真正需要输入的元素下方单独放开。 */
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
/* TV/遥控器焦点环:首次按方向键后启用,桌面鼠标移动会退出。 */
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
  position: relative; /* 悬浮工具栏 / 顶部热区的定位上下文 */
}
/* 伪全屏(iOS Safari 等无原生 Fullscreen API 时):固定铺满视口。
   原生全屏由浏览器负责铺满,只需处理伪全屏这一路。body 已 overflow:hidden。 */
.app.is-pseudo-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 2000;
}
/* 全屏时画面盒子去圆角,更贴边(原生:app 命中 :fullscreen,伪全屏命中 class,统一走 is-fullscreen)。 */
.app.is-fullscreen :deep(.frame) {
  border-radius: 0;
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
/* 游戏运行时工具栏脱离文档流、悬浮于画面之上,可上下滑动显隐(画面因此占满高度)。 */
.toolbar.floating {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 500;
  background: rgba(37, 37, 37, 0.94);
  transition: transform 0.25s ease;
}
.toolbar.floating.hidden {
  transform: translateY(-100%);
}
/* 顶部热区:仅游戏运行时存在,层级低于工具栏,工具栏隐藏后露出以接收触屏唤出点击。
   从安全区下方开始,避开屏幕最顶边缘的系统手势区(下拉通知/状态栏),否则点击会被系统拦截。 */
.toolbar-hotzone {
  position: absolute;
  top: max(0px, env(safe-area-inset-top));
  left: 0;
  right: 0;
  height: 52px;
  z-index: 400;
}
/* 顶部唤出手柄:游戏时工具栏隐藏才出现,点击滑出菜单栏(所有平台可见,便于发现)。 */
.toolbar-handle {
  position: absolute;
  /* 在安全区基础上再下移,离开屏幕最顶边缘:移动浏览器顶边是系统手势区,
     贴边会导致点击命中下拉状态栏而非按钮(表现为「点了没反应还拉出系统栏」)。 */
  top: calc(max(0px, env(safe-area-inset-top)) + 10px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 550; /* 高于悬浮工具栏(500),任何层都盖不住 */
  touch-action: manipulation; /* 消除双击缩放延迟,点击更跟手 */
  padding: 6px 26px 8px;
  border-top-left-radius: 14px;
  border-top-right-radius: 14px;
  font-size: 17px;
  line-height: 1.2;
  color: #fff;
  background: rgba(0, 0, 0, 0.62);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-bottom-left-radius: 14px;
  border-bottom-right-radius: 14px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
  cursor: pointer;
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
  background: #252525;
  border-top: 1px solid #333;
  color: #aaa;
  font-size: 12px;
}
.footer .meta {
  color: #666;
  margin-left: auto;
}
/* 调试:当前按下的按键 */
.footer .input-debug {
  color: #888;
  font-family: ui-monospace, 'Cascadia Code', monospace;
}
.footer .input-debug b {
  color: #6ab0ff;
  font-weight: 600;
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

/* 触屏设备:footer 的键盘按键提示对手机无用,直接隐藏让出垂直空间。 */
@media (pointer: coarse) {
  .footer {
    display: none;
  }
}

/* 手机横屏(短高度):压缩工具栏、去掉 stage padding,把画面顶到最大。
   NES 比例接近 4:3,横屏下限制因素是高度,省下的每一像素都直接转成画面宽度。 */
@media (orientation: landscape) and (max-height: 540px) {
  .toolbar {
    padding: 4px 8px;
    gap: 4px;
  }
  .title {
    display: none;
  }
  .btn {
    padding: 4px 10px;
    font-size: 13px;
  }
  .btn.icon {
    padding: 4px 7px;
    font-size: 14px;
  }
  /* 触屏上 kbd 快捷键提示无意义,且占宽。 */
  .btn kbd {
    display: none;
  }
  .stage {
    padding: 0;
  }
  .hint {
    bottom: 4px;
    font-size: 12px;
  }
}
</style>
