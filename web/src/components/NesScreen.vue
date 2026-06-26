<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Button, NesRunner } from '../emulator/runner'
import {
  buildCodeToButton,
  isTurbo,
  settings,
  TURBO_A,
  TURBO_B,
  TURBO_TARGET,
  type Aspect,
} from '../emulator/settings'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const wrapRef = ref<HTMLDivElement | null>(null)
const frameRef = ref<HTMLDivElement | null>(null)
let runner: NesRunner | null = null

const NATIVE_W = 256
const NATIVE_H = 240

// 物理键盘映射(用 KeyboardEvent.code,避免输入法/布局影响),由设置派生。
const codeToButton = computed(() => buildCodeToButton(settings.keymap))

function onKeyDown(e: KeyboardEvent) {
  const id = codeToButton.value[e.code]
  if (id === undefined) return
  e.preventDefault()
  if (isTurbo(id)) turboStart(id)
  else runner?.press(id as Button)
}
function onKeyUp(e: KeyboardEvent) {
  const id = codeToButton.value[e.code]
  if (id === undefined) return
  e.preventDefault()
  if (isTurbo(id)) turboEnd(id)
  else runner?.release(id as Button)
}

// ===== 连发(Turbo):引擎无此功能,前端定时反复 press/release 模拟 =====
const activeTurbo = new Set<number>()
const turboPressed = new Map<number, boolean>()
let turboTimer = 0

function turboIntervalMs(): number {
  const hz = settings.misc.turboHz > 0 ? settings.misc.turboHz : 16
  // press 与 release 各占一拍,故频率 ×2。
  return Math.max(1, Math.round(1000 / (hz * 2)))
}
function turboTick() {
  activeTurbo.forEach((id) => {
    const target = TURBO_TARGET[id]
    const next = !turboPressed.get(id)
    turboPressed.set(id, next)
    if (next) runner?.press(target)
    else runner?.release(target)
  })
}
function ensureTurboTimer() {
  if (turboTimer || activeTurbo.size === 0) return
  turboTimer = window.setInterval(turboTick, turboIntervalMs())
}
function turboStart(id: number) {
  if (activeTurbo.has(id)) return // 键盘自动重复时幂等
  activeTurbo.add(id)
  ensureTurboTimer()
}
function turboEnd(id: number) {
  if (!activeTurbo.has(id)) return
  activeTurbo.delete(id)
  turboPressed.set(id, false)
  runner?.release(TURBO_TARGET[id])
  if (activeTurbo.size === 0 && turboTimer) {
    clearInterval(turboTimer)
    turboTimer = 0
  }
}
// 频率变更时重建定时器。
watch(
  () => settings.misc.turboHz,
  () => {
    if (turboTimer) {
      clearInterval(turboTimer)
      turboTimer = 0
      ensureTurboTimer()
    }
  },
)

// 触屏虚拟手柄方向键
const PAD = [
  { key: 'up', label: '▲', btn: Button.Joypad1Up, cls: 'dpad-up' },
  { key: 'down', label: '▼', btn: Button.Joypad1Down, cls: 'dpad-down' },
  { key: 'left', label: '◀', btn: Button.Joypad1Left, cls: 'dpad-left' },
  { key: 'right', label: '▶', btn: Button.Joypad1Right, cls: 'dpad-right' },
]

function holdStart(e: Event, btn: Button) {
  e.preventDefault()
  runner?.resumeAudio()
  runner?.press(btn)
}
function holdEnd(e: Event, btn: Button) {
  e.preventDefault()
  runner?.release(btn)
}
function turboHoldStart(e: Event, id: number) {
  e.preventDefault()
  runner?.resumeAudio()
  turboStart(id)
}
function turboHoldEnd(e: Event, id: number) {
  e.preventDefault()
  turboEnd(id)
}

// ===== 显示设置 =====
/** 画面显示宽高比(宽/高)。 */
const ASPECT_RATIO: Record<Aspect, number> = {
  '1:1': NATIVE_W / NATIVE_H,
  '8:7': 8 / 7,
  '4:3': 4 / 3,
}

const canvasStyle = computed(() => ({
  imageRendering: settings.display.smoothing ? ('auto' as const) : ('pixelated' as const),
}))
const touchPadClass = computed(() => settings.misc.touchPad)

