<script setup lang="ts">
/** 固定底座八方向摇杆，保留 NES 数字方向、斜向与多点触控。 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PadButton, settings } from '../emulator/settings'

const props = defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ press: [PadButton]; release: [PadButton] }>()

// 触点角度(0=右,逆时针)round 到最近 45° -> 该扇区激活的方向集合。
const SECTORS: PadButton[][] = [
  [PadButton.Right], // E
  [PadButton.Right, PadButton.Up], // NE
  [PadButton.Up], // N
  [PadButton.Up, PadButton.Left], // NW
  [PadButton.Left], // W
  [PadButton.Left, PadButton.Down], // SW
  [PadButton.Down], // S
  [PadButton.Down, PadButton.Right], // SE
]

const dpadRef = ref<HTMLElement | null>(null)
const activeDirs = ref<PadButton[]>([])
const stickOffset = ref({ x: 0, y: 0 })
const buttonPointers = new Map<number, { pad: PadButton; element: HTMLElement }>()
let dirPointerId: number | null = null

/** 由屏幕坐标算出方向区当前应激活的方向集(死区内为空)。 */
function dirsAt(clientX: number, clientY: number): PadButton[] {
  const el = dpadRef.value
  if (!el) return []
  const r = el.getBoundingClientRect()
  const dx = clientX - (r.left + r.width / 2)
  const dy = clientY - (r.top + r.height / 2)
  const distance = Math.hypot(dx, dy)
  const travel = r.width * 0.28
  const scale = distance > travel ? travel / distance : 1
  stickOffset.value = { x: dx * scale, y: dy * scale }
  if (distance < r.width * 0.14) return [] // 回到中心死区时立即松开方向
  let angle = (Math.atan2(-dy, dx) * 180) / Math.PI // 上为正
  if (angle < 0) angle += 360
  return SECTORS[Math.round(angle / 45) % 8]
}

/** 把方向集切到 next:对消失的方向 release、新增的 press。 */
function setDirs(next: PadButton[]) {
  const prev = activeDirs.value
  for (const p of prev) if (!next.includes(p)) emit('release', p)
  for (const n of next) if (!prev.includes(n)) emit('press', n)
  activeDirs.value = next
}

