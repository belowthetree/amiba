// ============================================================
// 变形虫 (Amiba) — WebView 浏览器引擎 v3
// ============================================================
// v3 改进：
//   1. Android — 通过 WebViewHelper/JsCallback Kotlin 类，
//      Handler 主线程调度 + evaluateJavascript 正确传 ValueCallback
//   2. 智能等待 — 监听 PageLoadFinished 而非 sleep(5s)
//   3. BrowserPool — 复用隐藏 WebView，避免重复创建
//   4. 移动端交互 — web_eval/web_click/web_type 全平台
// ============================================================

use std::collections::HashMap;
use std::sync::Mutex;
#[allow(unused_imports)]
use tauri::Emitter;
#[cfg(target_os = "android")]
use tauri::Manager;
use url::Url;

// ---- Types ----

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct FetchResult {
    pub url: String,
    pub title: String,
    pub text: String,
    pub content_type: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct EvalResult {
    pub result: String,
}

// ============================================================
// BrowserPool — 跨请求复用 WebView 实例
// ============================================================

pub struct BrowserPool {
    sessions: Mutex<HashMap<String, BrowserHandle>>,
    #[allow(dead_code)]
    counter: Mutex<u32>,
}

#[derive(Clone)]
enum BrowserHandle {
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    Desktop(tauri::WebviewWindow),
    #[allow(dead_code)]
    None,
}

impl BrowserPool {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            counter: Mutex::new(0),
        }
    }

    #[allow(dead_code)]
    fn next_id(&self) -> String {
        let mut c = self.counter.lock().unwrap();
        *c += 1;
        format!("amiba_browser_{}", c)
    }

    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    pub fn get_or_create_desktop(
        &self,
        app: &tauri::AppHandle,
        url: &Url,
    ) -> Result<(String, tauri::WebviewWindow), String> {
        // 尝试复用空闲 session
        {
            let sessions = self.sessions.lock().unwrap();
            for (id, handle) in sessions.iter() {
                if let BrowserHandle::Desktop(wv) = handle {
                    if wv.url().is_ok() {
                        let wv_clone = wv.clone();
                        return Ok((id.clone(), wv_clone));
                    }
                }
            }
        }

        // 创建新的隐藏窗口（480x360 用于截图渲染）
        let id = self.next_id();
        let builder = tauri::WebviewWindowBuilder::new(
            app,
            &id,
            tauri::WebviewUrl::External(url.clone()),
        )
        .visible(false)
        .inner_size(480.0, 360.0)
        .skip_taskbar(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .title("");

        let wv = builder
            .build()
            .map_err(|e| format!("Failed to create browser window: {e}"))?;

        let mut sessions = self.sessions.lock().unwrap();
        sessions.insert(id.clone(), BrowserHandle::Desktop(wv.clone()));
        Ok((id, wv))
    }

    pub fn remove(&self, id: &str) {
        let mut sessions = self.sessions.lock().unwrap();
        #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
        if let Some(BrowserHandle::Desktop(wv)) = sessions.remove(id) {
            let _ = wv.close();
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            sessions.remove(id);
        }
    }
}

// ============================================================
// URL Safety
// ============================================================

fn is_safe_url(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url).map_err(|e| format!("Invalid URL: {e}"))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(format!("Blocked protocol: {scheme}"));
    }
    if let Some(host) = parsed.host_str() {
        if host == "localhost" || host == "127.0.0.1" || host == "[::1]" {
            return Err("Blocked: localhost".into());
        }
        if host.starts_with("10.") || host.starts_with("172.16.") || host.starts_with("192.168.") || host.starts_with("0.") {
            return Err("Blocked: private network".into());
        }
    }
    Ok(parsed)
}

const EXTRACT_JS: &str = "JSON.stringify({title: document.title || '', text: (document.body && document.body.innerText) ? document.body.innerText.slice(0, 50000) : ''})";

