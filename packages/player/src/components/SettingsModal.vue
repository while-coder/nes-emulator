<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  PAD_BUTTON_LIST,
  PLAYER_LABELS,
  SPEED_OPTIONS,
  TURBO_HZ_OPTIONS,
  codeLabel,
  detectPadSignal,
  listGamepads,
  padLabel,
  padmapFor,
  resetKeymap,
  resetSettings,
  setPadBinding,
  settings,
  type Aspect,
  type TouchPadMode,
} from '../emulator/settings'
import { navEnabled, useRemoteNav } from '../composables/useRemoteNav'

const open = defineModel<boolean>('open', { default: false })

type Tab = 'keys' | 'display' | 'audio' | 'misc'
const tab = ref<Tab>('keys')

// 当前正在编辑的玩家(0=玩家1、1=玩家2)。
const player = ref(0)
const currentPlayer = computed(() => settings.players[player.value])

// 已连接手柄列表(随插拔刷新),供玩家选择绑定。
const gamepads = ref<{ index: number; id: string }[]>([])
function refreshGamepads() {
  gamepads.value = listGamepads()
}

// 当前玩家所绑手柄的型号 id 与其映射档案(未绑则为 null,手柄列禁用)。
const currentPadId = computed(() => {
  const idx = currentPlayer.value.gamepadIndex
  if (idx === null) return null
  return gamepads.value.find((g) => g.index === idx)?.id ?? null
})
const currentPadmap = computed(() => (currentPadId.value ? padmapFor(currentPadId.value) : null))

/** 手柄下拉项的显示名:截断过长的设备字符串。 */
function gamepadName(g: { index: number; id: string }): string {
  const name = g.id.length > 28 ? `${g.id.slice(0, 28)}…` : g.id
  return `#${g.index} ${name}`
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'keys', label: '按键' },
  { key: 'display', label: '显示' },
  { key: 'audio', label: '音频' },
  { key: 'misc', label: '杂项' },
]

const ASPECTS: { value: Aspect; label: string }[] = [
  { value: '1:1', label: '方像素 1:1' },
  { value: '8:7', label: '8:7' },
  { value: '4:3', label: '4:3' },
]

const TOUCH_MODES: { value: TouchPadMode; label: string }[] = [
  { value: 'auto', label: '自动(触屏/窄屏)' },
  { value: 'always', label: '始终显示' },
  { value: 'never', label: '从不显示' },
]

// 按键捕获:记录正在等待按键的按钮(null 表示未捕获)。
const capturing = ref<number | null>(null)

function startCapture(btn: number) {
  stopCapturePad()
  capturing.value = btn
}

function onCaptureKey(e: KeyboardEvent) {
  if (capturing.value === null) return
  e.preventDefault()
  e.stopPropagation()
  if (e.code === 'Escape') {
    capturing.value = null
    return
  }
  // 若该 code 已绑到当前玩家的别的按钮,先解绑,避免冲突。
  const keymap = currentPlayer.value.keymap
  for (const [b, code] of Object.entries(keymap)) {
    if (code === e.code && Number(b) !== capturing.value) {
      keymap[Number(b)] = ''
    }
  }
  keymap[capturing.value] = e.code
  capturing.value = null
}

// 捕获态下在捕获阶段拦截全局按键(避免触发游戏输入)。
watch(capturing, (v) => {
  if (v !== null) {
    window.addEventListener('keydown', onCaptureKey, true)
  } else {
    window.removeEventListener('keydown', onCaptureKey, true)
  }
})

// ===== 手柄按键捕获:点击后轮询 Gamepad,捕获按下的第一个输入 =====
const capturingPad = ref<number | null>(null)
let padRaf = 0
// 录入起始时的手柄基线快照,只识别相对基线“新发生”的输入,避免把已按住的键/扳机偏置当成输入。
let padBaseline: Gamepad | null = null
// 录入目标:当前玩家所绑手柄的下标与型号 id(写入对应型号档案)。
let capturePadIndex: number | null = null
let capturePadId: string | null = null

function startCapturePad(btn: number) {
  if (currentPadId.value === null) return // 未绑手柄不可录入
  capturing.value = null
  capturingPad.value = btn
  capturePadIndex = currentPlayer.value.gamepadIndex
  capturePadId = currentPadId.value
  padBaseline = null
  if (!padRaf) padRaf = requestAnimationFrame(pollCapturePad)
}

function stopCapturePad() {
  capturingPad.value = null
  capturePadIndex = null
  capturePadId = null
  padBaseline = null
  if (padRaf) {
    cancelAnimationFrame(padRaf)
    padRaf = 0
  }
}

