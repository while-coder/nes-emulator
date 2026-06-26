import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
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