// JS: 提取简化 DOM 结构（标签名、id、class，去掉脚本/CSS/其他属性）
const GET_CONTENT_JS: &str = r#"(function(){
  var out='',maxDepth=15,maxLen=50000;
  function walk(n,d){
    if(out.length>maxLen||d>maxDepth)return;
    if(n.nodeType===3){var t=n.textContent.trim().slice(0,200);if(t)out+=t+'\n';return}
    if(n.nodeType!==1)return;
    var tag=n.tagName.toLowerCase();
    if(tag==='script'||tag==='style'||tag==='noscript'||tag==='svg'||tag==='link'||tag==='meta'||tag==='br'||tag==='hr')return;
    var attrs='';
    if(n.id)attrs+=' id='+JSON.stringify(n.id);
    if(n.className&&typeof n.className==='string'){var cls=n.className.trim().replace(/\s+/g,' ');if(cls)attrs+=' class='+JSON.stringify(cls)}
    out+='<'+tag+attrs+'>\n';
    if(tag==='input'||tag==='textarea'||tag==='select'){
      var name=n.getAttribute('name'),type=n.getAttribute('type'),placeholder=n.getAttribute('placeholder'),value=n.value;
      if(name)out+='  name='+JSON.stringify(name)+'\n';
      if(type)out+='  type='+JSON.stringify(type)+'\n';
      if(placeholder)out+='  placeholder='+JSON.stringify(placeholder.slice(0,100))+'\n';
      if(value)out+='  value='+JSON.stringify(String(value).slice(0,200))+'\n';
    }
    if(tag==='img'){
      var src=n.getAttribute('src'),alt=n.getAttribute('alt');
      if(src)out+='  src='+JSON.stringify(src.slice(0,200))+'\n';
      if(alt)out+='  alt='+JSON.stringify(alt.slice(0,200))+'\n';
    }
    if(tag==='a'){
      var href=n.getAttribute('href'),linkText=n.textContent.trim().slice(0,100);
      if(href)out+='  href='+JSON.stringify(href.slice(0,200))+'\n';
      if(linkText)out+='  '+JSON.stringify(linkText)+'\n';
    }
    for(var i=0;i<n.childNodes.length;i++)walk(n.childNodes[i],d+1);
    out+='</'+tag+'>\n';
  }
  walk(document.body,0);
  return JSON.stringify({title:document.title||'',url:location.href,content:out.slice(0,maxLen)});
})()"#;

// ============================================================
// HTTP fallback
// ============================================================

pub async fn http_fetch(url: &str) -> Result<FetchResult, String> {
    let parsed = is_safe_url(url)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("Mozilla/5.0 (compatible; Amiba/1.0)")
        .build()
        .map_err(|e| format!("Client error: {e}"))?;
    let resp = client.get(parsed.as_str()).send().await.map_err(|e| format!("Request failed: {e}"))?;
    let ct = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("unknown").to_string();
    let html = resp.text().await.map_err(|e| format!("Read: {e}"))?;
    let html = if html.len() > 200_000 { html[..200_000].to_string() } else { html };
    let title = extract_title(&html);
    let text = extract_text(&html);
    let text = if text.len() > 50000 { text[..50000].to_string() } else { text };
    Ok(FetchResult { url: parsed.to_string(), title, text, content_type: ct })
}

fn extract_title(html: &str) -> String {
    let doc = scraper::Html::parse_document(html);
    doc.select(&scraper::Selector::parse("title").unwrap())
        .next().map(|e| e.text().collect::<String>().trim().to_string()).unwrap_or_default()
}

fn extract_text(html: &str) -> String {
    let doc = scraper::Html::parse_document(html);
    let rm = scraper::Selector::parse("script, style, nav, footer, header, noscript, svg, iframe").unwrap();
    let mut dom = doc.root_element().html();
    for el in doc.select(&rm) { dom = dom.replace(&el.html(), ""); }
    let c = scraper::Html::parse_document(&dom);
    c.root_element().text().map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect::<Vec<_>>().join("\n")
}

// ============================================================
// Desktop WebView — 智能等待 + 事件驱动
// ============================================================

#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
mod desktop {
    use super::*;
    use std::sync::mpsc;

    /// 桌面端 WebView fetch：轮询 readyState 等待加载完成
    pub fn webview_fetch_sync(wv: &tauri::WebviewWindow, url: &str) -> Result<FetchResult, String> {
        if let Ok(parsed) = Url::parse(url) {
            wv.navigate(parsed).map_err(|e| format!("navigate: {e}"))?;
        }

        // 1. 轮询 readyState 等页面框架加载
        for _ in 0..30 {
            std::thread::sleep(std::time::Duration::from_millis(500));
            let (tx, rx) = mpsc::channel::<String>();
            let _ = wv.eval_with_callback("document.readyState", move |r| { let _ = tx.send(r); });
            if let Ok(state) = rx.recv_timeout(std::time::Duration::from_secs(1)) {
                if state.contains("complete") || state.contains("interactive") { break; }
            }
        }

        // 2. MutationObserver 等待 AJAX/SPA 动态内容渲染完成
        let (tx_mo, rx_mo) = mpsc::channel::<String>();
        wv.eval_with_callback(
            r#"(function(){
              return new Promise(function(resolve){
                var settled=false, timer;
                var done=function(){ if(!settled){ settled=true; observer.disconnect(); resolve('stable'); } };
                var observer=new MutationObserver(function(){
                  clearTimeout(timer);
                  timer=setTimeout(done,800);
                });
                observer.observe(document.body,{childList:true,subtree:true,attributes:true,characterData:true});
                timer=setTimeout(done,800);
                setTimeout(done,10000);
              });
            })()"#,
            move |r| { let _ = tx_mo.send(r); },
        ).map_err(|e| format!("MutationObserver eval: {e}"))?;

        let _ = rx_mo.recv_timeout(std::time::Duration::from_secs(15));

        // 3. 提取内容
        let (tx2, rx2) = mpsc::channel::<String>();
        wv.eval_with_callback(EXTRACT_JS, move |r| { let _ = tx2.send(r); })
            .map_err(|e| format!("eval: {e}"))?;

        let json = rx2.recv_timeout(std::time::Duration::from_secs(10))
            .unwrap_or_else(|_| "{}".to_string());

        let (title, text) = if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) {
            (v["title"].as_str().unwrap_or("").to_string(), v["text"].as_str().unwrap_or("").to_string())
        } else { (String::new(), json) };

        let text = if text.len() > 50000 { text[..50000].to_string() } else { text };
        Ok(FetchResult { url: url.to_string(), title, text, content_type: "text/html".to_string() })
    }

    /// 桌面端 eval JS
    pub fn webview_eval_sync(wv: &tauri::WebviewWindow, js: &str) -> Result<String, String> {
        let (tx, rx) = mpsc::channel::<String>();
        wv.eval_with_callback(js, move |r| { let _ = tx.send(r); })
            .map_err(|e| format!("eval: {e}"))?;
        rx.recv_timeout(std::time::Duration::from_secs(10))
            .map_err(|e| format!("timeout: {e}"))
    }
}