function pollCapturePad() {
  if (capturingPad.value === null) {
    padRaf = 0
    return
  }
  padRaf = requestAnimationFrame(pollCapturePad)
  const pads = navigator.getGamepads ? navigator.getGamepads() : []
  // 只读该玩家绑定的那一个手柄,避免另一个手柄的输入串入。
  const pad = capturePadIndex !== null ? pads[capturePadIndex] : null
  if (!pad) return
  if (!padBaseline) {
    padBaseline = pad // 首帧仅取基线,下一帧起才识别新输入
    return
  }
  const sig = detectPadSignal(pad, padBaseline)
  if (sig && capturePadId !== null) {
    setPadBinding(capturePadId, capturingPad.value, sig)
    stopCapturePad()
  }
}

function onOverlayKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (capturingPad.value !== null) {
    stopCapturePad() // 手柄录入中:Esc 取消录入,不关闭面板
  } else if (capturing.value === null) {
    close()
  }
}

function close() {
  capturing.value = null
  stopCapturePad()
  open.value = false
}

// Android TV 遥控器:设置面板内焦点导航(tab/玩家切换/改键/各控件/关闭)。
// 改键捕获态(capturing / capturingPad)时让位 —— 此时键盘/手柄全交给捕获逻辑。
const panelRef = ref<HTMLElement | null>(null)
useRemoteNav({
  container: panelRef,
  active: computed(
    () => navEnabled.value && open.value && capturing.value === null && capturingPad.value === null,
  ),
  onBack: close,
  autoFocus: true,
  priority: 10,
})

const volumePct = computed({
  get: () => Math.round(settings.audio.volume * 100),
  set: (v: number) => {
    settings.audio.volume = v / 100
  },
})

// 打开面板时刷新手柄列表(可能在打开前才插上)。
watch(open, (v) => {
  if (v) refreshGamepads()
})

onMounted(() => {
  refreshGamepads()
  window.addEventListener('gamepadconnected', refreshGamepads)
  window.addEventListener('gamepaddisconnected', refreshGamepads)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onCaptureKey, true)
  window.removeEventListener('gamepadconnected', refreshGamepads)
  window.removeEventListener('gamepaddisconnected', refreshGamepads)
  stopCapturePad()
})
</script>

