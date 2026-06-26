/**
 * NES 运行器:封装 WASM 核心的生命周期、帧循环、画面渲染与音频输出。
 *
 * 渲染:按真实时间锁定 ~60fps,每帧 step_frame -> update_pixels -> putImageData。
 * 音频:用 ScriptProcessorNode 周期性从核心拉取采样,经 GainNode 控制音量后输出。
 * 这些逻辑 Web 与 Tauri 完全通用(都跑在 WebView 里)。
 */
import init, { WasmNes, Button } from '../wasm/nes_core'

const WIDTH = 256
const HEIGHT = 240
const PIXELS_LEN = WIDTH * HEIGHT * 4
const AUDIO_BUFFER_LEN = 4096
// NES(NTSC)实际帧率,用于在任意显示器刷新率下锁定运行速度。
const TARGET_FPS = 60.0988
const FRAME_MS = 1000 / TARGET_FPS

let wasmReady: Promise<unknown> | null = null

/** 确保 WASM 只初始化一次。 */
function ensureWasm(): Promise<unknown> {
  if (!wasmReady) wasmReady = init()
  return wasmReady
}

export class NesRunner {
  private nes: WasmNes | null = null
  private readonly ctx: CanvasRenderingContext2D
  private readonly image: ImageData
  private readonly pixels = new Uint8Array(PIXELS_LEN)
  private rafId = 0
  private running = false

  private audioCtx: AudioContext | null = null
  private scriptNode: ScriptProcessorNode | null = null
  private gainNode: GainNode | null = null
  private readonly audioBuf = new Float32Array(AUDIO_BUFFER_LEN)
  private audioEnabled = true
  private volume = 1
  private speed = 1
  /** 待执行帧数累加器:按真实时间与目标帧率累积,与显示器刷新率解耦。 */
  private frameAcc = 0
  /** 上一帧 rAF 时间戳(ms);0 表示循环刚启动尚未取基准。 */
  private lastTime = 0

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = WIDTH
    canvas.height = HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法获取 2D 渲染上下文')
    this.ctx = ctx
    this.image = ctx.createImageData(WIDTH, HEIGHT)
  }

  /** 载入并启动一个 ROM。 */
  async loadRom(bytes: Uint8Array): Promise<void> {
    await ensureWasm()
    this.stop()
    this.nes = new WasmNes()
    this.nes.set_rom(bytes)
    this.nes.bootup()
    this.setupAudio()
    this.start()
  }

  private setupAudio(): void {
    if (!this.audioEnabled || this.audioCtx) return
    const ctx = new AudioContext()
    // ScriptProcessorNode 已废弃但跨平台最稳;缓冲区大小与核心约定一致。
    const node = ctx.createScriptProcessor(AUDIO_BUFFER_LEN, 0, 1)
    node.onaudioprocess = (e) => {
      const out = e.outputBuffer.getChannelData(0)
      if (!this.nes) {
        out.fill(0)
        return
      }
      this.nes.update_sample_buffer(this.audioBuf)
      out.set(this.audioBuf)
    }
    const gain = ctx.createGain()
    gain.gain.value = this.volume
    node.connect(gain)
    gain.connect(ctx.destination)
    this.audioCtx = ctx
    this.scriptNode = node
    this.gainNode = gain
  }

  /** 浏览器要求音频在用户手势后才能播放,需在点击事件里调用。 */
  resumeAudio(): void {
    void this.audioCtx?.resume()
  }

  setAudioEnabled(on: boolean): void {
    this.audioEnabled = on
    if (!on && this.audioCtx) {
      void this.audioCtx.suspend()
    } else if (on) {
      this.setupAudio()
      void this.audioCtx?.resume()
    }
  }

  /** 设置音量 0~1。 */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    if (this.gainNode) this.gainNode.gain.value = this.volume
  }

  /** 设置运行速度倍率(如 0.5/1/2/3)。 */
  setSpeed(n: number): void {
    this.speed = n > 0 ? n : 1
    this.frameAcc = 0
  }

  private start(): void {
    if (this.running) return
    this.running = true
    this.lastTime = 0
    this.frameAcc = 0
    let fpsFrames = 0
    let fpsWindowStart = 0
    const loop = (now: number) => {
      if (!this.running || !this.nes) return
      // 临时探针:每秒打印实际模拟帧率,用于确认是否锁定在 ~60fps。
      if (fpsWindowStart === 0) fpsWindowStart = now
      if (now - fpsWindowStart >= 1000) {
        console.log(`[NES] 实际帧率 ≈ ${fpsFrames} fps (speed=${this.speed})`)
        fpsFrames = 0
        fpsWindowStart = now
      }
      // 按真实经过时间累积应跑的帧数,使速度与显示器刷新率(60/120/144Hz)无关。
      if (this.lastTime === 0) this.lastTime = now
      let dt = now - this.lastTime
      this.lastTime = now
      if (dt > 250) dt = 250 // 切后台/卡顿后回来,避免一次性狂跑
      this.frameAcc += (dt / FRAME_MS) * this.speed
      let steps = Math.floor(this.frameAcc)
      this.frameAcc -= steps
      if (steps > 0) {
        if (steps > 4) steps = 4
        fpsFrames += steps
        for (let i = 0; i < steps; i++) this.nes.step_frame()
        this.nes.update_pixels(this.pixels)
        this.image.data.set(this.pixels)
        this.ctx.putImageData(this.image, 0, 0)
      }
      this.rafId = requestAnimationFrame(loop)
    }
    this.rafId = requestAnimationFrame(loop)
  }

  stop(): void {
    this.running = false
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = 0
    }
  }

  /** 暂停帧循环与音频(可恢复)。 */
  pause(): void {
    if (!this.nes || !this.running) return
    this.stop()
    void this.audioCtx?.suspend()
  }

  /** 从暂停状态恢复运行。 */
  resume(): void {
    if (!this.nes || this.running) return
    this.start()
    if (this.audioEnabled) void this.audioCtx?.resume()
  }

  /** 帧循环是否正在运行。 */
  get isRunning(): boolean {
    return this.running
  }

  /** 中止并卸载当前 ROM,清空画面,回到未载入状态(可再次 loadRom)。 */
  unload(): void {
    this.stop()
    void this.audioCtx?.suspend()
    this.nes?.free()
    this.nes = null
    this.ctx.clearRect(0, 0, WIDTH, HEIGHT)
  }

  reset(): void {
    this.nes?.reset()
  }

  press(button: Button): void {
    this.nes?.press_button(button)
  }

  release(button: Button): void {
    this.nes?.release_button(button)
  }

  /** 是否已载入 ROM。 */
  get loaded(): boolean {
    return this.nes !== null
  }

  /** 释放资源。 */
  dispose(): void {
    this.stop()
    void this.audioCtx?.close()
    this.audioCtx = null
    this.scriptNode = null
    this.gainNode = null
    this.nes?.free()
    this.nes = null
  }
}

export { Button }
export const SCREEN = { WIDTH, HEIGHT }