// ============================================================
// Mobile WebView — Android JNI / iOS objc2  
// ============================================================

#[cfg(target_os = "android")]
mod mobile {
    use super::*;
    use jni::objects::{JObject, JValue};
    use jni::JavaVM;

    /// 通过 JNI 获取 Android Application Context（不依赖 ndk_context）
    fn get_app_context<'a>(env: &mut jni::JNIEnv<'a>) -> Result<JObject<'a>, String> {
        let at_cls = env
            .find_class("android/app/ActivityThread")
            .map_err(|e| format!("ActivityThread class: {e}"))?;
        let at_obj = env
            .call_static_method(
                &at_cls,
                "currentActivityThread",
                "()Landroid/app/ActivityThread;",
                &[],
            )
            .map_err(|e| format!("currentActivityThread: {e}"))?
            .l()
            .map_err(|e| format!("currentActivityThread obj: {e}"))?;
        let app = env
            .call_method(
                &at_obj,
                "getApplication",
                "()Landroid/app/Application;",
                &[],
            )
            .map_err(|e| format!("getApplication: {e}"))?
            .l()
            .map_err(|e| format!("getApplication obj: {e}"))?;
        Ok(app)
    }

    /// 使用 Application ClassLoader 查找 app 类（native 线程只有 system class loader）
    pub(crate) fn find_app_class<'a>(env: &mut jni::JNIEnv<'a>, name: &str) -> Result<jni::objects::JClass<'a>, String> {
        // 通过 ActivityThread 拿到 Application Context
        let at_cls = env.find_class("android/app/ActivityThread")
            .map_err(|e| format!("ActivityThread class: {e}"))?;
        let at_obj = env.call_static_method(
            &at_cls, "currentActivityThread", "()Landroid/app/ActivityThread;", &[]
        ).map_err(|e| format!("currentActivityThread: {e}"))?.l().map_err(|e| format!("obj: {e}"))?;
        let app = env.call_method(
            &at_obj, "getApplication", "()Landroid/app/Application;", &[]
        ).map_err(|e| format!("getApplication: {e}"))?.l().map_err(|e| format!("obj: {e}"))?;

        // Context.getClassLoader()
        let class_loader = env.call_method(
            &app, "getClassLoader", "()Ljava/lang/ClassLoader;", &[]
        ).map_err(|e| format!("getClassLoader: {e}"))?.l().map_err(|e| format!("obj: {e}"))?;

        // ClassLoader.loadClass(name)
        let jname = env.new_string(name).map_err(|e| format!("str: {e}"))?;
        let cls = env.call_method(
            &class_loader, "loadClass", "(Ljava/lang/String;)Ljava/lang/Class;",
            &[JValue::Object(&jname.into())]
        ).map_err(|e| format!("loadClass({name}): {e}"))?.l().map_err(|e| format!("obj: {e}"))?;

        Ok(cls.into())
    }

    /// 确保 WebViewHelper 已初始化（幂等）
    fn ensure_init(env: &mut jni::JNIEnv) -> Result<(), String> {
        let helper_cls = find_app_class(env, "com.amiba.desktop.WebViewHelper")?;

        let initialized = env
            .call_static_method(&helper_cls, "isInitialized", "()Z", &[])
            .map_err(|e| format!("isInitialized: {e}"))?
            .z()
            .map_err(|e| format!("isInitialized result: {e}"))?;

        if initialized {
            return Ok(());
        }

        // 首次初始化：获取 Application Context
        let ctx_obj = get_app_context(env)?;

        let init_ok = env
            .call_static_method(
                &helper_cls,
                "init",
                "(Landroid/content/Context;)Z",
                &[JValue::Object(&ctx_obj)],
            )
            .map_err(|e| {
                eprintln!("[rust:web] WebViewHelper.init FAIL: {e}");
                format!("init: {e}")
            })?
            .z()
            .map_err(|e| format!("init result: {e}"))?;

        if !init_ok {
            return Err("WebViewHelper.init returned false (UI thread timeout?)".into());
        }

        eprintln!("[rust:web] WebViewHelper initialized OK");
        Ok(())
    }

    pub fn mobile_fetch_sync(vm: &JavaVM, url: &str) -> Result<FetchResult, String> {
        let mut env = vm
            .attach_current_thread()
            .map_err(|e| format!("attach: {e}"))?;

        ensure_init(&mut env)?;
        let helper_cls = find_app_class(&mut env, "com.amiba.desktop.WebViewHelper")?;

        // 1. 导航并等待页面加载
        let jurl = env.new_string(url).map_err(|e| format!("str: {e}"))?;
        let loaded = env
            .call_static_method(
                &helper_cls,
                "loadUrlAndWait",
                "(Ljava/lang/String;I)Z",
                &[JValue::Object(&jurl.into()), JValue::Int(15_000)],
            )
            .map_err(|e| format!("loadUrlAndWait: {e}"))?
            .z()
            .map_err(|e| format!("loadUrlAndWait result: {e}"))?;

        if !loaded {
            return Err("Page load timeout".into());
        }

        // 2. 提取页面内容
        let js = env.new_string(EXTRACT_JS).map_err(|e| format!("js str: {e}"))?;
        let result = env
            .call_static_method(
                &helper_cls,
                "evaluateJavascript",
                "(Ljava/lang/String;I)Ljava/lang/String;",
                &[JValue::Object(&js.into()), JValue::Int(10_000)],
            )
            .map_err(|e| format!("evaluateJavascript: {e}"))?;

        let jobj = result.l().map_err(|e| format!("result obj: {e}"))?;
        let jstr: jni::objects::JString = jobj.into();
        let rust_str: String = env
            .get_string(&jstr)
            .map_err(|e| format!("get_string: {e}"))?
            .into();

        let (title, text) =
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&rust_str) {
                (
                    v["title"].as_str().unwrap_or("").to_string(),
                    v["text"].as_str().unwrap_or("").to_string(),
                )
            } else {
                (format!("[Android] {}", url), rust_str)
            };

        let text = if text.len() > 50_000 {
            text[..50_000].to_string()
        } else {
            text
        };

        eprintln!("[rust:web] fetch OK: title={title} text_len={}", text.len());
        Ok(FetchResult {
            url: url.to_string(),
            title,
            text,
            content_type: "text/html".to_string(),
        })
    }

    pub fn mobile_eval_sync(vm: &JavaVM, js: &str) -> Result<String, String> {
        let mut env = vm
            .attach_current_thread()
            .map_err(|e| format!("attach: {e}"))?;

        ensure_init(&mut env)?;
        let helper_cls = find_app_class(&mut env, "com.amiba.desktop.WebViewHelper")?;

        let jjs = env.new_string(js).map_err(|e| format!("str: {e}"))?;

        let result = env
            .call_static_method(
                &helper_cls,
                "evaluateJavascript",
                "(Ljava/lang/String;I)Ljava/lang/String;",
                &[JValue::Object(&jjs.into()), JValue::Int(10_000)],
            )
            .map_err(|e| format!("evaluateJavascript: {e}"))?;

        let jobj = result.l().map_err(|e| format!("result obj: {e}"))?;
        let jstr: jni::objects::JString = jobj.into();
        let rust_str: String = env
            .get_string(&jstr)
            .map_err(|e| format!("get_string: {e}"))?
            .into();

        Ok(rust_str)
    }
}

