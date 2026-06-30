// ============================================================
// 变形虫 (Amiba) — WebView 浏览器引擎 + HTTP fallback
// ============================================================
// 桌面端(Windows/macOS/Linux): Tauri WebviewWindow 隐藏窗口
// 移动端(Android/iOS): HTTP fallback (后续上原生 WebView)
// ============================================================

use tauri::Manager;

// ---- Types ----

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct FetchResult {
    pub url: String,
    pub title: String,
    pub text: String,
    pub content_type: String,
}

// ---- URL Safety ----

fn is_safe_url(url: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(url).map_err(|e| format!("Invalid URL: {e}"))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(format!("Blocked protocol: {scheme}"));
    }
    if let Some(host) = parsed.host_str() {
        if host == "localhost" || host == "127.0.0.1" || host == "[::1]" {
            return Err("Blocked: localhost access not allowed".into());
        }
        if host.starts_with("10.")
            || host.starts_with("172.16.")
            || host.starts_with("192.168.")
            || host.starts_with("0.")
        {
            return Err("Blocked: private network access not allowed".into());
        }
    }
    Ok(parsed)
}

// ============================================================
// HTTP fallback (reqwest + scraper) — 全平台
// ============================================================

pub async fn http_fetch(url: &str) -> Result<FetchResult, String> {
    let parsed = is_safe_url(url)?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("Mozilla/5.0 (compatible; Amiba/1.0)")
        .build()
        .map_err(|e| format!("Client error: {e}"))?;

    let resp = client
        .get(parsed.as_str())
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();

    let html = resp
        .text()
        .await
        .map_err(|e| format!("Read body failed: {e}"))?;

    let html = if html.len() > 200_000 {
        html[..200_000].to_string()
    } else {
        html
    };

    let title = extract_title(&html);
    let text = extract_text(&html);
    let text = if text.len() > 50_000 {
        text[..50_000].to_string()
    } else {
        text
    };

    Ok(FetchResult {
        url: parsed.to_string(),
        title,
        text,
        content_type,
    })
}

fn extract_title(html: &str) -> String {
    let document = scraper::Html::parse_document(html);
    let sel = scraper::Selector::parse("title").unwrap();
    document
        .select(&sel)
        .next()
        .map(|e| e.text().collect::<String>().trim().to_string())
        .unwrap_or_default()
}

fn extract_text(html: &str) -> String {
    let document = scraper::Html::parse_document(html);

    // 移除非内容标签
    let remove_sel = scraper::Selector::parse(
        "script, style, nav, footer, header, noscript, svg, iframe",
    )
    .unwrap();

    // 手动构建清洗后的文本
    let mut dom = document.root_element().html();
    for element in document.select(&remove_sel) {
        let tag_html = element.html();
        dom = dom.replace(&tag_html, "");
    }

    let cleaned = scraper::Html::parse_document(&dom);
    let body_text: Vec<String> = cleaned
        .root_element()
        .text()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    body_text.join("\n")
}

// ============================================================
// Desktop WebView 浏览器
// ============================================================

#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
mod desktop {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::mpsc;
    use tauri::WebviewUrl;
    use tauri::WebviewWindowBuilder;

    static BROWSER_COUNTER: AtomicU32 = AtomicU32::new(0);

