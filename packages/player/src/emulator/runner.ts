/**
 * NES 运行器:封装 jsnes 核心的生命周期、帧循环、画面渲染与音频输出。
 *
 * 渲染:按真实时间锁定 ~60fps,每帧 nes.frame() 后把 jsnes 的帧缓冲写入 canvas。
 * 音频:jsnes 在执行帧时通过 onAudioSample 推送采样,这里写入环形缓冲,
 * 再由 ScriptProcessorNode 稳定输出到浏览器音频设备。
 */
import './jsnes-mapper90.js'
import { Controller, NES, type ButtonKey, type ControllerId, type EmulatorData } from 'jsnes'

/** 存档快照:jsnes 引擎完整状态的可序列化对象(可直接存入 IndexedDB)。 */
export type SaveState = EmulatorData

const WIDTH = 256
const HEIGHT = 240
const PIXELS_LEN = WIDTH * HEIGHT
const AUDIO_BUFFER_LEN = 4096
const AUDIO_QUEUE_LEN = 32768
// NES(NTSC)实际帧率,用于在任意显示器刷新率下锁定运行速度。
const TARGET_FPS = 60.0988
const FRAME_MS = 1000 / TARGET_FPS

export enum Button {
  Poweroff = 0,
  Reset = 1,
  // 玩家1
  Joypad1A = 2,
  Joypad1B = 3,
  Joypad1Up = 4,
  Joypad1Down = 5,
  Joypad1Left = 6,
  Joypad1Right = 7,
  Joypad1Start = 8,
  Joypad1Select = 9,
  // 玩家2
  Joypad2A = 10,
  Joypad2B = 11,
  Joypad2Up = 12,
  Joypad2Down = 13,
  Joypad2Left = 14,
  Joypad2Right = 15,
  Joypad2Start = 16,
  Joypad2Select = 17,
}

type ButtonBinding = {
  controller: ControllerId
  button: ButtonKey
}

const BUTTON_BINDINGS: Partial<Record<Button, ButtonBinding>> = {
  [Button.Joypad1A]: { controller: 1, button: Controller.BUTTON_A },
  [Button.Joypad1B]: { controller: 1, button: Controller.BUTTON_B },
  [Button.Joypad1Up]: { controller: 1, button: Controller.BUTTON_UP },
  [Button.Joypad1Down]: { controller: 1, button: Controller.BUTTON_DOWN },
  [Button.Joypad1Left]: { controller: 1, button: Controller.BUTTON_LEFT },
  [Button.Joypad1Right]: { controller: 1, button: Controller.BUTTON_RIGHT },
  [Button.Joypad1Start]: { controller: 1, button: Controller.BUTTON_START },
  [Button.Joypad1Select]: { controller: 1, button: Controller.BUTTON_SELECT },
  [Button.Joypad2A]: { controller: 2, button: Controller.BUTTON_A },
  [Button.Joypad2B]: { controller: 2, button: Controller.BUTTON_B },
  [Button.Joypad2Up]: { controller: 2, button: Controller.BUTTON_UP },
  [Button.Joypad2Down]: { controller: 2, button: Controller.BUTTON_DOWN },
  [Button.Joypad2Left]: { controller: 2, button: Controller.BUTTON_LEFT },
  [Button.Joypad2Right]: { controller: 2, button: Controller.BUTTON_RIGHT },
  [Button.Joypad2Start]: { controller: 2, button: Controller.BUTTON_START },
  [Button.Joypad2Select]: { controller: 2, button: Controller.BUTTON_SELECT },
}

export class NesRunner {
  private nes: NES | null = null
  private readonly ctx: CanvasRenderingContext2D
  private readonly image: ImageData
  private readonly frame32: Uint32Array
  private readonly frame8: Uint8ClampedArray
  private rafId = 0
  private running = false