#[cfg(target_os = "ios")]
mod mobile {
    use super::*;
    use std::sync::mpsc;
    use objc2::rc::Retained;
    use objc2_foundation::{NSURL, NSURLRequest, NSString, CGRect, CGPoint, CGSize, NSError};
    use objc2_web_kit::{WKWebView, WKWebViewConfiguration};

    static MOBILE_WEBVIEW: std::sync::OnceLock<Mutex<Option<Retained<WKWebView>>>> = std::sync::OnceLock::new();

    fn get_or_create_webview() -> Retained<WKWebView> {
        let lock = MOBILE_WEBVIEW.get_or_init(|| Mutex::new(None));
        let mut guard = lock.lock().unwrap();
        if let Some(ref wv) = *guard { return wv.clone(); }
        let config = WKWebViewConfiguration::new();
        let frame = CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(1.0, 1.0));
        let wv = WKWebView::initWithFrame_configuration(WKWebView::alloc(), frame, &config);
        *guard = Some(wv.clone());
        wv
    }

    pub fn mobile_fetch_sync(url: &str) -> Result<FetchResult, String> {
        let wv = get_or_create_webview();
        let nsurl = NSURL::URLWithString(&NSString::from_str(url)).ok_or("Invalid URL")?;
        wv.loadRequest(&NSURLRequest::requestWithURL(&nsurl));

        // 等待加载完成
        std::thread::sleep(std::time::Duration::from_secs(5));

        // 提取 JS
        let js = NSString::from_str(EXTRACT_JS);
        let (tx, rx) = mpsc::channel::<String>();
        let tx = Mutex::new(Some(tx));

        wv.evaluateJavaScript_completionHandler(&js, {
            move |result: Option<Retained<NSString>>, _err: Option<Retained<NSError>>| {
                let text = result.map(|s| s.to_string()).unwrap_or_else(|| "{}".to_string());
                if let Ok(mut g) = tx.lock() { if let Some(s) = g.take() { let _ = s.send(text); } }
            }
        });

        let json = rx.recv_timeout(std::time::Duration::from_secs(10)).unwrap_or_else(|_| "{}".to_string());
        let (title, text) = if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) {
            (v["title"].as_str().unwrap_or("").to_string(), v["text"].as_str().unwrap_or("").to_string())
        } else { (format!("[iOS] {}", url), json) };

        let text = if text.len() > 50000 { text[..50000].to_string() } else { text };
        Ok(FetchResult { url: url.to_string(), title, text, content_type: "text/html".to_string() })
    }

    pub fn mobile_eval_sync(js: &str) -> Result<String, String> {
        let wv = get_or_create_webview();
        let jss = NSString::from_str(js);
        let (tx, rx) = mpsc::channel::<String>();
        let tx = Mutex::new(Some(tx));
        wv.evaluateJavaScript_completionHandler(&jss, {
            move |result: Option<Retained<NSString>>, _err: Option<Retained<NSError>>| {
                let text = result.map(|s| s.to_string()).unwrap_or_default();
                if let Ok(mut g) = tx.lock() { if let Some(s) = g.take() { let _ = s.send(text); } }
            }
        });
        rx.recv_timeout(std::time::Duration::from_secs(5)).map_err(|e| format!("timeout: {e}"))
    }
}