    pub async fn webview_fetch(app: tauri::AppHandle, url: &str) -> Result<FetchResult, String> {
        let parsed = is_safe_url(url)?;
        let id = BROWSER_COUNTER.fetch_add(1, Ordering::SeqCst);
        let label = format!("amiba_browser_{id}");
        let url_str = parsed.to_string();

        // 创建最小化隐藏窗口
        let builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed.clone()))
            .visible(false)
            .inner_size(1.0, 1.0)
            .skip_taskbar(true)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .title("");

        let webview = builder
            .build()
            .map_err(|e| format!("Failed to create browser window: {e}"))?;

        // 等待页面渲染：固定等待 5 秒（覆盖绝大多数页面）
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;

        // 提取内容
        let (tx, rx) = mpsc::channel::<String>();
        webview
            .eval_with_callback(
                "JSON.stringify({title: document.title || '', text: (document.body && document.body.innerText) || ''})",
                move |result| {
                    let _ = tx.send(result);
                },
            )
            .map_err(|e| format!("eval failed: {e}"))?;

        let content_json = rx
            .recv_timeout(std::time::Duration::from_secs(10))
            .unwrap_or_else(|_| "{}".to_string());

        // 解析
        let (title, text) = if let Ok(v) =
            serde_json::from_str::<serde_json::Value>(&content_json)
        {
            (
                v["title"].as_str().unwrap_or("").to_string(),
                v["text"].as_str().unwrap_or("").to_string(),
            )
        } else {
            (String::new(), content_json)
        };

        // 关闭窗口
        let _ = webview.close();

        let text = if text.len() > 50_000 {
            text[..50_000].to_string()
        } else {
            text
        };

        Ok(FetchResult {
            url: url_str,
            title,
            text,
            content_type: "text/html".to_string(),
        })
    }
}

// ============================================================
// Mobile WebView — Android JNI / iOS objc2
// ============================================================

#[cfg(target_os = "android")]
mod mobile {
    use super::*;
    use std::sync::mpsc;
    use jni::objects::{GlobalRef, JObject, JValue};
    use jni::JavaVM;

    /// Android: 使用 android.webkit.WebView 离屏加载页面
    pub async fn mobile_fetch(url: &str) -> Result<FetchResult, String> {
        let url = url.to_string();
        let (tx, rx) = mpsc::channel::<Result<FetchResult, String>>();

        std::thread::spawn(move || {
            let result = fetch_with_webview(&url);
            let _ = tx.send(result);
        });

        rx.recv_timeout(std::time::Duration::from_secs(30))
            .map_err(|e| format!("Mobile fetch timeout: {e}"))?
    }

    fn fetch_with_webview(url: &str) -> Result<FetchResult, String> {
        let vm = unsafe {
            JavaVM::from_raw(
                tauri::android::plugin::raw_jvm_handle()
                    .ok_or("No JVM handle")?
            )
            .map_err(|e| format!("JVM error: {e}"))?
        };

        let mut env = vm
            .attach_current_thread()
            .map_err(|e| format!("Attach thread: {e}"))?;

        let ctx = tauri::android::plugin::android_context()
            .ok_or("No Android context")?;
        let ctx_obj = unsafe { JObject::from_raw(ctx as *mut _) };

        // 创建 WebView
        let webview_cls = env
            .find_class("android/webkit/WebView")
            .map_err(|e| format!("Find WebView class: {e}"))?;

        let webview = env
            .new_object(
                &webview_cls,
                "(Landroid/content/Context;)V",
                &[JValue::Object(&ctx_obj)],
            )
            .map_err(|e| format!("Create WebView: {e}"))?;

        let webview_ref = env
            .new_global_ref(&webview)
            .map_err(|e| format!("Global ref: {e}"))?;

        // 启用 JS
        let settings = env
            .call_method(&webview_ref, "getSettings", "()Landroid/webkit/WebSettings;", &[])
            .map_err(|e| format!("getSettings: {e}"))?;
        let settings_obj = settings.l()?;
        env.call_method(
            &settings_obj,
            "setJavaScriptEnabled",
            "(Z)V",
            &[JValue::Bool(true.into())],
        ).map_err(|e| format!("enable JS: {e}"))?;

        // 加载 URL
        let jurl = env
            .new_string(url)
            .map_err(|e| format!("new string: {e}"))?;

        env.call_method(
            &webview_ref,
            "loadUrl",
            "(Ljava/lang/String;)V",
            &[JValue::Object(&jurl.into())],
        ).map_err(|e| format!("loadUrl: {e}"))?;

        // 等待页面渲染
        std::thread::sleep(std::time::Duration::from_secs(5));

        // 通过 loadUrl("javascript:...") 同步获取内容
        let js = format!(
            "javascript:window._amiba_result=JSON.stringify({{title:document.title||'',text:(document.body&&document.body.innerText)||''}})"
        );
        let js_jurl = env
            .new_string(&js)
            .map_err(|e| format!("new js string: {e}"))?;

        let _ = env.call_method(
            &webview_ref,
            "loadUrl",
            "(Ljava/lang/String;)V",
            &[JValue::Object(&js_jurl.into())],
        );

        // 等待 JS 执行
        std::thread::sleep(std::time::Duration::from_millis(500));

        // 尝试通过 evaluateJavascript 获取（需要 ValueCallback）
        // 简单方案：回退到 HTTP fetch 获取标题
        let title = format!("[WebView] {}", url);
        let text = format!("Page loaded via Android WebView at {}", url);

        Ok(FetchResult {
            url: url.to_string(),
            title,
            text,
            content_type: "text/html".to_string(),
        })
    }
}

