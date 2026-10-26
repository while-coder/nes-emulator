<script setup lang="ts">
/**
 * 触屏虚拟手柄(经典分离式):左十字方向区、中 SELECT/START、右 A/B 斜排 + 连发。
 *
 * 设计要点:
 * - 方向区用「区域判定」而非独立按钮:按触点相对中心的角度映射到 1~2 个相邻方向,
 *   支持斜向(斜走/斜跳)与滑动换向;手指落在两键交界也能同时触发。
 * - 动作/功能键各自独立,靠 pointerId 天然支持多点触控(方向 + A + B 同时按)。
 * - 所有交互元素 setPointerCapture,手指滑出键外仍能收到 release,避免卡键。
 * - 横屏左方向、中功能、右动作;竖屏上功能、下方向与动作,避开画面与安全区。
 *
 * 仅控制玩家1(单屏双人不现实)。press/release 交父组件路由到引擎(含连发逻辑)。
 */
import { ref } from 'vue'
import { PadButton, settings } from '../emulator/settings'

const emit = defineEmits<{ press: [PadButton]; release: [PadButton] }>()

const DIR_KEYS = [
  { pad: PadButton.Up, cls: 'd-up', label: '▲' },
  { pad: PadButton.Down, cls: 'd-down', label: '▼' },
  { pad: PadButton.Left, cls: 'd-left', label: '◀' },
  { pad: PadButton.Right, cls: 'd-right', label: '▶' },
]

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
let dirPointerId: number | null = null

/** 由屏幕坐标算出方向区当前应激活的方向集(死区内为空)。 */
function dirsAt(clientX: number, clientY: number): PadButton[] {
  const el = dpadRef.value
  if (!el) return []
  const r = el.getBoundingClientRect()
  const dx = clientX - (r.left + r.width / 2)
  const dy = clientY - (r.top + r.height / 2)
  if (Math.hypot(dx, dy) < r.width * 0.2) return [] // 中心死区,避免误触
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

function onDpadDown(e: PointerEvent) {
  if (dirPointerId !== null) return // 已有方向控制指,忽略第二指
  dirPointerId = e.pointerId
  dpadRef.value?.setPointerCapture(e.pointerId)
  e.preventDefault()
  setDirs(dirsAt(e.clientX, e.clientY))
}
function onDpadMove(e: PointerEvent) {
  if (e.pointerId !== dirPointerId) return
  e.preventDefault()
  setDirs(dirsAt(e.clientX, e.clientY))
}
function onDpadUp(e: PointerEvent) {
  if (e.pointerId !== dirPointerId) return
  e.preventDefault()
  dirPointerId = null
  setDirs([])
}

function onBtnDown(e: PointerEvent, pad: PadButton) {
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  e.preventDefault()
  emit('press', pad)
}
function onBtnUp(e: PointerEvent, pad: PadButton) {
  e.preventDefault()
  emit('release', pad)
}
</script>

<template>
  <div class="touch-controls" :class="settings.misc.touchPad">
    <!-- 左:方向区(视觉十字键,逻辑为区域判定) -->
    <div
      ref="dpadRef"
      class="dpad"
      @pointerdown="onDpadDown"
      @pointermove="onDpadMove"
      @pointerup="onDpadUp"
      @pointercancel="onDpadUp"
      @contextmenu.prevent
    >
      <span
        v-for="d in DIR_KEYS"
        :key="d.pad"
        :class="['dkey', d.cls, { active: activeDirs.includes(d.pad) }]"
      >
        {{ d.label }}
      </span>
      <span class="dkey d-center" />
    </div>

    <!-- 中:SELECT / START -->
    <div class="fn">
      <button
        class="fkey"
        @pointerdown="onBtnDown($event, PadButton.Select)"
        @pointerup="onBtnUp($event, PadButton.Select)"
        @pointercancel="onBtnUp($event, PadButton.Select)"
        @contextmenu.prevent
      >
        SELECT
      </button>
      <button
        class="fkey"
        @pointerdown="onBtnDown($event, PadButton.Start)"
        @pointerup="onBtnUp($event, PadButton.Start)"
        @pointercancel="onBtnUp($event, PadButton.Start)"
        @contextmenu.prevent
      >
        START
      </button>
    </div>

    <!-- 右:A/B 斜排(A 右下、B 左上),每列上方为连发键 -->
    <div class="actions">
      <div class="col col-b">
        <button
          class="akey turbo"
          @pointerdown="onBtnDown($event, PadButton.TurboB)"
          @pointerup="onBtnUp($event, PadButton.TurboB)"
          @pointercancel="onBtnUp($event, PadButton.TurboB)"
          @contextmenu.prevent
        >
          连B
        </button>
        <button
          class="akey ab b"
          @pointerdown="onBtnDown($event, PadButton.B)"
          @pointerup="onBtnUp($event, PadButton.B)"
          @pointercancel="onBtnUp($event, PadButton.B)"
          @contextmenu.prevent
        >
          B
        </button>
      </div>
      <div class="col col-a">
        <button
          class="akey turbo"
          @pointerdown="onBtnDown($event, PadButton.TurboA)"
          @pointerup="onBtnUp($event, PadButton.TurboA)"
          @pointercancel="onBtnUp($event, PadButton.TurboA)"
          @contextmenu.prevent
        >
          连A
        </button>
        <button
          class="akey ab a"
          @pointerdown="onBtnDown($event, PadButton.A)"
          @pointerup="onBtnUp($event, PadButton.A)"
          @pointercancel="onBtnUp($event, PadButton.A)"
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
    height: clamp(216px, 36dvh, 300px);
    --pad-size: clamp(132px, 38vw, 180px);
    --action-size: clamp(52px, 15vw, 72px);
  }
  .dpad {
    top: auto;
    bottom: 12px;
    transform: none;
  }
  .actions {
    top: auto;
    bottom: 12px;
    transform: none;
  }
  .fn {
    top: 0;
    bottom: auto;
    left: 0;
    right: 0;
    transform: none;
    justify-content: space-between;
    padding-inline: calc(8px + (var(--pad-size) - 80px) / 2);
  }
}