// ============================================================
// Tauri Commands
// ============================================================

#[tauri::command]
#[allow(unused_variables)]
pub async fn web_fetch(
    app: tauri::AppHandle,
    pool: tauri::State<'_, BrowserPool>,
    url: String,
    use_webview: Option<bool>,
) -> Result<FetchResult, String> {
    let use_wv = use_webview.unwrap_or(true);
    let parsed = is_safe_url(&url)?;

    if use_wv {
        #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
        {
            let (_id, wv) = pool.get_or_create_desktop(&app, &parsed)?;
            return desktop::webview_fetch_sync(&wv, &url)
                .or_else(|e| { eprintln!("[rust:web] Desktop WebView error: {e}"); Err(e) });
        }
        #[cfg(target_os = "android")]
        {
            let jvm_ptr = app.state::<crate::AndroidJvm>();
            let vm = unsafe {
                jni::JavaVM::from_raw(jvm_ptr.0 as *mut _)
            }.map_err(|e| format!("JVM: {e}"))?;
            return mobile::mobile_fetch_sync(&vm, &url);
        }
        #[cfg(target_os = "ios")]
        {
            return mobile::mobile_fetch_sync(&url);
        }
    }
    http_fetch(&url).await
}

#[tauri::command]
pub async fn web_eval(
    #[allow(unused)] app: tauri::AppHandle,
    #[allow(unused)] pool: tauri::State<'_, BrowserPool>,
    js: String,
) -> Result<EvalResult, String> {
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        // 从 pool 中取任意一个活跃 session
        let sessions = pool.sessions.lock().unwrap();
        for (_id, handle) in sessions.iter() {
            if let BrowserHandle::Desktop(wv) = handle {
                let result = desktop::webview_eval_sync(wv, &js)?;
                return Ok(EvalResult { result });
            }
        }
        Err("No active browser session. Call web_fetch first.".into())
    }
    #[cfg(target_os = "android")]
    {
        let jvm_ptr = app.state::<crate::AndroidJvm>();
        let vm = unsafe {
            jni::JavaVM::from_raw(jvm_ptr.0 as *mut _)
        }.map_err(|e| format!("JVM: {e}"))?;
        mobile::mobile_eval_sync(&vm, &js).map(|r| EvalResult { result: r })
    }
    #[cfg(target_os = "ios")]
    {
        mobile::mobile_eval_sync(&js).map(|r| EvalResult { result: r })
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux", target_os = "android", target_os = "ios")))]
    {
        Err("Unsupported platform".into())
    }
}

