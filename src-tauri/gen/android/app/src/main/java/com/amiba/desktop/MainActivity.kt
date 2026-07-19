package com.amiba.desktop

import android.app.Activity
import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.DocumentsContract
import android.provider.Settings
import android.webkit.ValueCallback
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.enableEdgeToEdge
import java.io.BufferedReader
import java.io.InputStreamReader
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class MainActivity : TauriActivity() {
  companion object {
    @Volatile var instance: MainActivity? = null
      private set

    // ============================================================
    // 供 Rust JNI 调用：返回上次 native crash 的 tombstone 内容
    // 无崩溃时返回空字符串
    // ============================================================
    @JvmStatic
    fun getLastTombstone(): String {
      val ctx = instance ?: return ""
      return try {
        val tombFile = java.io.File(ctx.filesDir, "last_tombstone.txt")
        if (tombFile.exists()) tombFile.readText() else ""
      } catch (e: Exception) {
        ""
      }
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    instance = this
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    logPreviousExitReasons()
    ensureStoragePermission()
  }

  override fun onDestroy() {
    super.onDestroy()
    instance = null
  }

  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    FolderPickerHelper.onActivityResult(requestCode, resultCode, data)
  }

  // ============================================================
  // 崩溃诊断：Android 11+ ApplicationExitInfo API
  // 应用启动时查询上次进程退出原因，输出到 logcat。
  // 免权限：只读自己进程的历史退出记录。
  // 注意: gen/android 会被 `tauri android init` 重置,重置后需重新写入本段
  // ============================================================
  private fun logPreviousExitReasons() {
    try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
        android.util.Log.i("[amiba]", "ExitReasons: API < 30, skipped")
        return
      }

      val am = getSystemService(android.content.Context.ACTIVITY_SERVICE) as ActivityManager
      val reasons: List<ApplicationExitInfo> = am.getHistoricalProcessExitReasons(null, 0, 5)

      if (reasons.isEmpty()) {
        android.util.Log.i("[amiba]", "ExitReasons: (first launch or no history)")
        return
      }

      val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
      for ((i, exit) in reasons.withIndex()) {
        val ts = sdf.format(Date(exit.timestamp))
        val reasonName = reasonName(exit.reason)
        val desc = exit.description ?: "(no description)"
        val pid = exit.pid

        android.util.Log.i("[amiba]", buildString {
          append("=== Exit #${i + 1} === pid=$pid reason=$reasonName time=$ts")
        })
        android.util.Log.i("[amiba]", "  description: $desc")
        android.util.Log.i("[amiba]", "  importance: ${exit.importance}, pss: ${formatMem(exit.pss)} " +
          "rss: ${formatMem(exit.rss)}, status: ${exit.status}")

        // Native 崩溃 → 读取 tombstone 堆栈
        if (exit.reason == ApplicationExitInfo.REASON_CRASH_NATIVE) {
          logNativeTombstone(exit)
        }
      }
    } catch (e: Exception) {
      android.util.Log.w("[amiba]", "ExitReasons: query failed: ${e.message}", e)
    }
  }

  private fun reasonName(reason: Int): String = when (reason) {
    ApplicationExitInfo.REASON_ANR -> "ANR"
    ApplicationExitInfo.REASON_CRASH -> "CRASH(Java)"
    ApplicationExitInfo.REASON_CRASH_NATIVE -> "CRASH(Native)"
    ApplicationExitInfo.REASON_LOW_MEMORY -> "LOW_MEMORY(LMK)"
    ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "EXCESSIVE_RESOURCE"
    ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "INIT_FAILURE"
    ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "DEPENDENCY_DIED"
    ApplicationExitInfo.REASON_FREEZER -> "FREEZER"
    ApplicationExitInfo.REASON_SIGNALED -> "SIGNALED"
    ApplicationExitInfo.REASON_USER_REQUESTED -> "USER_REQUESTED"
    ApplicationExitInfo.REASON_USER_STOPPED -> "USER_STOPPED"
    ApplicationExitInfo.REASON_PACKAGE_STATE_CHANGE -> "PACKAGE_STATE_CHANGE"
    ApplicationExitInfo.REASON_PACKAGE_UPDATED -> "PACKAGE_UPDATED"
    ApplicationExitInfo.REASON_OTHER -> "OTHER"
    else -> "UNKNOWN($reason)"
  }

  private fun formatMem(kb: Long): String = when {
    kb <= 0 -> "N/A"
    kb >= 1024 * 1024 -> "${"%.1f".format(kb / (1024.0 * 1024.0))} GB"
    kb >= 1024 -> "${"%.1f".format(kb / 1024.0)} MB"
    else -> "$kb KB"
  }

  private fun logNativeTombstone(exit: ApplicationExitInfo) {
    try {
      val traceStream = exit.traceInputStream ?: run {
        android.util.Log.w("[amiba]", "  tombstone: (no trace available)")
        return
      }
      val reader = BufferedReader(InputStreamReader(traceStream))
      val lines = reader.useLines { it.take(60).toList() } // 前 60 行足够定位
      android.util.Log.i("[amiba]", "  --- tombstone (first ${lines.size} lines) ---")
      for (line in lines) {
        android.util.Log.i("[amiba]", "  $line")
      }
      android.util.Log.i("[amiba]", "  --- end tombstone ---")

      // 写入 filesDir 供前端读取（设置在日志页签展示）
      val content = lines.joinToString("\n")
      val tombFile = java.io.File(filesDir, "last_tombstone.txt")
      tombFile.writeText(content)
      android.util.Log.i("[amiba]", "  tombstone saved to: ${tombFile.absolutePath}")
    } catch (e: Exception) {
      android.util.Log.w("[amiba]", "  tombstone read/write error: ${e.message}")
    }
  }

  // ============================================================
  // 存储权限：fileAccess 扫描共享目录(/storage/emulated/0/...)需要
  // - API < 30 (Android 10-): 运行时请求 READ_EXTERNAL_STORAGE
  // - API >= 30 (Android 11+): Scoped Storage,直接文件路径访问需
  //   MANAGE_EXTERNAL_STORAGE,跳系统设置页由用户手动开启
  // 注意: gen/android 会被 `tauri android init` 重置,重置后需重新写入本段
  // ============================================================
  private fun ensureStoragePermission() {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        if (!Environment.isExternalStorageManager()) {
          android.util.Log.i("[amiba]", "请求所有文件访问权限(MANAGE_EXTERNAL_STORAGE)")
          val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).apply {
            data = Uri.parse("package:$packageName")
          }
          startActivity(intent)
        }
      } else {
        if (checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
          android.util.Log.i("[amiba]", "请求存储权限(READ_EXTERNAL_STORAGE)")
          requestPermissions(arrayOf(android.Manifest.permission.READ_EXTERNAL_STORAGE), 1001)
        }
      }
    } catch (e: Exception) {
      android.util.Log.w("[amiba]", "存储权限请求失败: ${e.message}")
    }
  }
}