<template>
  <div
    v-if="open"
    class="overlay"
    tabindex="-1"
    @click.self="close"
    @keydown="onOverlayKey"
  >
    <div ref="panelRef" class="panel" role="dialog" aria-label="设置">
      <header class="panel-head">
        <h2>设置</h2>
        <button class="x" @click="close">✕</button>
      </header>

      <nav class="tabs">
        <button
          v-for="t in TABS"
          :key="t.key"
          :class="['tab', { active: tab === t.key }]"
          @click="tab = t.key"
        >
          {{ t.label }}
        </button>
      </nav>

      <section class="body">
        <!-- 按键 -->
        <div v-if="tab === 'keys'" class="keys">
          <!-- 玩家切换 -->
          <div class="player-switch">
            <button
              v-for="(label, pi) in PLAYER_LABELS"
              :key="pi"
              :class="['player-btn', { active: player === pi }]"
              @click="player = pi"
            >
              {{ label }}
            </button>
          </div>

          <!-- 手柄分配:玩家选择使用哪个实体手柄;手柄映射按型号共享 -->
          <label class="pad-assign">
            <span>使用手柄</span>
            <select v-model="currentPlayer.gamepadIndex">
              <option :value="null">未绑定(仅键盘)</option>
              <option v-for="g in gamepads" :key="g.index" :value="g.index">
                {{ gamepadName(g) }}
              </option>
            </select>
          </label>

          <p class="tip">
            点击键盘/手柄列,然后按下想绑定的键或手柄按钮(Esc 取消)。键盘按玩家各一套;
            手柄映射按型号共享(同款手柄配一次即可),需先在上方选定手柄。连发 A/B 为按住自动连按。
          </p>
          <div class="key-head">
            <span class="key-name"></span>
            <span class="col-head">键盘</span>
            <span class="col-head">手柄</span>
          </div>
          <div v-for="item in PAD_BUTTON_LIST" :key="item.btn" class="key-row">
            <span class="key-name">{{ item.label }}</span>
            <button
              :class="['key-bind', { capturing: capturing === item.btn }]"
              @click="startCapture(item.btn)"
            >
              {{ capturing === item.btn ? '按下任意键…' : codeLabel(currentPlayer.keymap[item.btn]) }}
            </button>
            <button
              :class="['key-bind', { capturing: capturingPad === item.btn }]"
              :disabled="!currentPadId"
              @click="startCapturePad(item.btn)"
            >
              {{
                capturingPad === item.btn
                  ? '按下手柄键…'
                  : currentPadmap
                    ? padLabel(currentPadmap[item.btn])
                    : '未选手柄'
              }}
            </button>
          </div>
          <button class="reset" @click="resetKeymap">恢复默认按键</button>
        </div>

        <!-- 显示 -->
        <div v-else-if="tab === 'display'" class="form">
          <label class="row">
            <span>画面平滑</span>
            <input v-model="settings.display.smoothing" type="checkbox" />
          </label>
          <label class="row">
            <span>宽高比</span>
            <select v-model="settings.display.aspect">
              <option v-for="a in ASPECTS" :key="a.value" :value="a.value">{{ a.label }}</option>
            </select>
          </label>
          <label class="row">
            <span>整数倍缩放</span>
            <input v-model="settings.display.integerScale" type="checkbox" />
          </label>
          <label class="row">
            <span>扫描线(CRT)</span>
            <input v-model="settings.display.scanlines" type="checkbox" />
          </label>
          <label class="row">
            <span>背景色</span>
            <input v-model="settings.display.bgColor" type="color" />
          </label>
        </div>

        <!-- 音频 -->
        <div v-else-if="tab === 'audio'" class="form">
          <label class="row">
            <span>音量 {{ volumePct }}%</span>
            <input v-model.number="volumePct" type="range" min="0" max="100" />
          </label>
        </div>

        <!-- 杂项 -->
        <div v-else class="form">
          <label class="row">
            <span>触屏手柄</span>
            <select v-model="settings.misc.touchPad">
              <option v-for="m in TOUCH_MODES" :key="m.value" :value="m.value">{{ m.label }}</option>
            </select>
          </label>
          <label class="row">
            <span>运行速度</span>
            <select v-model.number="settings.misc.speed">
              <option v-for="s in SPEED_OPTIONS" :key="s" :value="s">{{ s }}×</option>
            </select>
          </label>
          <label class="row">
            <span>连发频率</span>
            <select v-model.number="settings.misc.turboHz">
              <option v-for="h in TURBO_HZ_OPTIONS" :key="h" :value="h">{{ h }} 次/秒</option>
            </select>
          </label>
          <button class="reset" @click="resetSettings">恢复全部默认设置</button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.panel {
  width: 420px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  background: #2a2a2a;
  border: 1px solid #3a3a3a;
  border-radius: 10px;
  overflow: hidden;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #3a3a3a;
}
.panel-head h2 {
  margin: 0;
  font-size: 16px;
}
.x {
  border: none;
  background: transparent;
  color: #aaa;
  font-size: 16px;
  cursor: pointer;
}
.x:hover {
  color: #fff;
}
.tabs {
  display: flex;
  gap: 4px;
  padding: 8px 12px 0;
}
.tab {
  border: none;
  background: transparent;
  color: #aaa;
  padding: 6px 12px;
  border-radius: 6px 6px 0 0;
  cursor: pointer;
  font-size: 14px;
}
.tab.active {
  background: #3a3a3a;
  color: #fff;
}
.body {
  padding: 16px;
  overflow-y: auto;
}
.player-switch {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.player-btn {
  flex: 1;
  border: 1px solid #4a4a4a;
  background: #333;
  color: #ccc;
  padding: 6px 0;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.player-btn.active {
  background: #2f6f9f;
  border-color: #2f6f9f;
  color: #fff;
}
.pad-assign {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 0;
}
.pad-assign select {
  min-width: 200px;
  max-width: 240px;
}
.tip {
  margin: 0 0 12px;
  color: #888;
  font-size: 12px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
}
/* 按键页:名称 | 键盘 | 手柄 三列网格,表头与各行对齐。 */
.key-head,
.key-row {
  display: grid;
  grid-template-columns: 1fr 110px 110px;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
}
.col-head {
  color: #888;
  font-size: 12px;
  text-align: center;
}
.key-name {
  color: #ddd;
}
.key-bind {
  border: 1px solid #4a4a4a;
  background: #333;
  color: #eee;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  text-align: center;
}
.key-bind.capturing {
  border-color: #c0392b;
  color: #ffb3aa;
}
.row select,
.row input[type='range'] {
  min-width: 160px;
}
.row input[type='color'] {
  width: 48px;
  height: 28px;
  border: none;
  background: transparent;
  cursor: pointer;
}
.reset {
  margin-top: 12px;
  border: 1px solid #4a4a4a;
  background: #333;
  color: #eee;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.reset:hover {
  background: #444;
}
</style>