#[tauri::command]
pub async fn web_click(
    #[allow(unused)] app: tauri::AppHandle,
    pool: tauri::State<'_, BrowserPool>,
    selector: String,
) -> Result<EvalResult, String> {
    // 通用表单提交：requestSubmit (标准) → submit() 兜底 → URL 检测
    let safe_sel = selector.replace('\\', "\\\\").replace('\'', "\\'");
    let js = format!(r#"(function(){{
  var el=document.querySelector('{safe_sel}');
  if(!el) return 'not found: {safe_sel}';
  var origUrl=location.href;

  // 派发完整鼠标事件序列
  ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(t){{
    el.dispatchEvent(new MouseEvent(t,{{bubbles:true,cancelable:true,view:window}}));
  }});

  // 表单提交：优先用 requestSubmit（W3C 标准，会触发 submit 事件+验证）
  var f=el.closest('form');
  var submitted=false;
  if(f){{
    try{{
      if(typeof f.requestSubmit==='function'){{
        f.requestSubmit(el);  // 以该按钮为 submitter 提交
        submitted=true;
      }}
    }}catch(e){{}}
    if(!submitted){{ try{{ f.submit(); }}catch(e){{}} }}
    f.dispatchEvent(new SubmitEvent('submit',{{submitter:el,bubbles:true,cancelable:true}}));
  }}

  return new Promise(function(resolve){{
    var settled=false, timer;
    var done=function(msg){{ if(!settled){{ settled=true; clearInterval(urlCheck); observer.disconnect(); resolve(msg); }} }};
    var urlCheck=setInterval(function(){{
      if(location.href!==origUrl) done('navigated: '+location.href);
    }},200);
    var observer=new MutationObserver(function(){{
      clearTimeout(timer);
      timer=setTimeout(function(){{ done('stabilized'); }},1500);
    }});
    observer.observe(document.body,{{childList:true,subtree:true,attributes:true}});
    timer=setTimeout(function(){{ done('stabilized'); }},1500);
    setTimeout(function(){{ done('stabilized (timeout)'); }},10000);
  }});
}})()"#);
    // 用 eval_with_callback 直接拿到 Promise resolve 的值
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        let sessions = pool.sessions.lock().unwrap();
        for (_id, handle) in sessions.iter() {
            if let BrowserHandle::Desktop(wv) = handle {
                let (tx, rx) = std::sync::mpsc::channel::<String>();
                wv.eval_with_callback(&js, move |r| { let _ = tx.send(r); })
                    .map_err(|e| format!("eval: {e}"))?;
                let result = rx.recv_timeout(std::time::Duration::from_secs(12))
                    .unwrap_or_else(|_| "timeout".to_string());
                return Ok(EvalResult { result });
            }
        }
        Err("No active browser session".into())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        web_eval(app, pool, js).await
    }
}

#[tauri::command]
pub async fn web_input_text(
    #[allow(unused)] app: tauri::AppHandle,
    pool: tauri::State<'_, BrowserPool>,
    selector: String,
    text: String,
) -> Result<EvalResult, String> {
    let safe_sel = selector.replace('\\', "\\\\").replace('\'', "\\'");
    let safe_text = text.replace('\\', "\\\\").replace('\'', "\\'").replace('\n', "\\n");
    let js = format!(r#"(function(){{
  var el=document.querySelector('{safe_sel}');
  if(!el) return 'not found: {safe_sel}';
  el.focus();
  el.dispatchEvent(new FocusEvent('focus',{{bubbles:true}}));
  // React 兼容：通过原生 setter 设置 value，触发 React 合成事件
  var nativeSetter=Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(el),'value'
  );
  if(nativeSetter&&nativeSetter.set){{ nativeSetter.set.call(el,'{safe_text}'); }}
  else{{ el.value='{safe_text}'; }}
  // 派发完整输入事件序列
  el.dispatchEvent(new Event('input',{{bubbles:true}}));
  el.dispatchEvent(new KeyboardEvent('keydown',{{bubbles:true,key:''}}));
  el.dispatchEvent(new KeyboardEvent('keyup',{{bubbles:true,key:''}}));
  el.dispatchEvent(new Event('change',{{bubbles:true}}));
  return new Promise(function(resolve){{
    var settled=false, timer;
    var done=function(){{ if(!settled){{ settled=true; observer.disconnect(); resolve('typed: '+el.value.length+' chars'); }} }};
    var observer=new MutationObserver(function(){{
      clearTimeout(timer);
      timer=setTimeout(done,800);
    }});
    observer.observe(document.body,{{childList:true,subtree:true,attributes:true}});
    timer=setTimeout(done,800);
    setTimeout(done,5000);
  }});
}})()"#);
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        let sessions = pool.sessions.lock().unwrap();
        for (_id, handle) in sessions.iter() {
            if let BrowserHandle::Desktop(wv) = handle {
                let (tx, rx) = std::sync::mpsc::channel::<String>();
                wv.eval_with_callback(&js, move |r| { let _ = tx.send(r); })
                    .map_err(|e| format!("eval: {e}"))?;
                let result = rx.recv_timeout(std::time::Duration::from_secs(12))
                    .unwrap_or_else(|_| "timeout".to_string());
                return Ok(EvalResult { result });
            }
        }
        Err("No active browser session".into())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        web_eval(app, pool, js).await
    }
}

