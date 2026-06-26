/**
 * 平台抽象层:隔离 Web 与 Tauri 的差异。
 * 当前实现 Web 版本;Tauri 版本只需替换对应实现(如用 @tauri-apps/plugin-fs 读写本地文件)。
 */

/** 运行时是否在 Tauri 环境中。 */
export const isTauri = typeof window !== 'undefined' && typeof window.__TAURI__ !== 'undefined'

/**
 * 让用户选择一个 .nes ROM 文件,返回其字节。
 * Web:用隐藏的 <input type=file>。Tauri 后续可换成原生文件对话框。
 */
export function pickRomFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.nes'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      const buf = await file.arrayBuffer()
      resolve({ name: file.name, bytes: new Uint8Array(buf) })
    }
    input.click()
  })
}

/** 存档:Web 用 localStorage 存最近一次的 ROM 名称(示例,后续可扩展为 IndexedDB 存档点)。 */
export const storage = {
  setLastRom(name: string) {
    try {
      localStorage.setItem('nes:lastRom', name)
    } catch {
      /* 忽略隐私模式等异常 */
    }
  },
  getLastRom(): string | null {
    try {
      return localStorage.getItem('nes:lastRom')
    } catch {
      return null
    }
  },
}
