package com.amiba.desktop

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.ValueCallback
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.enableEdgeToEdge
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
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
    @Volatile private var appContext: android.content.Context? = null

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
        // 始终保存 ApplicationContext（不依赖 WebView 生命周期）
        appContext = context.applicationContext ?: context
        if (webView != null) return true
        android.util.Log.d("Amiba", "WebViewHelper.init: creating WebView...")
        val ok = runOnMain(5000) {
            if (webView != null) return@runOnMain
            try {
                webView = WebView(context.applicationContext ?: context).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                }
                android.util.Log.d("Amiba", "WebViewHelper.init: WebView created OK")
            } catch (e: Exception) {
                android.util.Log.e("Amiba", "WebViewHelper.init: WebView creation failed", e)
                webView = null // 确保为 null
            }
        }
        val okMsg = if (webView != null) "OK" else "WebView creation failed (may be OK if only using openFile)"
        android.util.Log.d("Amiba", "WebViewHelper.init result: $okMsg")
        // openFile 只需要 appContext，不依赖 WebView，所以即使 WebView 创建失败也不影响安装功能
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
        // 注意：不清理 appContext，以便后续 openFile 仍可使用
    }

    @JvmStatic fun isInitialized(): Boolean = webView != null

    // ---- 文件打开（安装 APK 等） ----
    @JvmStatic fun openFile(path: String, mimeType: String): Boolean {
        android.util.Log.d("Amiba", "openFile called: path=$path mime=$mimeType")
        val ctx = appContext
        if (ctx == null) {
            android.util.Log.e("Amiba", "openFile: appContext not set, call init() first")
            return false
        }
        android.util.Log.d("Amiba", "openFile: got context from appContext (not dependent on WebView)")
        val ok = runOnMain(10000) {
            try {
                val file = java.io.File(path)
                if (!file.exists()) {
                    android.util.Log.e("Amiba", "openFile: file not found: $path")
                    throw java.io.IOException("file not found: $path")
                }
                android.util.Log.d("Amiba", "openFile: file exists, size=${file.length()}")
                val uri = androidx.core.content.FileProvider.getUriForFile(
                    ctx,
                    "${ctx.packageName}.fileprovider",
                    file
                )
                android.util.Log.d("Amiba", "openFile: FileProvider URI: $uri")
                val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, mimeType)
                    addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                    addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                ctx.startActivity(intent)
                android.util.Log.d("Amiba", "openFile: startActivity succeeded")
            } catch (e: java.lang.Exception) {
                android.util.Log.e("Amiba", "openFile: FileProvider failed, trying file:// fallback", e)
                try {
                    val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
                        setDataAndType(android.net.Uri.parse("file://$path"), mimeType)
                        addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    ctx.startActivity(intent)
                    android.util.Log.d("Amiba", "openFile: file:// fallback succeeded")
                } catch (e2: java.lang.Exception) {
                    android.util.Log.e("Amiba", "openFile: both methods failed", e2)
                    throw e2
                }
            }
        }
        android.util.Log.d("Amiba", "openFile: returning $ok")
        return ok
    }
}
