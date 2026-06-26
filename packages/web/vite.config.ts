import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // Tauri 需要固定端口、相对资源路径
  base: './',
  server: {
    port: 5180,
    strictPort: true,
  },
  build: {
    target: 'esnext',
  },
})
