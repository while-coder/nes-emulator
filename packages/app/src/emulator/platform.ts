/**
 * App 平台抽象层:这里后续接 Tauri dialog/fs/log 插件。
 * 先保留浏览器文件选择作为兜底,避免结构拆分时引入额外原生权限。
 */

export const isTauri = typeof window !== 'undefined' && typeof window.__TAURI__ !== 'undefined'

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

export const storage = {
  setLastRom(name: string) {
    try {
      localStorage.setItem('nes:app:lastRom', name)
    } catch {
      /* ignore storage failures */
    }
  },
  getLastRom(): string | null {
    try {
      return localStorage.getItem('nes:app:lastRom')
    } catch {
      return null
    }
  },
}