#[tauri::command]
pub async fn web_get_content(
    app: tauri::AppHandle,
    pool: tauri::State<'_, BrowserPool>,
) -> Result<EvalResult, String> {
    let content = web_eval(app, pool, GET_CONTENT_JS.to_string()).await?;
    // 日志打印 get_content 内容（开发者调试）
    println!("[web_get_content] {}", content.result);
    Ok(content)
}

#[tauri::command]
#[allow(unused_variables)]
pub async fn web_close(
    app: tauri::AppHandle,
    pool: tauri::State<'_, BrowserPool>,
    session_id: Option<String>,
) -> Result<(), String> {
    if let Some(id) = session_id {
        pool.remove(&id);
    } else {
        let sessions: Vec<String> = {
            pool.sessions.lock().unwrap().keys().cloned().collect()
        };
        for id in sessions {
            pool.remove(&id);
        }
    }

    // Android: 销毁 WebViewHelper 中的 WebView
    #[cfg(target_os = "android")]
    {
        let jvm_ptr = app.state::<crate::AndroidJvm>();
        let vm = unsafe {
            jni::JavaVM::from_raw(jvm_ptr.0 as *mut _)
        }.map_err(|e| format!("JVM: {e}"))?;
        let mut env = vm.attach_current_thread()
            .map_err(|e| format!("attach: {e}"))?;
        let helper_cls = mobile::find_app_class(&mut env, "com.amiba.desktop.WebViewHelper")?;
        env.call_static_method(&helper_cls, "close", "()V", &[])
            .map_err(|e| format!("close: {e}"))?;
    }

    Ok(())
}

// ============================================================
// 截图捕获命令
// ============================================================

// 注入截图触发逻辑，结果写入 window._amiba_screenshot
#[allow(dead_code)]
const CAPTURE_TRIGGER_JS: &str = r#"(function(){
  function capture(){
    try{
      html2canvas(document.body,{
        width:window.innerWidth,
        height:Math.min(window.innerHeight,4096),
        windowWidth:window.innerWidth,
        windowHeight:window.innerHeight,
        scale:1,
        useCORS:true,
        allowTaint:true,
        logging:false
      }).then(function(canvas){
        window._amiba_screenshot=canvas.toDataURL('image/jpeg',0.65);
      }).catch(function(e){
        window._amiba_screenshot='ERROR:'+e.message;
      });
    }catch(e){
      window._amiba_screenshot='ERROR:'+e.message;
    }
  }
  if(window._amiba_h2c_loaded){
    capture();
  }else if(typeof html2canvas!=='undefined'){
    window._amiba_h2c_loaded=true;
    capture();
  }else{
    var s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
    s.onload=function(){window._amiba_h2c_loaded=true;capture();};
    s.onerror=function(){window._amiba_screenshot='ERROR: CDN load failed';};
    (document.head||document.documentElement).appendChild(s);
  }
})()"#;

#[tauri::command]
pub async fn web_capture_screenshot(
    app: tauri::AppHandle,
    pool: tauri::State<'_, BrowserPool>,
) -> Result<(), String> {
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        let wv = {
            let sessions = pool.sessions.lock().unwrap();
            sessions.iter().find_map(|(_id, handle)| {
                if let BrowserHandle::Desktop(wv) = handle {
                    Some(wv.clone())
                } else {
                    None
                }
            })
        }.ok_or("No active browser session")?;

        // Step 1: 清空旧结果，触发截图
        wv.eval("window._amiba_screenshot='';").ok();
        wv.eval(CAPTURE_TRIGGER_JS).ok();

        let app_clone = app.clone();
        let wv_clone = wv.clone();

        let result = tokio::task::spawn_blocking(move || {
            // Step 2: 轮询读取结果（eval_with_callback 同步表达式）
            for i in 0..60 {
                std::thread::sleep(std::time::Duration::from_millis(500));
                let (tx, rx) = std::sync::mpsc::channel::<String>();
                let _ = wv_clone.eval_with_callback(
                    "window._amiba_screenshot||''",
                    move |r| { let _ = tx.send(r); },
                );
                if let Ok(raw) = rx.recv_timeout(std::time::Duration::from_secs(1)) {
                    let val: String = serde_json::from_str(&raw).unwrap_or_else(|_| raw);
                    if !val.is_empty() {
                        eprintln!("[web_capture_screenshot] result({}): {:?}", val.len(), &val[..val.len().min(80)]);
                        if !val.starts_with("ERROR:") {
                            println!("[web_capture_screenshot] OK, {} chars, poll={}", val.len(), i);
                        } else {
                            eprintln!("[web_capture_screenshot] {}", val);
                        }
                        let _ = app_clone.emit("webview-screenshot", val);
                        return;
                    }
                }
            }
            eprintln!("[web_capture_screenshot] poll timeout after 30s");
        }).await;

        if let Err(e) = result {
            eprintln!("[web_capture_screenshot] spawn_blocking error: {}", e);
        }

        Ok(())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = (app, pool);
        Ok(())
    }
}

