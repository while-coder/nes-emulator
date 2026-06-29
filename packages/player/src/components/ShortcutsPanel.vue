<script setup lang="ts">
/**
 * 快捷键速查面板:集中展示应用级快捷键、手柄空闲键与各玩家的游戏按键映射。
 *
 * 应用级/手柄快捷键当前硬编码在 NesScreen.vue 的 onKeyDown / detectSystemPadButtons
 * 里(不可配置),故此处静态列出;改动那边的键位时需同步本表。游戏按键则从 settings
 * 实时读取,改键后自动同步。
 */
import { computed } from 'vue'
import { PAD_BUTTON_LIST, PLAYER_LABELS, codeLabel, settings } from '../emulator/settings'

const props = defineProps<{ open: boolean; modifier?: 'ctrl' | 'shift' }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

function close() {
  emit('update:open', false)
}
function onOverlayKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

// 应用级快捷键(键盘):与 NesScreen.onKeyDown 保持一致。
const mod = computed(() => (props.modifier === 'ctrl' ? 'Ctrl' : 'Shift'))
const KEYBOARD_SHORTCUTS = computed(() => [
  { keys: `${mod.value}+S`, desc: '快速存档(单槽,按游戏绑定)' },
  { keys: `${mod.value}+L`, desc: '快速读档' },
  { keys: `${mod.value}+N`, desc: '新建存档(追加到存档列表)' },
  { keys: `${mod.value}+G`, desc: '打开游戏库' },
  { keys: `${mod.value}+F`, desc: '全屏' },
  { keys: `${mod.value}+P / Esc`, desc: '暂停 / 继续' },
])

// 手柄空闲肩键快捷键:与 NesScreen.detectSystemPadButtons 保持一致。
const GAMEPAD_SHORTCUTS = [
  { keys: 'LB(左肩键)', desc: '暂停 / 继续' },
  { keys: 'RB(右肩键)', desc: '打开游戏库' },
]
</script>

<template>
  <div v-if="open" class="overlay" tabindex="-1" @click.self="close" @keydown="onOverlayKey">
    <div class="panel" role="dialog" aria-label="快捷键">
      <header class="panel-head">
        <h2>快捷键</h2>
        <button class="x" @click="close">✕</button>
      </header>

      <section class="body">
        <h3 class="group">键盘快捷键</h3>
        <div v-for="s in KEYBOARD_SHORTCUTS" :key="s.keys" class="row">
          <kbd>{{ s.keys }}</kbd>
          <span class="desc">{{ s.desc }}</span>
        </div>

        <h3 class="group">手柄快捷键(游戏未占用的肩键)</h3>
        <div v-for="s in GAMEPAD_SHORTCUTS" :key="s.keys" class="row">
          <kbd>{{ s.keys }}</kbd>
          <span class="desc">{{ s.desc }}</span>
        </div>

        <template v-for="(label, pi) in PLAYER_LABELS" :key="pi">
          <h3 class="group">{{ label }} 游戏按键</h3>
          <div v-for="item in PAD_BUTTON_LIST" :key="item.btn" class="row">
            <span class="desc">{{ item.label }}</span>
            <kbd>{{ codeLabel(settings.players[pi].keymap[item.btn]) }}</kbd>
          </div>
        </template>

        <p class="tip">游戏按键可在「设置 → 按键」中修改。</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.panel {
  width: 420px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  background: #2a2a2a;
  border: 1px solid #3a3a3a;
  border-radius: 10px;
  overflow: hidden;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #3a3a3a;
}
.panel-head h2 {
  margin: 0;
  font-size: 16px;
}
.x {
  border: none;
  background: transparent;
  color: #aaa;
  font-size: 16px;
  cursor: pointer;
}
.x:hover {
  color: #fff;
}
.body {
  padding: 12px 16px 16px;
  overflow-y: auto;
}
.group {
  margin: 16px 0 8px;
  font-size: 13px;
  color: #9a9a9a;
  font-weight: 600;
}
.group:first-child {
  margin-top: 0;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid #333;
  font-size: 14px;
}
.desc {
  color: #ddd;
}
kbd {
  flex-shrink: 0;
  background: #3b3b3b;
  border: 1px solid #4a4a4a;
  border-radius: 5px;
  padding: 2px 8px;
  font-family: ui-monospace, 'Cascadia Code', monospace;
  font-size: 13px;
  color: #eee;
}
.tip {
  margin: 16px 0 0;
  font-size: 12px;
  color: #888;
}
</style>
