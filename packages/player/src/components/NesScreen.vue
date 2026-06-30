<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Button, NesRunner, type SaveState } from '../emulator/runner'
import TouchControls from './TouchControls.vue'
import {
  createSaveState,
  getSaveState,
  listSaveStates,
  putSaveState,
  QUICK_SLOT,
} from '../store/saveState'
import {
  buildCodeToButton,
  buildPadToButton,
  isPadSignalActive,
  isTurbo,
  PadButton,
  padmapFor,
  runnerButton,
  settings,
  TURBO_TARGET,
  type Aspect,
} from '../emulator/settings'
import { isTv } from '../emulator/platform'

// Android TV 遥控器游戏内映射(仅 TV 启用,不影响桌面键盘):
// 方向键→玩家1 十字键,确定键(Enter)→A;BACK 由 onKeyDown 单独处理为"暂停/打开菜单"。
// 遥控器物理键有限(无 B/Start/Select),完整游玩仍建议连蓝牙手柄。
const TV_REMOTE_MAP: Record<string, PadButton> = isTv
  ? {
      ArrowUp: PadButton.Up,
      ArrowDown: PadButton.Down,
      ArrowLeft: PadButton.Left,
      ArrowRight: PadButton.Right,
      Enter: PadButton.A,
      NumpadEnter: PadButton.A,
    }
  : {}

// inputLocked:模态(游戏库/设置)打开时为真,此时不把输入喂给游戏。
// romKey/romName:当前载入卡带的稳定标识与显示名,用于把存档绑定到对应游戏。
const props = defineProps<{
  inputLocked?: boolean
  /** 应用级快捷键修饰键:桌面(Tauri)传 'ctrl',浏览器传 'shift'(默认)。 */
  modifier?: 'ctrl' | 'shift'
  romKey?: string | null
  romName?: string | null
}>()
// systemAction:应用级快捷键(手柄空闲键 / 键盘),交父组件处理。
const emit = defineEmits<{ systemAction: [action: string] }>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const wrapRef = ref<HTMLDivElement | null>(null)
const frameRef = ref<HTMLDivElement | null>(null)
let runner: NesRunner | null = null

// 快速存档/读档:单槽,按 romKey 绑定。toast 显示一行短暂的操作反馈。
const toast = ref('')
let toastTimer = 0
function showToast(msg: string) {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast.value = ''
    toastTimer = 0
  }, 1600)
}

// 把存/读档异常压成一行可读文案,优先用 DOMException 的 name(如 QuotaExceededError、
// DataCloneError、InvalidStateError),便于在 toast 上直接看出失败类别。
function describeError(err: unknown): string {
  if (err instanceof DOMException) return err.name
  if (err instanceof Error) return err.message || err.name
  return String(err)
}

async function quickSave() {
  if (!runner?.loaded || !props.romKey) {
    showToast('请先载入游戏')
    return
  }
  const state = runner.saveState()
  if (!state) {
    showToast('存档失败')
    return
  }
  try {
    await putSaveState(props.romKey, QUICK_SLOT, props.romName ?? props.romKey, state)
    showToast('已存档')
  } catch (err) {
    console.error('[NES] 快速存档失败', err)
    showToast(`存档失败: ${describeError(err)}`)
  }
}

// 快速新建存档:不覆盖 quick,而是往存档列表追加一条(自动编号 label)。
async function quickNewSave() {
  if (!runner?.loaded || !props.romKey) {
    showToast('请先载入游戏')
    return
  }
  const state = runner.saveState()
  if (!state) {
    showToast('存档失败')
    return
  }
  try {
    const list = await listSaveStates(props.romKey)
    const count = list.filter((r) => r.slot !== QUICK_SLOT).length
    await createSaveState(props.romKey, props.romName ?? props.romKey, `存档 ${count + 1}`, state)
    showToast('已新建存档')
  } catch (err) {
    console.error('[NES] 新建存档失败', err)
    showToast(`存档失败: ${describeError(err)}`)
  }
}

async function quickLoad() {
  if (!runner?.loaded || !props.romKey) {
    showToast('请先载入游戏')
    return
  }
  let record
  try {
    record = await getSaveState(props.romKey, QUICK_SLOT)
  } catch (err) {
    console.error('[NES] 读档失败', err)
    showToast(`读档失败: ${describeError(err)}`)
    return
  }
  if (!record) {
    showToast('暂无存档')
    return
  }
  showToast(runner.loadState(record.state) ? '已读档' : '读档失败')
}

const NATIVE_W = 256
const NATIVE_H = 240

