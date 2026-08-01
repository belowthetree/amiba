package com.amiba.desktop

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject

// ============================================================
// 变形虫 (Amiba) — 系统桌面卡片（AppWidget）
//
// AmibaWidgetProvider: Launcher 小组件 Provider，按
//   SharedPreferences 中 appWidgetId → cardKey 绑定渲染 RemoteViews。
// WidgetHelper: 供 Rust JNI 调用，接收前端推送的全部启用卡片 JSON，
//   存 SharedPreferences 并刷新全部 widget 实例。
//
// 卡片 JSON（前端 desktop-widget-store.ts 推送，数组元素）：
//   key / serviceId / label / description / size(small|medium|large)
//   layout(lines|image|bigText) / tapPath
//   样式: accentColor(标题色) / textColor(正文色) / backgroundColor(背景色，可带 alpha) / hideTitleBar
//   内容: title / icon / lines[] / image(绝对路径) / footer / updatedAt
//
// 尺寸档位：small(2x2) / medium(4x2, 本类) / large(4x4) 三个 Provider
//   分别注册（尺寸只能在 meta XML 声明），选卡页按 Provider 过滤同尺寸卡片。
//
// 注意: gen/android 会被 `tauri android init` 重置,重置后需重新写入本文件
// ============================================================

// open：small/large 尺寸档位以纯标记子类继承（见 AmibaWidgetProviderSmall/Large）
open class AmibaWidgetProvider : AppWidgetProvider() {

  override fun onUpdate(context: Context, mgr: AppWidgetManager, ids: IntArray) {
    for (id in ids) {
      try {
        updateOne(context, mgr, id)
      } catch (e: Exception) {
        android.util.Log.w("[amiba-widget]", "onUpdate id=$id 失败: ${e.message}")
      }
    }
  }

