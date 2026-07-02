import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'

// ===== 游戏运行时自动隐藏顶部工具栏(沉浸式),需要时再唤出 =====
// active 为真(通常 = 已载入且未暂停)时进入自动隐藏模式:默认收起,
// 鼠标移到屏幕顶部区域滑出、离开自动收起(像视频播放器);触屏点顶部热区切换。
// active 为假(未载入 / 暂停 / 遥控暂停)时工具栏恒显示——TV 无鼠标无触屏,靠暂停调出。

export interface AutoHideToolbarApi {
  /** 工具栏当前是否应显示 */
  visible: Ref<boolean>
  /** 绑到根容器 mousemove:据指针纵向位置控制顶部滑出/收起 */
  handlePointerMove: (e: MouseEvent) => void
  /** 触屏顶部热区点击:切换显示,唤出后定时自动收起 */
  toggle: () => void
}

export function useAutoHideToolbar(
  active: Ref<boolean>,
  opts?: { zone?: number; timeout?: number },
): AutoHideToolbarApi {
  const zone = opts?.zone ?? 64 // 顶部感应区高度(px),略大于工具栏本身,便于指针停留
  const timeout = opts?.timeout ?? 3000 // 触屏唤出后自动收起延时(ms)
  const revealed = ref(false)
  let hideTimer = 0

  // 非自动隐藏模式恒显示;否则由交互控制。
  const visible = computed(() => !active.value || revealed.value)

  function clearTimer(): void {
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = 0
    }
  }

  function handlePointerMove(e: MouseEvent): void {
    if (!active.value) return
    if (e.clientY <= zone) {
      // 指针在顶部:滑出并保持(清掉触屏的自动收起)。
      revealed.value = true
      clearTimer()
    } else if (revealed.value) {
      // 指针离开顶部:收起。
      revealed.value = false
      clearTimer()
    }
  }

  function toggle(): void {
    clearTimer()
    revealed.value = !revealed.value
    // 触屏无 mousemove 收起,唤出后定时自动隐藏。
    if (revealed.value) {
      hideTimer = window.setTimeout(() => {
        revealed.value = false
        hideTimer = 0
      }, timeout)
    }
  }

  // 退出自动隐藏模式(暂停/停止)时复位,避免残留 revealed 状态。
  watch(active, (v) => {
    if (!v) {
      revealed.value = false
      clearTimer()
    }
  })

  onBeforeUnmount(clearTimer)

  return { visible, handlePointerMove, toggle }
}