// 键盘 -> (玩家,逻辑按钮):合并两玩家 keymap,冲突时后者(玩家2)覆盖。
const codeToAction = computed(() => {
  const out: Record<string, { player: number; pad: number }> = {}
  settings.players.forEach((p, pi) => {
    const map = buildCodeToButton(p.keymap)
    for (const code in map) out[code] = { player: pi, pad: map[code] }
  })
  return out
})

// 焦点在输入框/可编辑元素时用户正在打字:放行按键给输入,不触发任何快捷键或游戏键。
function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  return (
    t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.tagName === 'SELECT' ||
    t.isContentEditable
  )
}

function onKeyDown(e: KeyboardEvent) {
  if (isTypingTarget(e)) return // 正在输入框打字,不抢按键
  if (props.inputLocked) return // 模态接管,游戏不收输入
  // Android TV 遥控器(仅 isTv):BACK→暂停/菜单,方向→玩家1 十字键,确定(Enter)→A。
  // 必须在 codeToAction 之前覆盖(否则方向键命中玩家2、Enter 命中玩家1 Start)。
  if (isTv) {
    if (e.code === 'Backspace' || e.key === 'GoBack' || e.key === 'BrowserBack') {
      e.preventDefault()
      if (!e.repeat) emit('systemAction', 'toggle-pause')
      return
    }
    const tvBtn = TV_REMOTE_MAP[e.code]
    if (tvBtn !== undefined) {
      e.preventDefault()
      pressPad(0, tvBtn)
      return
    }
  }
  // 应用级快捷键:修饰键由 modifier 决定(桌面 Ctrl / 浏览器 Shift,避开浏览器占用键)。
  // S=存档,L=读档,N=新建存档,A=存档列表,G=游戏库,P=暂停,F=全屏;Esc 也可暂停。
  const modActive = props.modifier === 'ctrl' ? e.ctrlKey : e.shiftKey
  if (modActive) {
    switch (e.code) {
      case 'KeyS':
        e.preventDefault()
        if (!e.repeat) void quickSave()
        return
      case 'KeyL':
        e.preventDefault()
        if (!e.repeat) void quickLoad()
        return
      case 'KeyN':
        e.preventDefault()
        if (!e.repeat) void quickNewSave()
        return
      case 'KeyA':
        e.preventDefault()
        if (!e.repeat) emit('systemAction', 'open-saves')
        return
      case 'KeyG':
        e.preventDefault()
        if (!e.repeat) emit('systemAction', 'open-library')
        return
      case 'KeyP':
        e.preventDefault()
        if (!e.repeat) emit('systemAction', 'toggle-pause')
        return
      case 'KeyF':
        e.preventDefault()
        if (!e.repeat) toggleFullscreen()
        return
    }
  }
  if (e.code === 'Escape') {
    e.preventDefault()
    if (!e.repeat) emit('systemAction', 'toggle-pause')
    return
  }
  const a = codeToAction.value[e.code]
  if (!a) return
  e.preventDefault()
  pressPad(a.player, a.pad)
}
function onKeyUp(e: KeyboardEvent) {
  if (isTypingTarget(e)) return
  if (props.inputLocked) return
  if (isTv) {
    const tvBtn = TV_REMOTE_MAP[e.code]
    if (tvBtn !== undefined) {
      e.preventDefault()
      releasePad(0, tvBtn)
      return
    }
  }
  const a = codeToAction.value[e.code]
  if (!a) return
  e.preventDefault()
  releasePad(a.player, a.pad)
}

// 统一输入入口:键盘/手柄/触屏都经此派发;连发键转交 turbo 逻辑,其余直达引擎。
function pressPad(player: number, pad: number) {
  if (isTurbo(pad)) {
    turboStart(player, pad)
  } else {
    const btn = runnerButton(player, pad)
    if (btn !== null) runner?.press(btn)
  }
}
function releasePad(player: number, pad: number) {
  if (isTurbo(pad)) {
    turboEnd(player, pad)
  } else {
    const btn = runnerButton(player, pad)
    if (btn !== null) runner?.release(btn)
  }
}

// ===== 连发(Turbo):引擎无此功能,前端定时反复 press/release 模拟 =====
// 以 `${player}:${pad}` 为键,双玩家各自独立连发。
const activeTurbo = new Set<string>()
const turboPressed = new Map<string, boolean>()
let turboTimer = 0

function turboKey(player: number, pad: number): string {
  return `${player}:${pad}`
}
// 连发键实际反复触发的引擎按钮:经 TURBO_TARGET 转成 A/B 再按玩家路由。
function turboTargetButton(player: number, pad: number): Button | null {
  const target = TURBO_TARGET[pad]
  if (target === undefined) return null
  return runnerButton(player, target)
}