  companion object {
    const val PREFS = "amiba_widget"
    const val KEY_CARDS = "cards"
    const val KEY_PENDING_TAP = "pending_tap_path"
    private const val MAX_LINES = 6

    fun instanceKey(appWidgetId: Int) = "instance_$appWidgetId"

    /** 读取卡片数组中的指定卡片（按 key） */
    fun findCard(prefs: android.content.SharedPreferences, key: String): JSONObject? {
      val arr = JSONArray(prefs.getString(KEY_CARDS, "[]") ?: "[]")
      for (i in 0 until arr.length()) {
        val c = arr.optJSONObject(i) ?: continue
        if (c.optString("key") == key) return c
      }
      return null
    }

    /** 渲染单个 widget 实例 */
    fun updateOne(context: Context, mgr: AppWidgetManager, appWidgetId: Int) {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val cardKey = prefs.getString(instanceKey(appWidgetId), null)
      val card = cardKey?.let { findCard(prefs, it) }
      val views = buildViews(context, appWidgetId, card)
      mgr.updateAppWidget(appWidgetId, views)
    }

    private fun buildViews(context: Context, appWidgetId: Int, card: JSONObject?): RemoteViews {
      val layout = card?.optString("layout", "lines") ?: "lines"
      val layoutId = when (layout) {
        "image" -> R.layout.widget_card_image
        "bigText" -> R.layout.widget_card_bigtext
        else -> R.layout.widget_card
      }
      val views = RemoteViews(context.packageName, layoutId)

      // ---- 样式字段（widget.json 静态配置，publish 可覆盖）：背景色/隐藏标题栏/正文颜色 ----
      val bg = card?.optString("backgroundColor", "") ?: ""
      if (bg.isNotEmpty()) {
        val bmp = buildBgBitmap(bg)
        if (bmp != null) {
          views.setViewVisibility(R.id.widget_bg_img, View.VISIBLE)
          views.setImageViewBitmap(R.id.widget_bg_img, bmp)
        }
      }
      if (card?.optBoolean("hideTitleBar", false) == true) {
        views.setViewVisibility(R.id.widget_titlebar, View.GONE)
      }
      val bodyColor = card?.optString("textColor", "") ?: ""
      if (bodyColor.isNotEmpty()) {
        try {
          val c = android.graphics.Color.parseColor(bodyColor)
          for (i in 0 until MAX_LINES) views.setTextColor(lineId(i), c)
          if (layout == "bigText") views.setTextColor(R.id.widget_bigtext, c)
        } catch (_: IllegalArgumentException) {}
      }

      if (card == null) {
        // 无绑定或无数据：显示占位
        views.setTextViewText(R.id.widget_title, "变形虫")
        views.setViewVisibility(R.id.widget_icon, View.GONE)
        setLine(views, 0, "请先在 App 中启用桌面卡片")
        for (i in 1 until MAX_LINES) views.setViewVisibility(lineId(i), View.GONE)
        views.setViewVisibility(R.id.widget_footer, View.GONE)
      } else {
        val icon = card.optString("icon", "")
        if (icon.isEmpty()) {
          views.setViewVisibility(R.id.widget_icon, View.GONE)
        } else {
          views.setViewVisibility(R.id.widget_icon, View.VISIBLE)
          views.setTextViewText(R.id.widget_icon, icon)
        }
        views.setTextViewText(R.id.widget_title, card.optString("title", card.optString("label", "")))

        val accent = card.optString("accentColor", "")
        if (accent.isNotEmpty()) {
          try {
            views.setTextColor(R.id.widget_title, android.graphics.Color.parseColor(accent))
          } catch (_: IllegalArgumentException) {}
        }

        when (layout) {
          "image" -> {
            val path = card.optString("image", "")
            // 720：兼顾 renderHtml 渲染卡面的文字清晰度与 Binder 传输限制
            val bmp = if (path.isNotEmpty()) decodeScaled(path, 720) else null
            if (bmp != null) {
              views.setViewVisibility(R.id.widget_image, View.VISIBLE)
              views.setImageViewBitmap(R.id.widget_image, bmp)
            } else {
              views.setViewVisibility(R.id.widget_image, View.GONE)
            }
          }
          "bigText" -> {
            val lines = card.optJSONArray("lines")
            views.setTextViewText(R.id.widget_bigtext, lines?.optString(0, "") ?: "")
          }
          else -> {
            val lines = card.optJSONArray("lines")
            val max = card.optInt("maxLines", MAX_LINES).coerceIn(1, MAX_LINES)
            for (i in 0 until MAX_LINES) {
              val text = lines?.optString(i, "") ?: ""
              if (i < max && text.isNotEmpty()) {
                setLine(views, i, text)
              } else {
                views.setViewVisibility(lineId(i), View.GONE)
              }
            }
          }
        }

        val footer = card.optString("footer", "")
        if (footer.isEmpty()) {
          views.setViewVisibility(R.id.widget_footer, View.GONE)
        } else {
          views.setViewVisibility(R.id.widget_footer, View.VISIBLE)
          views.setTextViewText(R.id.widget_footer, footer)
        }
      }

      // 点击卡片 → 打开 MainActivity，附带跳转路径
      val tapPath = card?.optString("tapPath", "") ?: ""
      val intent = Intent(context, MainActivity::class.java).apply {
        action = "com.amiba.desktop.WIDGET_TAP"
        // 每个实例独立 extra，避免 PendingIntent 复用时 extra 混淆
        data = android.net.Uri.parse("amiba://widget/$appWidgetId")
        if (tapPath.isNotEmpty()) putExtra("widget_tap_path", tapPath)
        addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }
      val pi = PendingIntent.getActivity(
        context, appWidgetId, intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      views.setOnClickPendingIntent(R.id.widget_root, pi)
      return views
    }

    private fun lineId(i: Int): Int = when (i) {
      0 -> R.id.widget_line_1
      1 -> R.id.widget_line_2
      2 -> R.id.widget_line_3
      3 -> R.id.widget_line_4
      4 -> R.id.widget_line_5
      else -> R.id.widget_line_6
    }

    private fun setLine(views: RemoteViews, i: Int, text: String) {
      views.setViewVisibility(lineId(i), View.VISIBLE)
      views.setTextViewText(lineId(i), text)
    }

    /**
     * 降采样解码图片。RemoteViews 经 Binder 传输有位图大小限制（~1MB），
     * 按 maxDim 缩放避免 TransactionTooLargeException。
     */
    private fun decodeScaled(path: String, maxDim: Int): Bitmap? {
      return try {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(path, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= maxDim || bounds.outHeight / (sample * 2) >= maxDim) {
          sample *= 2
        }
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        BitmapFactory.decodeFile(path, opts)
      } catch (e: Exception) {
        android.util.Log.w("[amiba-widget]", "图片解码失败 $path: ${e.message}")
        null
      }
    }

    /**
     * 自定义背景色 → 圆角位图（铺 widget_bg_img，fitXY 拉伸）。
     * RemoteViews 只能换资源/纯色背景（丢圆角），故程序内画 GradientDrawable 转位图。
     * 固定 192x192（147KB）控制 Binder 体积，圆角取拉伸后的视觉近似。
     * 支持 #RRGGBB / #AARRGGBB（半透明与默认底色叠加）。
     */
    private fun buildBgBitmap(colorStr: String): Bitmap? {
      return try {
        val color = android.graphics.Color.parseColor(colorStr)
        val w = 192
        val h = 192
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val d = android.graphics.drawable.GradientDrawable()
        d.shape = android.graphics.drawable.GradientDrawable.RECTANGLE
        d.cornerRadius = 28f
        d.setColor(color)
        d.setBounds(0, 0, w, h)
        d.draw(android.graphics.Canvas(bmp))
        bmp
      } catch (e: Exception) {
        android.util.Log.w("[amiba-widget]", "背景色解析失败 $colorStr: ${e.message}")
        null
      }
    }
  }
}

// ============================================================
// WidgetHelper — 供 Rust JNI 调用（见 src-tauri/src/widget.rs）
// ============================================================

object WidgetHelper {

