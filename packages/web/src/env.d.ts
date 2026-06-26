/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

interface Window {
  // Tauri 注入的全局对象,用于运行时区分 Web / Tauri
  __TAURI__?: unknown
}