function turboIntervalMs(): number {
  const hz = settings.misc.turboHz > 0 ? settings.misc.turboHz : 16
  // press 与 release 各占一拍,故频率 ×2。
  return Math.max(1, Math.round(1000 / (hz * 2)))
}
function turboTick() {
  activeTurbo.forEach((key) => {
    const [player, pad] = key.split(':').map(Number)
    const btn = turboTargetButton(player, pad)
    if (btn === null) return
    const next = !turboPressed.get(key)
    turboPressed.set(key, next)
    if (next) runner?.press(btn)
    else runner?.release(btn)
  })
}
function ensureTurboTimer() {
  if (turboTimer || activeTurbo.size === 0) return
  turboTimer = window.setInterval(turboTick, turboIntervalMs())
}
function turboStart(player: number, pad: number) {
  const key = turboKey(player, pad)
  if (activeTurbo.has(key)) return // 键盘自动重复时幂等
  activeTurbo.add(key)
  ensureTurboTimer()
}
function turboEnd(player: number, pad: number) {
  const key = turboKey(player, pad)
  if (!activeTurbo.has(key)) return
  activeTurbo.delete(key)
  turboPressed.set(key, false)
  const btn = turboTargetButton(player, pad)
  if (btn !== null) runner?.release(btn)
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

// ===== 实体手柄(Gamepad API,USB/蓝牙皆通过此接口)=====
// 浏览器不派发手柄事件,需每帧轮询 navigator.getGamepads() 读取状态。
// 每玩家只读其绑定的 gamepadIndex 对应手柄,并按该手柄型号(id)的映射派发;
// 与键盘一样按边沿(本帧 active 集合相对上一帧的增减)触发 press/release。
let padRaf = 0
const padActive: Set<number>[] = [new Set<number>(), new Set<number>()]

// 手柄空闲肩键(游戏未占用)做应用级快捷键:LB(b4)=暂停/继续,RB(b5)=打开游戏库。
// 跨所有手柄取或,独立边沿检测,避免长按重复触发。
const sysPadPrev = { lb: false, rb: false }
function detectSystemPadButtons(pads: (Gamepad | null)[]) {
  let lb = false
  let rb = false
  for (const pad of pads) {
    if (!pad) continue
    if (pad.buttons[4]?.pressed) lb = true
    if (pad.buttons[5]?.pressed) rb = true
  }
  if (lb && !sysPadPrev.lb) emit('systemAction', 'toggle-pause')
  if (rb && !sysPadPrev.rb) emit('systemAction', 'open-library')
  sysPadPrev.lb = lb
  sysPadPrev.rb = rb
}

// 锁定输入瞬间释放所有已按下的游戏按钮与连发,避免卡键。
function releaseAllGameInput() {
  activeTurbo.clear()
  turboPressed.clear()
  if (turboTimer) {
    clearInterval(turboTimer)
    turboTimer = 0
  }
  const buttons = [
    PadButton.Up,
    PadButton.Down,
    PadButton.Left,
    PadButton.Right,
    PadButton.A,
    PadButton.B,
    PadButton.Start,
    PadButton.Select,
  ]
  for (let player = 0; player < settings.players.length; player++) {
    for (const pad of buttons) {
      const btn = runnerButton(player, pad)
      if (btn !== null) runner?.release(btn)
    }
  }
  padActive.forEach((s) => s.clear())
}

function pollGamepads() {
  padRaf = requestAnimationFrame(pollGamepads)
  if (!runner) return
  if (props.inputLocked) return // 模态接管手柄(库内导航自行轮询)
  const pads = navigator.getGamepads ? navigator.getGamepads() : []
  detectSystemPadButtons(pads)
  settings.players.forEach((p, pi) => {
    const pad = p.gamepadIndex !== null ? pads[p.gamepadIndex] : null
    const now = new Set<number>()
    if (pad) {
      const map = buildPadToButton(padmapFor(pad.id))
      for (const sig in map) {
        if (isPadSignalActive(pad, sig)) now.add(map[sig])
      }
    }
    const prev = padActive[pi] ?? new Set<number>()
    now.forEach((pb) => {
      if (!prev.has(pb)) pressPad(pi, pb) // 新按下
    })
    prev.forEach((pb) => {
      if (!now.has(pb)) releasePad(pi, pb) // 已松开
    })
    padActive[pi] = now
  })
}

// 触屏虚拟手柄(TouchControls)回调:仅控制玩家1(单屏双人不现实)。
// 首次按下顺带解锁音频(iOS 要求音频在用户手势内启动)。
function onTouchPress(pad: number) {
  runner?.resumeAudio()
  pressPad(0, pad)
}
function onTouchRelease(pad: number) {
  releasePad(0, pad)
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
  padRaf = requestAnimationFrame(pollGamepads)
  ro = new ResizeObserver(() => applyDisplaySize())
  if (wrapRef.value) ro.observe(wrapRef.value)
  applyDisplaySize()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  if (padRaf) cancelAnimationFrame(padRaf)
  padRaf = 0
  if (turboTimer) clearInterval(turboTimer)
  turboTimer = 0
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = 0
  ro?.disconnect()
  ro = null
  runner?.dispose()
  runner = null
  unlockOrientation()
})