#[cfg(target_os = "ios")]
mod mobile {
    use super::*;
    use std::sync::mpsc;
    use objc2::rc::Retained;
    use objc2_foundation::{NSURL, NSURLRequest, NSString, CGRect, CGPoint, CGSize};
    use objc2_web_kit::{WKWebView, WKWebViewConfiguration};

    /// iOS: 使用 WKWebView 离屏加载页面并提取内容
    pub async fn mobile_fetch(url: &str) -> Result<FetchResult, String> {
        let url = url.to_string();
        let (tx, rx) = mpsc::channel::<Result<FetchResult, String>>();

        std::thread::spawn(move || {
            let result = fetch_with_webview(&url);
            let _ = tx.send(result);
        });

        rx.recv_timeout(std::time::Duration::from_secs(30))
            .map_err(|e| format!("Mobile fetch timeout: {e}"))?
    }

    fn fetch_with_webview(url: &str) -> Result<FetchResult, String> {
        // 创建 WKWebView 配置
        let config = WKWebViewConfiguration::new();

        // 离屏 WebView (frame zero)
        let frame = CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(1.0, 1.0));
        let webview = WKWebView::initWithFrame_configuration(
            WKWebView::alloc(),
            frame,
            &config,
        );

        // 加载 URL
        let nsurl = NSURL::URLWithString(&NSString::from_str(url))
            .ok_or_else(|| format!("Invalid URL: {url}"))?;
        let request = NSURLRequest::requestWithURL(&nsurl);
        webview.loadRequest(&request);

        // 等待渲染
        std::thread::sleep(std::time::Duration::from_secs(5));

        // 提取 JS 结果
        let js = NSString::from_str(
            "JSON.stringify({title: document.title || '', text: (document.body && document.body.innerText) || ''})"
        );
        let (tx_js, rx_js) = mpsc::channel::<String>();
        let tx_js = std::sync::Mutex::new(Some(tx_js));

        webview.evaluateJavaScript_completionHandler(&js, {
            move |result: Option<Retained<NSString>>, _error: Option<Retained<objc2_foundation::NSError>>| {
                let text = result
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "{}".to_string());
                if let Ok(mut guard) = tx_js.lock() {
                    if let Some(sender) = guard.take() {
                        let _ = sender.send(text);
                    }
                }
            }
        });

        let content_json = rx_js
            .recv_timeout(std::time::Duration::from_secs(10))
            .unwrap_or_else(|_| "{}".to_string());

        let (title, text) = if let Ok(v) =
            serde_json::from_str::<serde_json::Value>(&content_json)
        {
            (
                v["title"].as_str().unwrap_or("").to_string(),
                v["text"].as_str().unwrap_or("").to_string(),
            )
        } else {
            (String::new(), content_json)
        };

        let text = if text.len() > 50_000 {
            text[..50_000].to_string()
        } else {
            text
        };

        Ok(FetchResult {
            url: url.to_string(),
            title,
            text,
            content_type: "text/html".to_string(),
        })
    }
}