/** 量测容器,按宽高比与整数倍缩放算出画面盒子尺寸并写入 frame。 */
function applyDisplaySize() {
  const wrap = wrapRef.value
  const frame = frameRef.value
  if (!wrap || !frame) return
  const cw = wrap.clientWidth
  const ch = wrap.clientHeight
  if (cw <= 0 || ch <= 0) return
  const ar = ASPECT_RATIO[settings.display.aspect]
  // 在容器内放下宽高比为 ar 的最大矩形。
  let w = cw
  let h = w / ar
  if (h > ch) {
    h = ch
    w = h * ar
  }
  if (settings.display.integerScale) {
    // 以原生 240 行为基准取整数倍,再按比例推算宽度。
    const scale = Math.max(1, Math.floor(h / NATIVE_H))
    h = NATIVE_H * scale
    w = h * ar
    // 若整数倍后超出容器,回退一档。
    if (w > cw || h > ch) {
      const s2 = Math.max(1, scale - 1)
      h = NATIVE_H * s2
      w = h * ar
    }
  }
  frame.style.width = `${Math.round(w)}px`
  frame.style.height = `${Math.round(h)}px`
}

let ro: ResizeObserver | null = null

onMounted(() => {
  runner = new NesRunner(canvasRef.value!)
  runner.setVolume(settings.audio.volume)
  runner.setSpeed(settings.misc.speed)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  ro = new ResizeObserver(() => applyDisplaySize())
  if (wrapRef.value) ro.observe(wrapRef.value)
  applyDisplaySize()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  if (turboTimer) clearInterval(turboTimer)
  turboTimer = 0
  ro?.disconnect()
  ro = null
  runner?.dispose()
  runner = null
})

// 设置变化 -> 同步到 runner 与画面尺寸。
watch(() => settings.audio.volume, (v) => runner?.setVolume(v))
watch(() => settings.misc.speed, (v) => runner?.setSpeed(v))
watch(
  () => [settings.display.aspect, settings.display.integerScale],
  () => applyDisplaySize(),
)

// 全屏
async function toggleFullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen()
  } else {
    await wrapRef.value?.requestFullscreen()
  }
}

// 暴露给父组件
async function loadRom(bytes: Uint8Array) {
  runner?.resumeAudio()
  await runner?.loadRom(bytes)
}
function reset() {
  runner?.reset()
}
function setAudioEnabled(on: boolean) {
  runner?.setAudioEnabled(on)
}
function pause() {
  runner?.pause()
}
function resume() {
  runner?.resumeAudio()
  runner?.resume()
}
function stop() {
  runner?.unload()
}
defineExpose({ loadRom, reset, setAudioEnabled, toggleFullscreen, pause, resume, stop })
</script>