function releaseCapture(element: HTMLElement | null, pointerId: number) {
  if (element?.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
}

function finishDirection() {
  const pointerId = dirPointerId
  dirPointerId = null
  setDirs([])
  stickOffset.value = { x: 0, y: 0 }
  if (pointerId !== null) releaseCapture(dpadRef.value, pointerId)
}

function onDpadDown(e: PointerEvent) {
  if (props.disabled || settings.misc.touchPad === 'never' || dirPointerId !== null || e.button !== 0) return
  e.preventDefault()
  // 先捕获再记录状态；捕获失败时不留下按住标记。
  dpadRef.value?.setPointerCapture(e.pointerId)
  dirPointerId = e.pointerId
  setDirs(dirsAt(e.clientX, e.clientY))
}
function onDpadMove(e: PointerEvent) {
  if (e.pointerId !== dirPointerId) return
  if (props.disabled || e.buttons === 0) {
    finishDirection()
    return
  }
  e.preventDefault()
  setDirs(dirsAt(e.clientX, e.clientY))
}
function onDpadUp(e: PointerEvent) {
  if (e.pointerId === dirPointerId) finishDirection()
}

function onBtnDown(e: PointerEvent, pad: PadButton) {
  if (props.disabled || settings.misc.touchPad === 'never' || e.button !== 0 || buttonPointers.has(e.pointerId)) return
  const element = e.currentTarget as HTMLElement
  e.preventDefault()
  element.setPointerCapture(e.pointerId)
  const alreadyPressed = Array.from(buttonPointers.values()).some(value => value.pad === pad)
  buttonPointers.set(e.pointerId, { pad, element })
  if (!alreadyPressed) emit('press', pad)
}
function onBtnUp(e: PointerEvent) {
  const pointer = buttonPointers.get(e.pointerId)
  if (!pointer) return
  buttonPointers.delete(e.pointerId)
  if (!Array.from(buttonPointers.values()).some(value => value.pad === pointer.pad)) emit('release', pointer.pad)
  releaseCapture(pointer.element, e.pointerId)
}
function onPointerEnd(e: PointerEvent) {
  onDpadUp(e)
  onBtnUp(e)
}
function releaseAll() {
  finishDirection()
  const pointers = Array.from(buttonPointers.entries())
  buttonPointers.clear()
  for (const pad of new Set(pointers.map(([, value]) => value.pad))) emit('release', pad)
  for (const [pointerId, { element }] of pointers) releaseCapture(element, pointerId)
}
function onVisibilityChange() {
  if (document.hidden) releaseAll()
}
watch(() => [props.disabled, settings.misc.touchPad], releaseAll, { flush: 'sync' })
onMounted(() => {
  window.addEventListener('pointerup', onPointerEnd, true)
  window.addEventListener('pointercancel', onPointerEnd, true)
  window.addEventListener('blur', releaseAll)
  window.addEventListener('resize', releaseAll)
  document.addEventListener('visibilitychange', onVisibilityChange)
})
onBeforeUnmount(() => {
  releaseAll()
  window.removeEventListener('pointerup', onPointerEnd, true)
  window.removeEventListener('pointercancel', onPointerEnd, true)
  window.removeEventListener('blur', releaseAll)
  window.removeEventListener('resize', releaseAll)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <div class="touch-controls" :class="settings.misc.touchPad">
    <!-- 左：固定底座与可回中的摇杆 -->
    <div
      ref="dpadRef"
      class="dpad"
      :class="{ active: activeDirs.length > 0 }"
      :aria-disabled="disabled"
      role="group"
      aria-label="八方向摇杆"
      @pointerdown="onDpadDown"
      @pointermove="onDpadMove"
      @pointerup="onDpadUp"
      @pointercancel="onDpadUp"
      @lostpointercapture="onDpadUp"
      @contextmenu.prevent
    >
      <span class="stick-guide" aria-hidden="true" />
      <span class="stick-knob" aria-hidden="true" :style="{ transform: `translate(${stickOffset.x}px, ${stickOffset.y}px)` }" />
    </div>

    <!-- 中:SELECT / START -->
    <div class="fn">
      <button
        :disabled="disabled"
        class="fkey"
        @pointerdown="onBtnDown($event, PadButton.Select)"
        @pointerup="onBtnUp"
        @pointercancel="onBtnUp"
        @lostpointercapture="onBtnUp"
        @contextmenu.prevent
      >
        SELECT
      </button>
      <button
        :disabled="disabled"
        class="fkey"
        @pointerdown="onBtnDown($event, PadButton.Start)"
        @pointerup="onBtnUp"
        @pointercancel="onBtnUp"
        @lostpointercapture="onBtnUp"
        @contextmenu.prevent
      >
        START
      </button>
    </div>

    <!-- 右：A/B 平排，每列上方为对应的连发键 -->
    <div class="actions">
      <div class="col col-b">
        <button
          :disabled="disabled"
          class="akey turbo"
          @pointerdown="onBtnDown($event, PadButton.TurboB)"
          @pointerup="onBtnUp"
          @pointercancel="onBtnUp"
          @lostpointercapture="onBtnUp"
          @contextmenu.prevent
        >
          连B
        </button>
        <button
          :disabled="disabled"
          class="akey ab b"
          @pointerdown="onBtnDown($event, PadButton.B)"
          @pointerup="onBtnUp"
          @pointercancel="onBtnUp"
          @lostpointercapture="onBtnUp"
          @contextmenu.prevent
        >
          B
        </button>
      </div>
      <div class="col col-a">
        <button
          :disabled="disabled"
          class="akey turbo"
          @pointerdown="onBtnDown($event, PadButton.TurboA)"
          @pointerup="onBtnUp"
          @pointercancel="onBtnUp"
          @lostpointercapture="onBtnUp"
          @contextmenu.prevent
        >
          连A
        </button>
        <button
          :disabled="disabled"
          class="akey ab a"
          @pointerdown="onBtnDown($event, PadButton.A)"
          @pointerup="onBtnUp"
          @pointercancel="onBtnUp"
          @lostpointercapture="onBtnUp"
          @contextmenu.prevent
        >
          A
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.touch-controls {
  display: none;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
/* 根据主要输入设备区分移动端；桌面窄窗口也不显示虚拟手柄。 */
@media (pointer: coarse) {
  .touch-controls:not(.never) {
    display: block;
    position: absolute;
    inset: 0;
    z-index: 5;
    --pad-size: clamp(132px, 20vw, 168px);
    --action-size: clamp(52px, 8vw, 68px);
  }
  .dpad {
    position: absolute;
    left: 8px;
    top: 50%;
    transform: translateY(-50%);
  }
  .actions {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
  }
  .fn {
    position: absolute;
    bottom: 4px;
    left: 50%;
    transform: translateX(-50%);
  }
}
@media (pointer: coarse) and (orientation: portrait) {
  .touch-controls:not(.never) {
    position: relative;
    inset: auto;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: 44px max-content;
    align-content: center;
    gap: 16px clamp(16px, 5vw, 24px);
    width: 100%;
    padding: 12px clamp(16px, 5vw, 24px);
    height: 100%;
    min-height: 0;
    --pad-size: clamp(132px, 40vw, 180px);
    --action-size: clamp(56px, 17vw, 76px);
  }
  .dpad {
    position: relative;
    grid-column: 1;
    grid-row: 2;
    place-self: center start;
    left: auto;
    top: auto;
    bottom: auto;
    transform: none;
  }
  .actions {
    position: relative;
    grid-column: 2;
    grid-row: 2;
    place-self: center end;
    right: auto;
    top: auto;
    bottom: auto;
    transform: none;
  }
  .fn {
    position: static;
    grid-column: 1 / -1;
    grid-row: 1;
    transform: none;
    justify-content: space-around;
  }
}

/* 摇杆：底座不动，帽沿手指移动，松手立即回中。 */
.dpad {
  width: var(--pad-size);
  height: var(--pad-size);
  border-radius: 50%;
  border: 2px solid #555;
  background: radial-gradient(circle, #343434 0 48%, #252525 49% 100%);
  box-shadow: inset 0 2px 10px #0008;
  pointer-events: auto;
  touch-action: none;
}
.stick-guide {
  position: absolute;
  inset: 12%;
  border: 1px dashed #737373;
  border-radius: 50%;
  pointer-events: none;
}
.stick-knob {
  position: absolute;
  width: 44%;
  height: 44%;
  left: 28%;
  top: 28%;
  border: 1px solid #999;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #858585, #454545);
  box-shadow: 0 4px 10px #0009;
  pointer-events: none;
}
.dpad.active .stick-knob {
  border-color: #aad0ff;
  background: radial-gradient(circle at 35% 30%, #8aa6c9, #455b78);
}

/* ===== SELECT / START ===== */
.fn {
  display: flex;
  gap: clamp(10px, 3vw, 16px);
  pointer-events: none;
}
.fkey {
  pointer-events: auto;
  touch-action: none;
  border: none;
  width: 80px;
  height: 44px;
  border-radius: 15px;
  background: rgba(58, 58, 58, 0.85);
  color: #eee;
  font-size: 12px;
}
.fkey:active {
  background: rgba(90, 90, 90, 0.95);
}

/* ===== A / B：等尺寸两行两列 ===== */
.actions {
  display: flex;
  align-items: flex-end;
  gap: clamp(8px, 2.5vw, 16px);
  flex: 0 0 auto;
  pointer-events: none;
}
.col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(8px, 2.2vw, 12px);
  pointer-events: none;
}
.akey {
  width: var(--action-size);
  height: var(--action-size);
  border-radius: 50%;
  pointer-events: auto;
  touch-action: none;
  border: none;
  color: #fff;
}
.akey:active {
  filter: brightness(1.3);
}
.ab {
  background: #c0392b;
  font-size: clamp(18px, 5vw, 22px);
  font-weight: 700;
}
.turbo {
  background: #d98324;
  font-size: clamp(11px, 3vw, 13px);
}
</style>
