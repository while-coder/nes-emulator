import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

// App 前端独立构建,但继续复用 packages/player 输出的 WASM 绑定。
export default defineConfig({
  plugins: [vue(), wasm(), topLevelAwait()],
  base: './',
  server: {
    port: 5181,
    strictPort: true,
  },
  build: {
    target: 'esnext',
  },
})