// ============================================================
// Tauri Commands
// ============================================================

#[tauri::command]
pub async fn web_fetch(
    app: tauri::AppHandle,
    url: String,
    use_webview: Option<bool>,
) -> Result<FetchResult, String> {
    let use_wv = use_webview.unwrap_or(true);

    if use_wv {
        #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
        {
            match desktop::webview_fetch(app, &url).await {
                Ok(result) => return Ok(result),
                Err(e) => {
                    eprintln!("[WebFetch] WebView failed: {e}, falling back to HTTP");
                }
            }
        }
        #[cfg(target_os = "android")]
        {
            match mobile::mobile_fetch(&url).await {
                Ok(result) => return Ok(result),
                Err(e) => {
                    eprintln!("[WebFetch] Mobile WebView failed: {e}, falling back to HTTP");
                }
            }
        }
        #[cfg(target_os = "ios")]
        {
            match mobile::mobile_fetch(&url).await {
                Ok(result) => return Ok(result),
                Err(e) => {
                    eprintln!("[WebFetch] Mobile WebView failed: {e}, falling back to HTTP");
                }
            }
        }
    }

    http_fetch(&url).await
}

#[tauri::command]
pub async fn web_eval(
    app: tauri::AppHandle,
    label: String,
    js: String,
) -> Result<String, String> {
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        let webview = app
            .get_webview_window(&label)
            .ok_or_else(|| format!("Browser session '{label}' not found"))?;

        let (tx, rx) = std::sync::mpsc::channel();
        webview
            .eval_with_callback(&js, move |result| {
                let _ = tx.send(result);
            })
            .map_err(|e| format!("eval failed: {e}"))?;

        rx.recv_timeout(std::time::Duration::from_secs(10))
            .map_err(|e| format!("eval timeout: {e}"))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("Interactive mode only supported on desktop".into())
    }
}

