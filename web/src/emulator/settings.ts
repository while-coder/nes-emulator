/**
 * 全局设置:按键映射、显示效果、音频、杂项。
 *
 * 引擎(WASM 核心)本身不提供任何配置项,所有设置都在前端实现并持久化到
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

/** 仅恢复按键映射为默认值。 */
export function resetKeymap(): void {
  settings.keymap = defaultSettings().keymap
}

/** 由 keymap 反推 code -> 按钮 id 查找表,供运行时按键派发。 */
export function buildCodeToButton(map: Record<number, string>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, code] of Object.entries(map)) {
    if (code) out[code] = Number(id)
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
