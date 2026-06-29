import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      // 自动注入 Service Worker 注册脚本,无需改 main.ts。
      injectRegister: 'auto',
      // public 下的图标纳入预缓存(它们不被构建引用)。
      includeAssets: ['favicon.png', 'icon-512.png'],
      manifest: {
        name: 'NES/FC 模拟器',
        short_name: 'NES',
        description: 'NES/FC 在线模拟器,支持触屏手柄与存档,可添加到主屏全屏游玩。',
        lang: 'zh-CN',
        display: 'standalone',
        // 不锁定方向,跟随系统(竖屏/横屏皆可)。
        background_color: '#202328',
        theme_color: '#202328',
        // 相对路径,适配 GitHub Pages 子路径部署。
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-512.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
        // jsnes 打包后体积较大,放宽单文件预缓存上限。
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  // GitHub Pages 子路径部署需要相对资源路径。
  base: './',
  server: {
    port: 5180,
    strictPort: true,
  },
  build: {
    target: 'esnext',
  },
})