  /**
   * 接收前端推送的全部启用卡片 JSON，持久化并刷新全部 widget 实例。
   * JNI 调用入口：AmibaWidgetProvider 类中的静态方法。
   */
  @JvmStatic
  fun updateCards(json: String) {
    val ctx = MainActivity.instance?.applicationContext
    if (ctx == null) {
      android.util.Log.w("[amiba-widget]", "updateCards: MainActivity 为空，跳过（widget 显示最后缓存）")
      return
    }
    try {
      // 校验 JSON 合法性后再落盘
      JSONArray(json)
      ctx.getSharedPreferences(AmibaWidgetProvider.PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(AmibaWidgetProvider.KEY_CARDS, json)
        .apply()

      val mgr = AppWidgetManager.getInstance(ctx)
      // 三个尺寸档位的 Provider 都要刷新（appWidgetId 全局唯一，各自查实例）
      val providers: List<Class<out AmibaWidgetProvider>> = listOf(
        AmibaWidgetProvider::class.java,
        AmibaWidgetProviderSmall::class.java,
        AmibaWidgetProviderLarge::class.java,
      )
      var total = 0
      for (p in providers) {
        val ids = mgr.getAppWidgetIds(ComponentName(ctx, p))
        for (id in ids) {
          try {
            AmibaWidgetProvider.updateOne(ctx, mgr, id)
            total++
          } catch (e: Exception) {
            android.util.Log.w("[amiba-widget]", "updateCards 刷新 id=$id 失败: ${e.message}")
          }
        }
      }
      if (total == 0) {
        android.util.Log.i("[amiba-widget]", "updateCards ✓ (${json.length}B)，无 widget 实例，仅落盘")
      } else {
        android.util.Log.i("[amiba-widget]", "updateCards ✓ (${json.length}B)，已刷新 $total 个实例")
      }
    } catch (e: Exception) {
      android.util.Log.w("[amiba-widget]", "updateCards 失败: ${e.message}")
    }
  }

  /** 记录一次 widget 点击的跳转路径（App 未就绪时的兜底通道） */
  fun recordTapPath(ctx: Context, path: String) {
    ctx.getSharedPreferences(AmibaWidgetProvider.PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(AmibaWidgetProvider.KEY_PENDING_TAP, path)
      .apply()
  }

  /** 读取并清除待跳转路径。供 Rust JNI 调用（android_widget_consume_tap）。 */
  @JvmStatic
  fun consumeTapPath(): String {
    val ctx = MainActivity.instance?.applicationContext ?: return ""
    val prefs = ctx.getSharedPreferences(AmibaWidgetProvider.PREFS, Context.MODE_PRIVATE)
    val path = prefs.getString(AmibaWidgetProvider.KEY_PENDING_TAP, "") ?: ""
    if (path.isNotEmpty()) {
      prefs.edit().remove(AmibaWidgetProvider.KEY_PENDING_TAP).apply()
      android.util.Log.i("[amiba-widget]", "consumeTapPath: $path")
    }
    return path
  }
}