<template>
  <div ref="wrapRef" class="screen-wrap" :style="{ background: settings.display.bgColor }">
    <div ref="frameRef" class="frame">
      <canvas ref="canvasRef" class="screen" :style="canvasStyle" />
      <div v-if="settings.display.scanlines" class="scanlines" />
    </div>

    <!-- 触屏手柄:小霸王布局(左方向键、中 SELECT/START、右田字四键) -->
    <div class="touch-pad" :class="touchPadClass">
      <div class="dpad">
        <button
          v-for="d in PAD"
          :key="d.key"
          :class="['pad-btn', d.cls]"
          @pointerdown="holdStart($event, d.btn)"
          @pointerup="holdEnd($event, d.btn)"
          @pointerleave="holdEnd($event, d.btn)"
          @contextmenu.prevent
        >
          {{ d.label }}
        </button>
      </div>

      <div class="se">
        <button
          class="pad-btn small"
          @pointerdown="holdStart($event, Button.Select)"
          @pointerup="holdEnd($event, Button.Select)"
          @pointerleave="holdEnd($event, Button.Select)"
          @contextmenu.prevent
        >
          SELECT
        </button>
        <button
          class="pad-btn small"
          @pointerdown="holdStart($event, Button.Start)"
          @pointerup="holdEnd($event, Button.Start)"
          @pointerleave="holdEnd($event, Button.Start)"
          @contextmenu.prevent
        >
          START
        </button>
      </div>

      <!-- 田字四键:上排连发(连B/连A),下排主键(B/A) -->
      <div class="actions">
        <button
          class="pad-btn turbo"
          @pointerdown="turboHoldStart($event, TURBO_B)"
          @pointerup="turboHoldEnd($event, TURBO_B)"
          @pointerleave="turboHoldEnd($event, TURBO_B)"
          @contextmenu.prevent
        >
          连B
        </button>
        <button
          class="pad-btn turbo"
          @pointerdown="turboHoldStart($event, TURBO_A)"
          @pointerup="turboHoldEnd($event, TURBO_A)"
          @pointerleave="turboHoldEnd($event, TURBO_A)"
          @contextmenu.prevent
        >
          连A
        </button>
        <button
          class="pad-btn ab b"
          @pointerdown="holdStart($event, Button.Joypad1B)"
          @pointerup="holdEnd($event, Button.Joypad1B)"
          @pointerleave="holdEnd($event, Button.Joypad1B)"
          @contextmenu.prevent
        >
          B
        </button>
        <button
          class="pad-btn ab a"
          @pointerdown="holdStart($event, Button.Joypad1A)"
          @pointerup="holdEnd($event, Button.Joypad1A)"
          @pointerleave="holdEnd($event, Button.Joypad1A)"
          @contextmenu.prevent
        >
          A
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.screen-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  width: 100%;
  height: 100%;
  min-height: 0;
}
/* 画面盒子尺寸由 JS 按宽高比/整数倍算出 */
.frame {
  position: relative;
  border-radius: 4px;
  overflow: hidden;
}
.screen {
  display: block;
  width: 100%;
  height: 100%;
  /* 画面拉伸填满盒子(盒子已是目标宽高比) */
  object-fit: fill;
  image-rendering: pixelated;
}
/* CRT 扫描线:横向半透明暗线叠加 */
.scanlines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0) 0,
    rgba(0, 0, 0, 0) 2px,
    rgba(0, 0, 0, 0.25) 2px,
    rgba(0, 0, 0, 0.25) 3px
  );
}

/* 全屏时铺满整个屏幕,画面居中最大化 */
.screen-wrap:fullscreen {
  gap: 0;
}
.screen-wrap:fullscreen .frame {
  border-radius: 0;
}
.screen-wrap:fullscreen .touch-pad {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 640px;
}

.touch-pad {
  display: none;
  width: 100%;
  max-width: 560px;
  align-items: center;
  justify-content: space-between;
  user-select: none;
  touch-action: none;
}
.touch-pad.always {
  display: flex;
}
.touch-pad.never {
  display: none !important;
}
.pad-btn {
  border: none;
  background: #3a3a3a;
  color: #eee;
  border-radius: 8px;
  font-size: 16px;
}
.pad-btn:active {
  background: #5a5a5a;
}
.dpad {
  position: relative;
  width: 150px;
  height: 150px;
  flex: 0 0 auto;
}
.dpad .pad-btn {
  position: absolute;
  width: 50px;
  height: 50px;
}
.dpad-up {
  top: 0;
  left: 50px;
}
.dpad-down {
  bottom: 0;
  left: 50px;
}
.dpad-left {
  left: 0;
  top: 50px;
}
.dpad-right {
  right: 0;
  top: 50px;
}

/* SELECT / START:居中并排的两枚长条键 */
.se {
  display: flex;
  gap: 12px;
  flex: 0 0 auto;
}
.se .small {
  width: 72px;
  height: 28px;
  font-size: 11px;
  border-radius: 14px;
}

/* 小霸王布局:右侧四键排成「田」字,上排连发(连B/连A),下排主键(B/A),
   左列 B 系、右列 A 系上下对齐。 */
.actions {
  display: grid;
  grid-template-columns: repeat(2, 64px);
  grid-auto-rows: 64px;
  gap: 10px 16px;
  align-items: center;
  justify-items: center;
  flex: 0 0 auto;
}
.ab {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: #c0392b;
}
.turbo {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #d98324;
  font-size: 13px;
}

/* auto 模式:触屏或窄屏时显示虚拟手柄 */
@media (pointer: coarse), (max-width: 640px) {
  .touch-pad.auto {
    display: flex;
  }
}
</style>