// ============================================================
// Tests
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test] fn test_is_safe_url_https() { assert!(is_safe_url("https://example.com").is_ok()); }
    #[test] fn test_is_safe_url_http() { assert!(is_safe_url("http://example.com/page?q=1").is_ok()); }
    #[test] fn test_is_safe_url_rejects_file() { assert!(is_safe_url("file:///etc/passwd").is_err()); }
    #[test] fn test_is_safe_url_rejects_javascript() { assert!(is_safe_url("javascript:alert(1)").is_err()); }
    #[test] fn test_is_safe_url_rejects_localhost() { assert!(is_safe_url("http://localhost:8080").is_err()); assert!(is_safe_url("http://127.0.0.1:3000").is_err()); }
    #[test] fn test_is_safe_url_rejects_private_ip() { assert!(is_safe_url("http://192.168.1.1").is_err()); assert!(is_safe_url("http://10.0.0.1").is_err()); assert!(is_safe_url("http://172.16.0.1").is_err()); }
    #[test] fn test_extract_title() { assert_eq!(extract_title("<html><head><title>Test</title></head></html>"), "Test"); }
    #[test] fn test_extract_title_missing() { assert_eq!(extract_title("<html><body>No</body></html>"), ""); }
    #[test] fn test_extract_title_with_whitespace() { assert_eq!(extract_title("<html><head><title>  Padded  </title></head></html>"), "Padded"); }
    #[test] fn test_extract_text_removes_script() { let t = extract_text("<html><body><p>Hello</p><script>x</script><p>World</p></body></html>"); assert!(t.contains("Hello")); assert!(t.contains("World")); assert!(!t.contains("x")); }
    #[test] fn test_extract_text_nested() { let t = extract_text("<html><body><div><span>Deep</span> <em>nested</em></div></body></html>"); assert!(t.contains("Deep")); assert!(t.contains("nested")); }
    #[test] fn test_extract_text_empty() { let t = extract_text("<html><body></body></html>"); assert!(t.is_empty() || t == ""); }
    #[test] fn test_extract_text_removes_nav() { let t = extract_text("<html><body><nav>Menu</nav><main>Content</main></body></html>"); assert!(t.contains("Content")); assert!(!t.contains("Menu")); }
    #[test] fn test_is_safe_url_rejects_ftp() { assert!(is_safe_url("ftp://x.com").is_err()); }
    #[test] fn test_is_safe_url_rejects_data() { assert!(is_safe_url("data:text/html,x").is_err()); }
    #[test] fn test_is_safe_url_ipv6_localhost() { assert!(is_safe_url("http://[::1]:8080").is_err()); }
    #[test] fn test_is_safe_url_allows_public_ip() { assert!(is_safe_url("https://8.8.8.8").is_ok()); }
    #[test] fn test_is_safe_url_query_fragment() { assert!(is_safe_url("https://x.com/p?a=1#s").is_ok()); }

    #[tokio::test] async fn test_http_fetch_real() { let r = http_fetch("https://httpbin.org/html").await; assert!(r.is_ok()); assert!(!r.unwrap().text.is_empty()); }
    #[tokio::test] async fn test_http_fetch_bad() { assert!(http_fetch("https://no-such-domain-12345.com").await.is_err()); }
    #[tokio::test] async fn test_http_fetch_bilibili() { let r = http_fetch("https://www.bilibili.com").await; assert!(r.is_ok()); let r = r.unwrap(); assert!(!r.title.is_empty()); }
    #[test] fn test_browser_pool_new() { let p = BrowserPool::new(); assert_eq!(*p.counter.lock().unwrap(), 0); }
    #[test] fn test_browser_pool_next_id() { let p = BrowserPool::new(); let id = p.next_id(); assert!(id.starts_with("amiba_browser_")); }
}
