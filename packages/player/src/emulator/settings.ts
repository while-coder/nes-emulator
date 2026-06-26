/**
 * 全局设置:按键映射、显示效果、音频、杂项。
 *
 * 引擎本身不提供这些应用级配置项,所有设置都在前端实现并持久化到
 * localStorage。各组件直接 import 这里的 reactive 单例 `settings` 使用,
 * 修改后由 watch 自动保存。
 */
import { reactive, watch } from 'vue'
import { Button } from './runner'

/** 画面宽高比预设。1:1 为方像素(256:240),8:7 与 4:3 为常见的拉伸观感。 */
export type Aspect = '1:1' | '8:7' | '4:3'
/** 触屏手柄显示策略。 */
export type TouchPadMode = 'auto' | 'always' | 'never'

export interface Settings {
  /** 按钮 id -> 键盘 KeyboardEvent.code。id 含引擎 Button(0~7)与连发虚拟键。 */
  keymap: Record<number, string>
  /**
   * 按钮 id -> 手柄输入标识(与 keymap 并存,键盘/手柄可同时使用)。
   * 标识格式:`b{n}` 为 buttons[n];`a{n}+` / `a{n}-` 为 axes[n] 正/负方向。
   */
  padmap: Record<number, string>
  display: {
    /** true=双线性平滑,false=像素化(默认)。 */
    smoothing: boolean
    aspect: Aspect
    /** 仅按整数倍放大,避免像素抖动。 */
    integerScale: boolean
    /** CRT 扫描线滤镜。 */
    scanlines: boolean
    /** 画面区背景色。 */
    bgColor: string
  }
  audio: {
    /** 音量 0~1。 */
    volume: number
  }
  misc: {
    touchPad: TouchPadMode
    /** 运行速度倍率。 */
    speed: number
    /** 连发频率(次/秒)。 */
    turboHz: number
  }
}

/** 连发(Turbo)虚拟按钮 id,取大数值避免与引擎 Button(0~7)冲突。 */
export const TURBO_A = 100
export const TURBO_B = 101
/** 连发虚拟按钮 -> 实际触发的引擎按钮。 */
export const TURBO_TARGET: Record<number, Button> = {
  [TURBO_A]: Button.Joypad1A,
  [TURBO_B]: Button.Joypad1B,
}
/** 判断一个按钮 id 是否为连发虚拟按钮。 */
export function isTurbo(id: number): boolean {
  return id === TURBO_A || id === TURBO_B
}

/** 可重绑的按钮顺序与中文名,供设置界面与按键说明渲染。 */
export const BUTTON_LIST: { btn: number; label: string }[] = [
  { btn: Button.Joypad1Up, label: '上' },
  { btn: Button.Joypad1Down, label: '下' },
  { btn: Button.Joypad1Left, label: '左' },
  { btn: Button.Joypad1Right, label: '右' },
  { btn: Button.Joypad1A, label: 'A' },
  { btn: Button.Joypad1B, label: 'B' },
  { btn: TURBO_A, label: '连发A' },
  { btn: TURBO_B, label: '连发B' },
  { btn: Button.Start, label: 'Start' },
  { btn: Button.Select, label: 'Select' },
]

export const SPEED_OPTIONS = [0.5, 1, 2, 3]
export const TURBO_HZ_OPTIONS = [8, 16, 24, 30]

/** 摇杆轴触发阈值:绝对值超过此值才视为对应方向按下,避免静止漂移误触。 */
export const GAMEPAD_AXIS_THRESHOLD = 0.5

function defaultSettings(): Settings {
  return {
    keymap: {
      [Button.Joypad1Up]: 'ArrowUp',
      [Button.Joypad1Down]: 'ArrowDown',
      [Button.Joypad1Left]: 'ArrowLeft',
      [Button.Joypad1Right]: 'ArrowRight',
      [Button.Joypad1A]: 'KeyZ',
      [Button.Joypad1B]: 'KeyX',
      [Button.Start]: 'Enter',
      [Button.Select]: 'ShiftRight',
      [TURBO_A]: 'KeyA',
      [TURBO_B]: 'KeyS',
    },
    // 默认按标准手柄布局(W3C Standard Gamepad):方向用 D-pad(b12~b15),
    // A/B 取 Nintendo 手感(A 在右=b1,B 在下=b0),连发绑到面键 X/Y。
    padmap: {
      [Button.Joypad1Up]: 'b12',
      [Button.Joypad1Down]: 'b13',
      [Button.Joypad1Left]: 'b14',
      [Button.Joypad1Right]: 'b15',
      [Button.Joypad1A]: 'b1',
      [Button.Joypad1B]: 'b0',
      [Button.Start]: 'b9',
      [Button.Select]: 'b8',
      [TURBO_A]: 'b3',
      [TURBO_B]: 'b2',
    },
    display: {
      smoothing: false,
      aspect: '1:1',
      integerScale: false,
      scanlines: false,
      bgColor: '#000000',
    },
    audio: {
      volume: 1,
    },
    misc: {
      touchPad: 'auto',
      speed: 1,
      turboHz: 16,
    },
  }
}

const STORAGE_KEY = 'nes.settings'

