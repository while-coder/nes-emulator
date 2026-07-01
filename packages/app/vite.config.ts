import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import legacy from '@vitejs/plugin-legacy'

// Tauri 移动端开发时会注入 TAURI_DEV_HOST（局域网 IP），
// 让 vite 绑定该地址，真机才能访问到 dev server。桌面开发时该变量为空，走 localhost。
const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [
    vue(),
    // 老 WebView（Chrome 74）虽支持 ESM，但缺 ES2020+ 语法与运行时 API。
    // renderModernChunks: false 强制只产出 legacy(SystemJS) 包并按 targets 注入
    // core-js polyfill，让生产包能在盒子上运行（dev 模式此插件不生效）。
    legacy({
      targets: ['chrome >= 74'],
      renderModernChunks: false,
    }),
  ],
  base: './',
  server: {
    host: host || false,
    port: 5181,
    strictPort: true,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 5182,
        }
      : undefined,
  },
  // dev 模式默认 target 为 esnext，不会降级语法；老 WebView（Chrome 74）
  // 不支持可选链等 ES2020 语法，这里让 dev 转译源码/依赖时也降级。
  esbuild: {
    target: 'chrome74',
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'chrome74',
    },
  },
})
