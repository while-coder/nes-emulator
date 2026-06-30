import { onBeforeUnmount, watch, type Ref } from 'vue'
import { GAMEPAD_AXIS_THRESHOLD } from '../emulator/settings'

// ===== Android TV 遥控器 / 手柄的统一 UI 焦点导航 =====
// 几何空间导航:DPAD 方向上,在容器内的可聚焦元素中按真实矩形找最近邻并 .focus()。
// 对横排工具栏 / 竖排列表 / 混合表单都自适应,且直接操作原生焦点,
// 从而天然复用浏览器对 select/range/checkbox 等控件的键盘行为。
//
// 全局只跑一个 rAF(手柄轮询)+ 一个 window keydown;多个组件实例经"优先级栈"协作:
// 同时活跃时只有 priority 最高者收按键 —— 模态一开自动夺取按键,关闭后回落工具栏。

type Dir = 'up' | 'down' | 'left' | 'right'

export interface RemoteNavOptions {
  /** 只在此容器内查找可聚焦元素。 */
  container: Ref<HTMLElement | null>
  /** 为真时本实例参与导航(模态绑 open;工具栏绑 !inputLocked && (!rom||paused))。 */
  active: Ref<boolean>
  /** 返回键(遥控 BACK / 手柄 B / Esc / Backspace):关模态或暂停。 */
  onBack?: () => void
  /** 激活时是否自动把焦点落到首个可聚焦元素(TV 启动入口用)。 */
  autoFocus?: boolean
  /** 多实例同时活跃时,数值大者独占按键。工具栏 0,模态 10,下拉 20。 */
  priority?: number
}

export interface RemoteNavApi {
  /** 聚焦容器内首个可聚焦元素。 */
  focusFirst: () => void
  focusElement: (el: HTMLElement | null) => void
  /** 按方向移动焦点(供外部如游戏轮询复用)。 */
  move: (dir: Dir) => void
}

const FOCUSABLE =
  'button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"]),[data-nav]'

interface NavInstance {
  opts: RemoteNavOptions
  priority: number
  move: (dir: Dir) => void
  ok: () => void
  back: () => void
}

// ===== 模块级单例:活跃实例栈 + 唯一 rAF + 唯一 keydown =====
const instances: NavInstance[] = []
let rafId = 0
let listening = false

// 手柄边沿检测状态(跨整个栈共享,按键只发给栈顶)。
const padPrev = { up: false, down: false, left: false, right: false, ok: false, back: false }

/** 当前应接收按键的实例:活跃实例中 priority 最高者。 */
function topInstance(): NavInstance | null {
  let top: NavInstance | null = null
  for (const inst of instances) {
    if (!inst.opts.active.value) continue
    if (!top || inst.priority >= top.priority) top = inst
  }
  return top
}

function isFocusable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false
  if ((el as HTMLButtonElement).disabled) return false
  // 不可见(display:none / 不在渲染树)时 offsetParent 为 null;position:fixed 例外,故再看尺寸。
  if (el.offsetParent === null && el.getClientRects().length === 0) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isFocusable)
}

/** 几何最近邻:在 dir 方向的候选中,按主轴距离 + 副轴错位(同行/同列加权)取最小。 */
function pickNeighbor(from: DOMRect, cands: HTMLElement[], dir: Dir): HTMLElement | null {
  const fromCx = from.left + from.width / 2
  const fromCy = from.top + from.height / 2
  let best: HTMLElement | null = null
  let bestCost = Infinity
  for (const el of cands) {
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    let main: number // 主轴(必须为正,即确实在该方向)
    let off: number // 副轴错位
    let overlap: boolean // 副轴是否有投影重叠(同行/同列)
    if (dir === 'up' || dir === 'down') {
      main = dir === 'up' ? fromCy - cy : cy - fromCy
      off = Math.abs(cx - fromCx)
      overlap = r.left < from.right && r.right > from.left
    } else {
      main = dir === 'left' ? fromCx - cx : cx - fromCx
      off = Math.abs(cy - fromCy)
      overlap = r.top < from.bottom && r.bottom > from.top
    }
    if (main <= 1) continue // 不在该方向(含自身)
    const cost = main + (overlap ? off * 0.3 : off * 2)
    if (cost < bestCost) {
      bestCost = cost
      best = el
    }
  }
  return best
}

/** 原生控件在 DPAD 左右键下的调值;消费返回 true(不再移动焦点)。 */
function adjustControl(el: HTMLElement, dir: 'left' | 'right'): boolean {
  const delta = dir === 'right' ? 1 : -1
  if (el instanceof HTMLInputElement && el.type === 'range') {
    const step = Number(el.step) || 1
    const min = el.min === '' ? -Infinity : Number(el.min)
    const max = el.max === '' ? Infinity : Number(el.max)
    const next = Math.min(max, Math.max(min, Number(el.value) + delta * step))
    if (next !== Number(el.value)) {
      el.value = String(next)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    return true
  }
  if (el instanceof HTMLSelectElement) {
    const n = el.options.length
    if (n > 0) {
      const next = Math.min(n - 1, Math.max(0, el.selectedIndex + delta))
      if (next !== el.selectedIndex) {
        el.selectedIndex = next
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }
    return true
  }
  return false
}

/** OK / 确定键:按控件类型分流(checkbox 切换、其余 click)。 */
function activate(el: HTMLElement): void {
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    el.checked = el.type === 'checkbox' ? !el.checked : true
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return
  }
  el.click()
}

/** 焦点是否落在"正在打字"的文本输入上(此时上下/确定让位原生)。 */
function isTextEntry(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement) {
    const t = el.type
    return t === 'text' || t === 'search' || t === 'number' || t === 'password' || t === 'email' || t === 'url'
  }
  return false
}

