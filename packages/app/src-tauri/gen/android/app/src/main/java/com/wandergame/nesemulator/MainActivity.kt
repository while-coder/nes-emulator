package com.wandergame.nesemulator

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // TauriActivity 把 WryActivity 内置的"返回键 → WebView.goBack"关掉了(handleBackNavigation=false),
  // 默认行为变成"finish 当前 Activity",在 Android TV 遥控器/手机上按返回就直接退出 app。
  // 这里重新挂回调:把物理返回交给 JS 层(history.back() → popstate → App.vue 的 handleBack),
  // 由 JS 决定是关面板、停 ROM 还是真正退出。
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        webView.evaluateJavascript("history.back()", null)
      }
    })
  }
}