// ============================================================
// 变形虫 (Amiba) — JsCallback + WebViewHelper
// ============================================================

class JsCallback : ValueCallback<String> {
    private val lock = Object()
    @Volatile private var result: String? = null
    @Volatile private var done = false

    override fun onReceiveValue(value: String?) {
        synchronized(lock) {
            result = value ?: "null"
            done = true
            lock.notifyAll()
        }
    }

    fun await(timeoutMs: Long): String {
        synchronized(lock) {
            if (!done) {
                try { lock.wait(timeoutMs) } catch (_: InterruptedException) {}
            }
            done = false
            return result ?: "{}"
        }
    }
}

object WebViewHelper {
    private val handler = Handler(Looper.getMainLooper())
    @Volatile private var webView: WebView? = null

    private fun runOnMain(timeoutMs: Long, block: () -> Unit): Boolean {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            block()
            return true
        }
        val latch = CountDownLatch(1)
        var thrown: Exception? = null
        handler.post {
            try {
                block()
            } catch (e: Exception) {
                thrown = e
            } finally {
                latch.countDown()
            }
        }
        val ok = try {
            latch.await(timeoutMs, TimeUnit.MILLISECONDS)
        } catch (_: InterruptedException) { false }
        if (thrown != null) throw RuntimeException(thrown)
        return ok
    }

    @JvmStatic fun init(context: android.content.Context): Boolean {
        if (webView != null) return true
        val ok = runOnMain(5000) {
            if (webView != null) return@runOnMain
            webView = WebView(context.applicationContext ?: context).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
            }
        }
        return ok && webView != null
    }

    @JvmStatic fun loadUrlAndWait(url: String, timeoutMs: Int): Boolean {
        val wv = webView ?: return false
        val lock = Object()
        var loaded = false
        val posted = runOnMain(timeoutMs.toLong()) {
            wv.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    synchronized(lock) { loaded = true; lock.notifyAll() }
                }
            }
            wv.loadUrl(url)
        }
        if (!posted) return false
        synchronized(lock) {
            if (!loaded) {
                try { lock.wait(timeoutMs.toLong()) } catch (_: InterruptedException) {}
            }
        }
        return loaded
    }

    @JvmStatic fun evaluateJavascript(script: String, timeoutMs: Int): String {
        val wv = webView ?: return "{}"
        val callback = JsCallback()
        val posted = runOnMain(timeoutMs.toLong()) {
            wv.evaluateJavascript(script, callback)
        }
        if (!posted) return "{}"
        return callback.await(timeoutMs.toLong())
    }

    @JvmStatic fun close() {
        runOnMain(3000) {
            webView?.destroy()
            webView = null
        }
    }

    @JvmStatic fun isInitialized(): Boolean = webView != null
}

