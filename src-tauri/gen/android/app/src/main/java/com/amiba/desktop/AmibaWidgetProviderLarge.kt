package com.amiba.desktop

// ============================================================
// 变形虫 (Amiba) — 桌面卡片大尺寸档 Provider（4x4）
//
// 纯标记子类：渲染逻辑全部继承 AmibaWidgetProvider，
// 仅用于在 AndroidManifest 注册第三个 AppWidget 入口
// （meta: res/xml/widget_card_info_large.xml），
// 让 Launcher 小组件列表出现独立的"变形虫卡片·大"。
// WidgetConfigActivity 据此 Provider 类名过滤 size=large 的卡片。
//
// 注意: gen/android 会被 `tauri android init` 重置,重置后需重新写入本文件
// ============================================================

class AmibaWidgetProviderLarge : AmibaWidgetProvider()
