import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

// WASM 包由 wasm-pack 输出到 packages/player/src/wasm,Vite 通过 vite-plugin-wasm 直接 import
export default defineConfig({
  plugins: [vue(), wasm(), topLevelAwait()],
  // Tauri 需要固定端口、相对资源路径
  base: './',
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      '/__nes_roms__/': {
        target: 'https://gitee.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__nes_roms__\//, '/qingfeng346/nes-roms/raw/master/'),
      },
    },
  },
  build: {
    target: 'esnext',
  },
})
