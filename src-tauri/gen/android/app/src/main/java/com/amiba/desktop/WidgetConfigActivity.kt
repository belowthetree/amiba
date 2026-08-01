package com.amiba.desktop

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.ListView
import android.widget.TextView
import org.json.JSONArray

// ============================================================
// 变形虫 (Amiba) — 桌面卡片配置页
//
// 用户把小组件拖上桌面时由系统启动（widget_card_info*.xml 的
// android:configure）。三个尺寸档位（小2x2/中4x2/大4x4）共用本页：
// 由 appWidgetId 反查 Provider 类名确定尺寸，只列出同尺寸的启用卡片，
// 用户选择后绑定 appWidgetId → cardKey 并刷新渲染。
//
// 注意: gen/android 会被 `tauri android init` 重置,重置后需重新写入本文件
// ============================================================

class WidgetConfigActivity : Activity() {

  private var appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // 默认取消：用户未选卡直接退出时不放置 widget
    setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId))

    appWidgetId = intent.getIntExtra(
      AppWidgetManager.EXTRA_APPWIDGET_ID,
      AppWidgetManager.INVALID_APPWIDGET_ID
    )
    if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
      finish()
      return
    }

    setContentView(R.layout.widget_config)

    // 由 appWidgetId 反查本实例属于哪个尺寸档位的 Provider，
    // 选卡列表只显示同尺寸卡片（size 缺省按 medium 兼容旧卡片）
    val mgr = AppWidgetManager.getInstance(this)
    val providerClass = mgr.getAppWidgetInfo(appWidgetId)?.provider?.className ?: ""
    val size = when {
      providerClass.contains("Small") -> "small"
      providerClass.contains("Large") -> "large"
      else -> "medium"
    }
    val sizeLabel = when (size) {
      "small" -> "小尺寸（2x2）"
      "large" -> "大尺寸（4x4）"
      else -> "中尺寸（4x2）"
    }

    val prefs = getSharedPreferences(AmibaWidgetProvider.PREFS, Context.MODE_PRIVATE)
    val arr = JSONArray(prefs.getString(AmibaWidgetProvider.KEY_CARDS, "[]") ?: "[]")

    val list = findViewById<ListView>(R.id.config_list)
    val empty = findViewById<TextView>(R.id.config_empty)

    val keys = ArrayList<String>(arr.length())
    val items = ArrayList<String>(arr.length())
    for (i in 0 until arr.length()) {
      val c = arr.optJSONObject(i) ?: continue
      if (c.optString("size", "medium") != size) continue
      keys.add(c.optString("key"))
      val label = c.optString("label", c.optString("key"))
      val service = c.optString("serviceName", c.optString("serviceId"))
      val desc = c.optString("description", "")
      items.add("$label  ·  $service" + if (desc.isNotEmpty()) "\n$desc" else "")
    }

    if (keys.isEmpty()) {
      list.visibility = View.GONE
      empty.text = "暂无${sizeLabel}卡片\n请先在变形虫 App 中创建并启用该尺寸的桌面卡片"
      empty.visibility = View.VISIBLE
      android.util.Log.i("[amiba-widget]", "配置页：无可用卡片 (size=$size, 共${arr.length()}张)")
      return
    }
    android.util.Log.i("[amiba-widget]", "配置页：size=$size，可选 ${keys.size}/${arr.length()} 张")

    list.adapter = ArrayAdapter(this, android.R.layout.simple_list_item_1, items)
    list.onItemClickListener = AdapterView.OnItemClickListener { _, _, position, _ ->
      val key = keys[position]
      prefs.edit()
        .putString(AmibaWidgetProvider.instanceKey(appWidgetId), key)
        .apply()
      android.util.Log.i("[amiba-widget]", "=== 绑定 widget 实例: id=$appWidgetId → $key ===")

      val mgr = AppWidgetManager.getInstance(this)
      AmibaWidgetProvider.updateOne(this, mgr, appWidgetId)

      setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId))
      finish()
    }
  }
}
