// 运行环境检测:用于 Android TV 遥控器适配。
// 仅依据 navigator.userAgent / maxTouchPoints,SSR 或无 navigator 时全部安全返回 false。

function ua(): string {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent || ''
}

function maxTouchPoints(): number {
  return typeof navigator === 'undefined' ? 0 : (navigator.maxTouchPoints ?? 0)
}

/** 是否 Android 设备(手机/平板/TV 皆算)。 */
export const isAndroid = /android/i.test(ua())

/**
 * 是否 Android TV / 电视盒子等"无触摸、靠遥控器操作"的设备。
 * 判据:userAgent 含常见 TV 标识(Android TV、Google TV、Amazon Fire TV 的 AFT*、
 * NVIDIA Shield、Sony Bravia 等),或 Android 且报告 0 个触点(TV 普遍无触摸屏)。
 * 用于:① 启用遥控器焦点导航的焦点环与启动自动聚焦;② 游戏内遥控器按键映射层。
 */
export const isTv =
  /\b(tv|googletv|android tv|aft[a-z0-9]*|adt-|bravia|shield)\b/i.test(ua()) ||
  (isAndroid && maxTouchPoints() === 0)