function pollPads(): void {
  rafId = requestAnimationFrame(pollPads)
  const top = topInstance()
  // 无活跃实例(如桌面 isTv 为假、或当前无导航):跳过手柄读取并清边沿状态,
  // 既省掉每帧 getGamepads,也避免下次激活时把"按住未松"误判成新按下。
  if (!top) {
    padPrev.up = false
    padPrev.down = false
    padPrev.left = false
    padPrev.right = false
    padPrev.ok = false
    padPrev.back = false
    return
  }
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
  let up = false
  let down = false
  let left = false
  let right = false
  let ok = false
  let back = false
  for (const pad of pads) {
    if (!pad) continue
    if (pad.buttons[12]?.pressed) up = true
    if (pad.buttons[13]?.pressed) down = true
    if (pad.buttons[14]?.pressed) left = true
    if (pad.buttons[15]?.pressed) right = true
    const ax = pad.axes[0] ?? 0
    const ay = pad.axes[1] ?? 0
    if (ay < -GAMEPAD_AXIS_THRESHOLD) up = true
    if (ay > GAMEPAD_AXIS_THRESHOLD) down = true
    if (ax < -GAMEPAD_AXIS_THRESHOLD) left = true
    if (ax > GAMEPAD_AXIS_THRESHOLD) right = true
    if (pad.buttons[0]?.pressed) ok = true
    if (pad.buttons[1]?.pressed) back = true
  }
  // 边沿触发,仅发给栈顶实例。
  if (up && !padPrev.up) top.move('up')
  if (down && !padPrev.down) top.move('down')
  if (left && !padPrev.left) top.move('left')
  if (right && !padPrev.right) top.move('right')
  if (ok && !padPrev.ok) top.ok()
  if (back && !padPrev.back) top.back()
  padPrev.up = up
  padPrev.down = down
  padPrev.left = left
  padPrev.right = right
  padPrev.ok = ok
  padPrev.back = back
}

function onKeyDown(e: KeyboardEvent): void {
  const top = topInstance()
  if (!top) return
  const active = document.activeElement
  const typing = isTextEntry(active)

  switch (e.key) {
    case 'ArrowUp':
      if (typing) return
      e.preventDefault()
      top.move('up')
      return
    case 'ArrowDown':
      if (typing) return
      e.preventDefault()
      top.move('down')
      return
    case 'ArrowLeft':
      if (typing) return
      e.preventDefault()
      top.move('left')
      return
    case 'ArrowRight':
      if (typing) return
      e.preventDefault()
      top.move('right')
      return
    case 'Enter':
      if (typing) return // 文本框内回车交原生(如提交/换行)
      e.preventDefault()
      top.ok()
      return
    case 'Escape':
    case 'Backspace':
    case 'GoBack':
    case 'BrowserBack':
      if (typing && e.key === 'Backspace') return // 打字时退格交原生
      e.preventDefault()
      top.back()
      return
  }
}

function ensureGlobalListeners(): void {
  if (listening) return
  if (typeof window === 'undefined') return
  listening = true
  window.addEventListener('keydown', onKeyDown)
  rafId = requestAnimationFrame(pollPads)
}

function teardownGlobalListeners(): void {
  if (!listening) return
  // 仍有实例存活则保留(可能只是暂时无活跃实例)。
  if (instances.length > 0) return
  listening = false
  window.removeEventListener('keydown', onKeyDown)
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
}

export function useRemoteNav(opts: RemoteNavOptions): RemoteNavApi {
  const priority = opts.priority ?? 0

  function move(dir: Dir): void {
    const container = opts.container.value
    if (!container) return
    const active = document.activeElement
    // 焦点在 select/range 上时,左右键交给控件调值。
    if ((dir === 'left' || dir === 'right') && active instanceof HTMLElement) {
      if (container.contains(active) && adjustControl(active, dir)) return
    }
    const cands = focusableIn(container)
    if (cands.length === 0) return
    const current = active instanceof HTMLElement && container.contains(active) ? active : null
    if (!current) {
      cands[0].focus()
      cands[0].scrollIntoView({ block: 'nearest', inline: 'nearest' })
      return
    }
    const next = pickNeighbor(current.getBoundingClientRect(), cands, dir)
    if (next) {
      next.focus()
      next.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }

  function ok(): void {
    const container = opts.container.value
    const active = document.activeElement
    if (container && active instanceof HTMLElement && container.contains(active)) {
      activate(active)
    }
  }

  function back(): void {
    opts.onBack?.()
  }

  function focusElement(el: HTMLElement | null): void {
    if (el && isFocusable(el)) {
      el.focus()
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }

  function focusFirst(): void {
    const container = opts.container.value
    if (!container) return
    const cands = focusableIn(container)
    if (cands.length) focusElement(cands[0])
  }

  const inst: NavInstance = { opts, priority, move, ok, back }
  instances.push(inst)
  ensureGlobalListeners()

  // 激活时(且要求)自动聚焦首项,等容器渲染就绪。
  const stop = watch(
    opts.active,
    (on) => {
      if (on && opts.autoFocus) {
        requestAnimationFrame(() => focusFirst())
      }
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    stop()
    const i = instances.indexOf(inst)
    if (i >= 0) instances.splice(i, 1)
    teardownGlobalListeners()
  })

  return { focusFirst, focusElement, move }
}