  private audioCtx: AudioContext | null = null
  private scriptNode: ScriptProcessorNode | null = null
  private gainNode: GainNode | null = null
  private readonly audioLeft = new Float32Array(AUDIO_QUEUE_LEN)
  private readonly audioRight = new Float32Array(AUDIO_QUEUE_LEN)
  private audioRead = 0
  private audioWrite = 0
  private audioQueued = 0
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
    this.frame8 = new Uint8ClampedArray(this.image.data.buffer)
    this.frame32 = new Uint32Array(this.image.data.buffer)
  }

  /** 载入并启动一个 ROM。 */
  async loadRom(bytes: Uint8Array): Promise<void> {
    this.stop()
    this.clearAudioQueue()
    this.setupAudio()
    this.nes = new NES({
      sampleRate: this.audioCtx?.sampleRate ?? 44100,
      emulateSound: true,
      onFrame: (frameBuffer) => this.renderFrame(frameBuffer),
      onAudioSample: (left, right) => this.enqueueAudio(left, right),
    })
    this.nes.loadROM(bytes)
    this.nes.setFramerate(TARGET_FPS * this.speed)
    this.start()
  }

  private setupAudio(): void {
    if (!this.audioEnabled || this.audioCtx) return
    const ctx = new AudioContext()
    // ScriptProcessorNode 已废弃但跨平台稳定,且足够承接 jsnes 的采样回调。
    const node = ctx.createScriptProcessor(AUDIO_BUFFER_LEN, 0, 2)
    node.onaudioprocess = (e) => {
      const outL = e.outputBuffer.getChannelData(0)
      const outR = e.outputBuffer.getChannelData(1)
      this.fillAudioOutput(outL, outR)
    }
    const gain = ctx.createGain()
    gain.gain.value = this.volume
    node.connect(gain)
    gain.connect(ctx.destination)
    this.audioCtx = ctx
    this.scriptNode = node
    this.gainNode = gain
  }

  private renderFrame(frameBuffer: Uint32Array): void {
    for (let i = 0; i < PIXELS_LEN; i++) {
      // jsnes 输出的像素已是 NES BGR(即小端 ABGR 的低 24 位),
      // 直接补上不透明 alpha 即可写入 ImageData,不可再交换 R/B。
      this.frame32[i] = 0xff000000 | frameBuffer[i]
    }
    this.image.data.set(this.frame8)
    this.ctx.putImageData(this.image, 0, 0)
  }

  private enqueueAudio(left: number, right: number): void {
    if (!this.audioEnabled) return
    if (this.audioQueued >= AUDIO_QUEUE_LEN) {
      this.audioRead = (this.audioRead + 1) % AUDIO_QUEUE_LEN
      this.audioQueued--
    }
    this.audioLeft[this.audioWrite] = left
    this.audioRight[this.audioWrite] = right
    this.audioWrite = (this.audioWrite + 1) % AUDIO_QUEUE_LEN
    this.audioQueued++
  }

  private fillAudioOutput(outL: Float32Array, outR: Float32Array): void {
    for (let i = 0; i < outL.length; i++) {
      if (this.audioQueued === 0) {
        outL[i] = 0
        outR[i] = 0
        continue
      }
      outL[i] = this.audioLeft[this.audioRead]
      outR[i] = this.audioRight[this.audioRead]
      this.audioRead = (this.audioRead + 1) % AUDIO_QUEUE_LEN
      this.audioQueued--
    }
  }

  private clearAudioQueue(): void {
    this.audioRead = 0
    this.audioWrite = 0
    this.audioQueued = 0
  }

  /** 浏览器要求音频在用户手势后才能播放,需在点击事件里调用。 */
  resumeAudio(): void {
    void this.audioCtx?.resume()
  }

  setAudioEnabled(on: boolean): void {
    this.audioEnabled = on
    if (!on && this.audioCtx) {
      this.clearAudioQueue()
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
    this.nes?.setFramerate(TARGET_FPS * this.speed)
  }

  private start(): void {
    if (this.running) return
    this.running = true
    this.lastTime = 0
    this.frameAcc = 0
    const loop = (now: number) => {
      if (!this.running || !this.nes) return
      if (this.lastTime === 0) this.lastTime = now
      let dt = now - this.lastTime
      this.lastTime = now
      if (dt > 250) dt = 250
      this.frameAcc += (dt / FRAME_MS) * this.speed
      let steps = Math.floor(this.frameAcc)
      this.frameAcc -= steps
      if (steps > 0) {
        if (steps > 4) steps = 4
        try {
          for (let i = 0; i < steps; i++) this.nes.frame()
        } catch (err) {
          this.stop()
          console.error('[NES] 模拟器运行失败', err)
          throw err
        }
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
    this.nes = null
    this.clearAudioQueue()
    this.ctx.clearRect(0, 0, WIDTH, HEIGHT)
  }

  reset(): void {
    this.nes?.reset()
    this.clearAudioQueue()
  }

  /** 导出当前引擎状态为存档快照;未载入 ROM 时返回 null。 */
  saveState(): SaveState | null {
    if (!this.nes) return null
    return this.nes.toJSON()
  }

  /**
   * 从存档快照恢复引擎状态。需先载入对应 ROM(同一卡带)。
   * 返回是否成功(状态损坏或 mapper 不支持时返回 false,不影响当前运行)。
   */
  loadState(state: SaveState): boolean {
    if (!this.nes) return false
    try {
      this.nes.fromJSON(state)
      this.clearAudioQueue()
      return true
    } catch (err) {
      console.error('[NES] 读取存档失败', err)
      return false
    }
  }

  press(button: Button): void {
    if (button === Button.Reset) {
      this.reset()
      return
    }
    if (button === Button.Poweroff) {
      this.unload()
      return
    }
    const binding = BUTTON_BINDINGS[button]
    if (binding) this.nes?.buttonDown(binding.controller, binding.button)
  }

  release(button: Button): void {
    const binding = BUTTON_BINDINGS[button]
    if (binding) this.nes?.buttonUp(binding.controller, binding.button)
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
    this.nes = null
    this.clearAudioQueue()
  }
}

export const SCREEN = { WIDTH, HEIGHT }