// ============================================================
// 变形虫 (Amiba) — FolderPickerHelper
// ============================================================
// 通过 ACTION_OPEN_DOCUMENT_TREE 让用户在移动端选取文件夹。
// Rust JNI 线程调用 pickFolder() → 主线程启动 Intent →
// onActivityResult 回调 → 解析 content:// URI → 返回实际路径。
//
// 防御性设计：
//   - Activity 为 null / finishing 时立即返回空（不阻塞）
//   - 启动 Intent 失败时 catch 并通知等待线程
//   - resolveDocumentPath 失败时保留 content:// URI 作为 fallback
// ============================================================

object FolderPickerHelper {
    private const val REQUEST_CODE = 9001
    private val handler = Handler(Looper.getMainLooper())
    @Volatile private var resultPath: String? = null
    @Volatile private var hasResult = false
    private val lock = Object()

    @JvmStatic
    fun pickFolder(timeoutMs: Long): String {
        val activity = MainActivity.instance
        if (activity == null) {
            android.util.Log.w("[amiba]", "FolderPicker: no Activity instance")
            return ""
        }
        if (activity.isFinishing || activity.isDestroyed) {
            android.util.Log.w("[amiba]", "FolderPicker: Activity is finishing/destroyed")
            return ""
        }

        resultPath = null
        hasResult = false

        val posted = handler.post {
            try {
                android.util.Log.i("[amiba]", "FolderPicker: launching ACTION_OPEN_DOCUMENT_TREE...")
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                    addFlags(
                        Intent.FLAG_GRANT_READ_URI_PERMISSION or
                        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                    )
                }
                activity.startActivityForResult(intent, REQUEST_CODE)
            } catch (e: Exception) {
                android.util.Log.e("[amiba]", "FolderPicker start error: ${e.message}", e)
                synchronized(lock) {
                    hasResult = true
                    lock.notify()
                }
            }
        }

        if (!posted) {
            android.util.Log.e("[amiba]", "FolderPicker: handler.post failed (looper not ready?)")
            return ""
        }

        synchronized(lock) {
            if (!hasResult) {
                try {
                    lock.wait(timeoutMs)
                } catch (_: InterruptedException) {
                    android.util.Log.w("[amiba]", "FolderPicker: wait interrupted")
                }
            }
        }

        val path = resultPath ?: ""
        android.util.Log.i("[amiba]", "FolderPicker result: ${path.ifEmpty { "(cancelled/empty)" }}")
        return path
    }

    fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_CODE) return

        android.util.Log.i("[amiba]", "FolderPicker onActivityResult: resultCode=$resultCode, data=${data?.data}")

        if (resultCode == Activity.RESULT_OK && data?.data != null) {
            val uri = data.data!!

            // 持久化读取权限（跨进程重启保留）
            try {
                val activity = MainActivity.instance
                val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION
                activity?.contentResolver?.takePersistableUriPermission(uri, flags)
                android.util.Log.i("[amiba]", "FolderPicker persistable permission granted for: $uri")
            } catch (e: Exception) {
                android.util.Log.w("[amiba]", "FolderPicker takePersistableUriPermission failed: ${e.message}")
            }

            val resolved = resolveDocumentPath(uri)
            if (resolved != null) {
                android.util.Log.i("[amiba]", "FolderPicker resolved: $uri → $resolved")
                resultPath = resolved
            } else {
                // 无法转换为文件路径，保留 content:// URI
                android.util.Log.w("[amiba]", "FolderPicker cannot resolve to file path, using URI: $uri")
                resultPath = uri.toString()
            }
        } else {
            android.util.Log.i("[amiba]", "FolderPicker: user cancelled or no data (resultCode=$resultCode)")
            // resultPath 保持 null，pickFolder 返回空字符串
        }

        synchronized(lock) {
            hasResult = true
            lock.notify()
        }
    }

    /**
     * 将 content:// 树形 URI 转换为实际文件系统路径。
     * 格式: content://com.android.externalstorage.documents/tree/primary%3ADownload
     * documentId: primary:Download  →  /storage/emulated/0/Download
     * documentId: ABCD-1234:Music  →  /storage/ABCD-1234/Music
     */
    private fun resolveDocumentPath(uri: Uri): String? {
        if (uri.scheme != "content") return uri.path

        try {
            val docId = DocumentsContract.getTreeDocumentId(uri)
            val split = docId.split(":", limit = 2)
            if (split.size < 2) {
                android.util.Log.w("[amiba]", "resolveDocumentPath: unexpected docId format: $docId")
                return null
            }

            val type = split[0]
            val path = split[1]

            if (type == "primary") {
                val extDir = Environment.getExternalStorageDirectory()
                if (extDir == null) {
                    android.util.Log.w("[amiba]", "resolveDocumentPath: getExternalStorageDirectory returned null")
                    return null
                }
                return "${extDir.absolutePath}/$path"
            }

            // SD 卡等外部存储
            return "/storage/$type/$path"
        } catch (e: Exception) {
            android.util.Log.w("[amiba]", "resolveDocumentPath failed: ${e.message}", e)
            return null
        }
    }
}