// 设置变化 -> 同步到 runner 与画面尺寸。
watch(() => settings.audio.volume, (v) => runner?.setVolume(v))
watch(() => settings.misc.speed, (v) => runner?.setSpeed(v))
// 进入模态(锁定输入)时释放所有游戏按键,避免卡键。
watch(
  () => props.inputLocked,
  (locked) => {
    if (locked) releaseAllGameInput()
  },
)
watch(
  () => [settings.display.aspect, settings.display.integerScale],
  () => applyDisplaySize(),
)

// 全屏:Android Chrome 工作良好;iOS PWA(standalone)的 Fullscreen API 不一定可用,
// 这种情况下 PWA 本身已无浏览器 UI,失败时静默忽略即可,避免抛未处理异常。
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else {
      await wrapRef.value?.requestFullscreen()
    }
  } catch (err) {
    console.warn('[NES] 全屏切换不可用', err)
  }
}

// 屏幕方向:载入 ROM 后尝试锁横屏(NES 横屏游玩体验更好),停止 / 卸载时解锁。
// 仅在 PWA standalone 或全屏下生效;桌面 / 普通浏览器标签会被拒,静默忽略。
// 类型断言:lock/unlock 是 Screen Orientation API,实际浏览器(Chrome/Android)支持,
// 但 TS lib.dom 在当前版本里尚未声明,故用结构化类型绕过。
type OrientationLockApi = {
  lock?: (orientation: string) => Promise<void>
  unlock?: () => void
}
async function lockLandscape() {
  try {
    await (screen.orientation as unknown as OrientationLockApi | undefined)?.lock?.('landscape')
  } catch (err) {
    // 桌面、iOS Safari、非 PWA 浏览器都可能拒绝,这是预期行为。
    console.debug('[NES] 横屏锁定不可用', err)
  }
}
function unlockOrientation() {
  try {
    ;(screen.orientation as unknown as OrientationLockApi | undefined)?.unlock?.()
  } catch {
    // ignore
  }
}

// 暴露给父组件
async function loadRom(bytes: Uint8Array) {
  runner?.resumeAudio()
  await runner?.loadRom(bytes)
  void lockLandscape()
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
  unlockOrientation()
}

// 供存档列表面板使用:抓取当前引擎状态 / 把某条存档状态应用到引擎。
function captureState() {
  return runner?.loaded ? (runner.saveState() ?? null) : null
}
function applyState(state: SaveState): boolean {
  if (!runner?.loaded) return false
  const ok = runner.loadState(state)
  showToast(ok ? '已读档' : '读档失败')
  return ok
}
defineExpose({
  loadRom,
  reset,
  setAudioEnabled,
  toggleFullscreen,
  pause,
  resume,
  stop,
  quickSave,
  quickLoad,
  quickNewSave,
  captureState,
  applyState,
})
</script>

<template>
  <div ref="wrapRef" class="screen-wrap" :style="{ background: settings.display.bgColor }">
    <div ref="frameRef" class="frame">
      <canvas ref="canvasRef" class="screen" :style="canvasStyle" />
      <div v-if="settings.display.scanlines" class="scanlines" />
      <transition name="toast-fade">
        <div v-if="toast" class="toast">{{ toast }}</div>
      </transition>
    </div>

    <!-- 触屏虚拟手柄(经典分离式,支持斜向与多点触控) -->
    <TouchControls @press="onTouchPress" @release="onTouchRelease" />
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
/* 存档/读档等操作的短暂屏幕提示 */
.toast {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 14px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-size: 13px;
  border-radius: 6px;
  pointer-events: none;
  white-space: nowrap;
}
.toast-fade-enter-active,
.toast-fade-leave-active {
  transition: opacity 0.25s ease;
}
.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
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
</style>