/** 把已存的设置与默认值深合并,容忍缺字段/旧版本。 */
function merge(base: Settings, saved: unknown): Settings {
  if (!saved || typeof saved !== 'object') return base
  const s = saved as Partial<Settings>
  return {
    keymap: { ...base.keymap, ...(s.keymap ?? {}) },
    padmap: { ...base.padmap, ...(s.padmap ?? {}) },
    display: { ...base.display, ...(s.display ?? {}) },
    audio: { ...base.audio, ...(s.audio ?? {}) },
    misc: { ...base.misc, ...(s.misc ?? {}) },
  }
}

function load(): Settings {
  const base = defaultSettings()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? merge(base, JSON.parse(raw)) : base
  } catch {
    return base
  }
}

export const settings = reactive<Settings>(load())

watch(
  settings,
  (s) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    } catch {
      // 忽略隐私模式等写入失败
    }
  },
  { deep: true },
)

/** 恢复全部设置为默认值(原地替换字段,保持响应式)。 */
export function resetSettings(): void {
  Object.assign(settings, defaultSettings())
}

/** 仅恢复按键映射(键盘 + 手柄)为默认值。 */
export function resetKeymap(): void {
  const d = defaultSettings()
  settings.keymap = d.keymap
  settings.padmap = d.padmap
}

/** 由 keymap 反推 code -> 按钮 id 查找表,供运行时按键派发。 */
export function buildCodeToButton(map: Record<number, string>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, code] of Object.entries(map)) {
    if (code) out[code] = Number(id)
  }
  return out
}

/** 由 padmap 反推 手柄输入标识 -> 按钮 id 查找表,供运行时手柄派发。 */
export function buildPadToButton(map: Record<number, string>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, sig] of Object.entries(map)) {
    if (sig) out[sig] = Number(id)
  }
  return out
}

/** 部分 KeyboardEvent.code 的友好显示名。 */
const CODE_LABELS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: 'Enter',
  Space: 'Space',
  ShiftLeft: 'L-Shift',
  ShiftRight: 'R-Shift',
  ControlLeft: 'L-Ctrl',
  ControlRight: 'R-Ctrl',
  Tab: 'Tab',
  Backspace: 'Backspace',
}

/** 把 KeyboardEvent.code 显示成更友好的名字。 */
export function codeLabel(code: string | undefined): string {
  if (!code) return '未绑定'
  if (CODE_LABELS[code]) return CODE_LABELS[code]
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/^Numpad/, 'Num ')
    .replace(/^Arrow/, '')
}

/** 标准手柄(Standard Gamepad)按钮序号的常见名,仅作显示用。 */
const PAD_BUTTON_LABELS: Record<number, string> = {
  0: 'A',
  1: 'B',
  2: 'X',
  3: 'Y',
  4: 'LB',
  5: 'RB',
  6: 'LT',
  7: 'RT',
  8: 'Select',
  9: 'Start',
  10: 'L3',
  11: 'R3',
  12: '↑',
  13: '↓',
  14: '←',
  15: '→',
  16: 'Home',
}

/** 把手柄输入标识显示成更友好的名字(如 b1 -> "B"、a0- -> "摇杆←")。 */
export function padLabel(sig: string | undefined): string {
  if (!sig) return '未绑定'
  const b = /^b(\d+)$/.exec(sig)
  if (b) {
    const n = Number(b[1])
    return PAD_BUTTON_LABELS[n] ?? `键${n}`
  }
  const a = /^a(\d+)([+-])$/.exec(sig)
  if (a) return `摇杆${a[1]}${a[2] === '+' ? '+' : '−'}`
  return sig
}

/** 判断某个手柄输入标识在给定 Gamepad 当前是否处于按下/触发状态。 */
export function isPadSignalActive(pad: Gamepad, sig: string): boolean {
  const b = /^b(\d+)$/.exec(sig)
  if (b) {
    const btn = pad.buttons[Number(b[1])]
    return btn ? btn.pressed || btn.value > 0.5 : false
  }
  const a = /^a(\d+)([+-])$/.exec(sig)
  if (a) {
    const v = pad.axes[Number(a[1])]
    if (v === undefined) return false
    return a[2] === '+' ? v > GAMEPAD_AXIS_THRESHOLD : v < -GAMEPAD_AXIS_THRESHOLD
  }
  return false
}

/**
 * 扫描一个 Gamepad,返回当前正被按下的第一个输入标识(用于设置界面录入)。
 * 仅在该输入相对 baseline 发生变化时才识别,避免把扳机的静止偏置/已按住的键当成新输入。
 */
export function detectPadSignal(pad: Gamepad, baseline: Gamepad | null): string | null {
  for (let i = 0; i < pad.buttons.length; i++) {
    const pressed = pad.buttons[i]?.pressed || pad.buttons[i]?.value > 0.5
    const was = baseline?.buttons[i]?.pressed || (baseline?.buttons[i]?.value ?? 0) > 0.5
    if (pressed && !was) return `b${i}`
  }
  for (let i = 0; i < pad.axes.length; i++) {
    const v = pad.axes[i]
    const base = baseline?.axes[i] ?? 0
    if (v > GAMEPAD_AXIS_THRESHOLD && base <= GAMEPAD_AXIS_THRESHOLD) return `a${i}+`
    if (v < -GAMEPAD_AXIS_THRESHOLD && base >= -GAMEPAD_AXIS_THRESHOLD) return `a${i}-`
  }
  return null
}