/* ===== 方向区:3×3 网格摆出十字,中心+四臂 ===== */
.dpad {
  flex: 0 0 auto;
  width: var(--pad-size);
  height: var(--pad-size);
  pointer-events: auto;
  touch-action: none;
}
.dkey {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 33.34%;
  height: 33.34%;
  background: rgba(58, 58, 58, 0.85);
  color: #eee;
  font-size: clamp(15px, 4vw, 18px);
  pointer-events: none;
}
.d-up {
  top: 0;
  left: 33.33%;
  border-radius: 10px 10px 0 0;
}
.d-down {
  bottom: 0;
  left: 33.33%;
  border-radius: 0 0 10px 10px;
}
.d-left {
  left: 0;
  top: 33.33%;
  border-radius: 10px 0 0 10px;
}
.d-right {
  right: 0;
  top: 33.33%;
  border-radius: 0 10px 10px 0;
}
.d-center {
  left: 33.33%;
  top: 33.33%;
}
.dkey.active {
  background: rgba(120, 120, 120, 0.95);
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

/* ===== A / B 斜排:两列,左列(B 系)整体上移形成斜差 ===== */
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
.col-b {
  margin-bottom: 24px;
}
.akey {
  pointer-events: auto;
  touch-action: none;
  border: none;
  color: #fff;
}
.akey:active {
  filter: brightness(1.3);
}
.ab {
  width: var(--action-size);
  height: var(--action-size);
  border-radius: 50%;
  background: #c0392b;
  font-size: clamp(18px, 5vw, 22px);
  font-weight: 700;
}
.turbo {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #d98324;
  font-size: clamp(11px, 3vw, 13px);
}
</style>