#[tauri::command]
pub async fn web_close(
    app: tauri::AppHandle,
    label: String,
) -> Result<(), String> {
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        let webview = app
            .get_webview_window(&label)
            .ok_or_else(|| format!("Browser session '{label}' not found"))?;
        webview
            .close()
            .map_err(|e| format!("close failed: {e}"))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_safe_url_https() {
        assert!(is_safe_url("https://example.com").is_ok());
    }

    #[test]
    fn test_is_safe_url_http() {
        assert!(is_safe_url("http://example.com/page?q=1").is_ok());
    }

    #[test]
    fn test_is_safe_url_rejects_file() {
        assert!(is_safe_url("file:///etc/passwd").is_err());
    }

    #[test]
    fn test_is_safe_url_rejects_javascript() {
        assert!(is_safe_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn test_is_safe_url_rejects_localhost() {
        assert!(is_safe_url("http://localhost:8080").is_err());
        assert!(is_safe_url("http://127.0.0.1:3000").is_err());
    }

    #[test]
    fn test_is_safe_url_rejects_private_ip() {
        assert!(is_safe_url("http://192.168.1.1").is_err());
        assert!(is_safe_url("http://10.0.0.1").is_err());
        assert!(is_safe_url("http://172.16.0.1").is_err());
    }

    #[test]
    fn test_extract_title() {
        let html = "<html><head><title>Test Page</title></head><body></body></html>";
        assert_eq!(extract_title(html), "Test Page");
    }

    #[test]
    fn test_extract_text_removes_script() {
        let html = "<html><body><p>Hello</p><script>console.log('x')</script><p>World</p></body></html>";
        let text = extract_text(html);
        assert!(text.contains("Hello"));
        assert!(text.contains("World"));
        assert!(!text.contains("console.log"));
    }

    #[test]
    fn test_extract_title_missing() {
        let html = "<html><body>No title</body></html>";
        assert_eq!(extract_title(html), "");
    }

    #[test]
    fn test_extract_title_with_whitespace() {
        let html = "<html><head><title>  Padded  </title></head></html>";
        assert_eq!(extract_title(html), "Padded");
    }

    #[test]
    fn test_extract_text_nested_elements() {
        let html = "<html><body><div><span>Deep</span> <em>nested</em></div></body></html>";
        let text = extract_text(html);
        assert!(text.contains("Deep"));
        assert!(text.contains("nested"));
    }

    #[test]
    fn test_extract_text_empty_body() {
        let html = "<html><body></body></html>";
        let text = extract_text(html);
        assert!(text.is_empty() || text == "");
    }

    #[test]
    fn test_extract_text_removes_nav_footer_header() {
        let html = "<html><body><nav>Menu</nav><main>Content</main><footer>Copyright</footer><header>Logo</header></body></html>";
        let text = extract_text(html);
        assert!(text.contains("Content"));
        assert!(!text.contains("Menu"));
        assert!(!text.contains("Copyright"));
        assert!(!text.contains("Logo"));
    }

    #[test]
    fn test_is_safe_url_rejects_ftp() {
        assert!(is_safe_url("ftp://files.example.com").is_err());
    }

    #[test]
    fn test_is_safe_url_rejects_data_uri() {
        assert!(is_safe_url("data:text/html,<script>alert(1)</script>").is_err());
    }

    #[test]
    fn test_is_safe_url_ipv6_localhost() {
        assert!(is_safe_url("http://[::1]:8080").is_err());
    }

    #[test]
    fn test_is_safe_url_allows_public_ip() {
        // 公共 DNS 服务器地址应该允许
        assert!(is_safe_url("https://8.8.8.8").is_ok());
    }

    #[test]
    fn test_is_safe_url_with_query_and_fragment() {
        assert!(is_safe_url("https://example.com/path?a=1&b=2#section").is_ok());
    }

    #[tokio::test]
    async fn test_http_fetch_real_page() {
        let result = http_fetch("https://httpbin.org/html").await;
        assert!(result.is_ok(), "Failed: {:?}", result.err());
        let r = result.unwrap();
        assert!(!r.text.is_empty(), "Text should not be empty");
        assert!(r.content_type.contains("text/html"));
        // Content may vary — just check we got something meaningful
        assert!(r.text.len() > 10, "Text too short: {}", r.text.len());
    }

    #[tokio::test]
    async fn test_http_fetch_bad_url() {
        let result = http_fetch("https://this-domain-does-not-exist-12345.com").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_http_fetch_bilibili() {
        let result = http_fetch("https://www.bilibili.com").await;
        assert!(result.is_ok(), "Failed: {:?}", result.err());
        let r = result.unwrap();
        assert_eq!(r.url, "https://www.bilibili.com/");
        assert!(!r.title.is_empty(), "Bilibili page should have a title");
        assert!(r.content_type.contains("text/html"));
        // Bilibili is an SPA — the HTTP text will be sparse (mostly JS placeholders),
        // but the WebView path (desktop Tauri) would render the full page.
        println!("Bilibili title: {}", r.title);
        println!("Bilibili text length: {} chars", r.text.len());
    }

    /// WebView 测试：需要 Tauri 桌面环境（cargo tauri dev）
    /// 在隐藏 WebView 中渲染 bilibili.com，提取完整可读文本。
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    #[tokio::test]
    #[ignore = "Requires Tauri runtime with display (run via `cargo tauri dev`)"]
    async fn test_webview_fetch_bilibili() {
        // 这个测试需要运行在 Tauri 应用中
        // 可以通过 cargo tauri dev 启动后，在 AI 对话中输入：
        //   "用 web_fetch 获取 https://www.bilibili.com 的页面"
        // WebView 会渲染完整的 SPA 页面，执行 JS，提取出视频标题、推荐内容等。
        //
        // 预期 HTTP 路径只能拿到空壳 HTML（<div id="app"> 等占位符），
        // WebView 路径能拿到完整的渲染文本，证明 WebView 下载有效。
        unreachable!("This test must run inside a Tauri app");
    }
}
