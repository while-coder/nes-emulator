<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  BUTTON_LIST,
  SPEED_OPTIONS,
  TURBO_HZ_OPTIONS,
  codeLabel,
  detectPadSignal,
  padLabel,
  resetKeymap,
  resetSettings,
  settings,
  type Aspect,
  type TouchPadMode,
} from '../emulator/settings'

const open = defineModel<boolean>('open', { default: false })

type Tab = 'keys' | 'display' | 'audio' | 'misc'
const tab = ref<Tab>('keys')

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
  // 若该 code 已绑到别的按钮,先解绑,避免冲突。
  for (const [b, code] of Object.entries(settings.keymap)) {
    if (code === e.code && Number(b) !== capturing.value) {
      settings.keymap[Number(b)] = ''
    }
  }
  settings.keymap[capturing.value] = e.code
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

function startCapturePad(btn: number) {
  capturing.value = null
  capturingPad.value = btn
  padBaseline = null
  if (!padRaf) padRaf = requestAnimationFrame(pollCapturePad)
}

function stopCapturePad() {
  capturingPad.value = null
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
  for (const pad of pads) {
    if (!pad) continue
    if (!padBaseline) padBaseline = pad // 以首个出现的手柄当帧状态为基线
    const sig = detectPadSignal(pad, padBaseline)
    if (sig) {
      // 若该标识已绑到别的按钮,先解绑,避免冲突。
      for (const [b, s] of Object.entries(settings.padmap)) {
        if (s === sig && Number(b) !== capturingPad.value) settings.padmap[Number(b)] = ''
      }
      settings.padmap[capturingPad.value] = sig
      stopCapturePad()
      return
    }
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

const volumePct = computed({
  get: () => Math.round(settings.audio.volume * 100),
  set: (v: number) => {
    settings.audio.volume = v / 100
  },
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onCaptureKey, true)
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
    <div class="panel" role="dialog" aria-label="设置">
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
          <p class="tip">
            点击键盘/手柄列,然后按下想绑定的键或手柄按钮(Esc 取消)。键盘与手柄可同时使用。
            连发 A/B 为按住自动连按。
          </p>
          <div class="key-head">
            <span class="key-name"></span>
            <span class="col-head">键盘</span>
            <span class="col-head">手柄</span>
          </div>
          <div v-for="item in BUTTON_LIST" :key="item.btn" class="key-row">
            <span class="key-name">{{ item.label }}</span>
            <button
              :class="['key-bind', { capturing: capturing === item.btn }]"
              @click="startCapture(item.btn)"
            >
              {{ capturing === item.btn ? '按下任意键…' : codeLabel(settings.keymap[item.btn]) }}
            </button>
            <button
              :class="['key-bind', { capturing: capturingPad === item.btn }]"
              @click="startCapturePad(item.btn)"
            >
              {{ capturingPad === item.btn ? '按下手柄键…' : padLabel(settings.padmap[item.btn]) }}
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
