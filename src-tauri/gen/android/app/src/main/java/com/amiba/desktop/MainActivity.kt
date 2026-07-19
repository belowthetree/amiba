package com.amiba.desktop

import android.app.Activity
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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class MainActivity : TauriActivity() {
  companion object {
    @Volatile var instance: MainActivity? = null
      private set
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    instance = this
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
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

        resultPath = null
        hasResult = false

        handler.post {
            try {
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                    addFlags(
                        Intent.FLAG_GRANT_READ_URI_PERMISSION or
                        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                    )
                }
                activity.startActivityForResult(intent, REQUEST_CODE)
            } catch (e: Exception) {
                android.util.Log.e("[amiba]", "FolderPicker start error: ${e.message}")
                synchronized(lock) {
                    hasResult = true
                    lock.notifyAll()
                }
            }
        }

        synchronized(lock) {
            if (!hasResult) {
                try {
                    lock.wait(timeoutMs)
                } catch (_: InterruptedException) {}
            }
        }

        val path = resultPath ?: ""
        android.util.Log.i("[amiba]", "FolderPicker result: ${path.ifEmpty { "(cancelled)" }}")
        return path
    }

    fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_CODE) return

        if (resultCode == Activity.RESULT_OK && data?.data != null) {
            val uri = data.data!!

            // 持久化读取权限
            try {
                val activity = MainActivity.instance
                activity?.contentResolver?.takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            } catch (_: Exception) {}

            val resolved = resolveDocumentPath(uri)
            if (resolved != null) {
                android.util.Log.i("[amiba]", "FolderPicker resolved: $uri → $resolved")
                resultPath = resolved
            } else {
                // 无法转换为文件路径，保留 content:// URI
                android.util.Log.w("[amiba]", "FolderPicker cannot resolve to path, using URI: $uri")
                resultPath = uri.toString()
            }
        }

        synchronized(lock) {
            hasResult = true
            lock.notifyAll()
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
            if (split.size < 2) return null

            val type = split[0]
            val path = split[1]

            if (type == "primary") {
                return "${Environment.getExternalStorageDirectory().absolutePath}/$path"
            }

            // SD 卡等外部存储
            return "/storage/$type/$path"
        } catch (e: Exception) {
            android.util.Log.w("[amiba]", "resolveDocumentPath failed: ${e.message}")
            return null
        }
    }
}
