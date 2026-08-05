import { webview } from '@kit.ArkWeb'
import { http } from '@kit.NetworkKit'
import { url as urlUtil, util } from '@kit.ArkTS'
import { HarmonyBridge } from './HarmonyBridge'

const TAG = '[AmibaWebFetch]'
const BROWSE_TAG = '[AmibaWebBrowse]'

// web 引擎命令（对应 Tauri Rust 侧 src-tauri/src/web.rs；docs/harmonyos-migration.md §5.5）。
// 6 命令全量实现：web_fetch + web_get_content / web_click / web_input_text / web_close / web_capture_screenshot。
// 全部作用于本模块的隐藏 WebView 单例——对齐 Rust 语义：桌面端 BrowserPool 隐藏窗口（480x360）/
// 移动端 WebViewHelper 隐藏 WebView，均非可见浏览器窗口，故鸿蒙侧复用隐藏池、无可见浏览层。
export const WEB_COMMANDS: string[] = [
  'web_fetch',
  'web_get_content',
  'web_click',
  'web_input_text',
  'web_close',
  'web_capture_screenshot'
]

// ---- 线协议返回类型 ----
// 与 src/config/web-bridge.ts FetchResult / Rust web.rs FetchResult serde 结构一致。
// 注意：返回对象本身（非 JSON 字符串）——HarmonyBridge.invoke 统一 JSON.stringify 一层，
// 前端 nativeInvoke 只 JSON.parse 一次即得 FetchResult 对象。DbCommands 返回 JSON 字符串的
// 先例源于 db.rs 本身返回 String、前端 session-db.ts 会二次 parse，此处不适用。
interface FetchResultWire {
  url: string
  title: string
  text: string
  raw: string
  content_type: string
}

// EvalResult 线协议（与 Rust web.rs EvalResult / 前端 web-bridge.ts EvalResult 一致：
// 直接返回对象，HarmonyBridge.invoke 统一 JSON.stringify 一层，前端 JSON.parse 一次即得）
interface EvalResultWire {
  result: string
}

// 隐藏 WebView 加载等待句柄（loadUrl → onPageEnd/onErrorReceive → resolve/reject）
interface PendingLoad {
  targetUrl: string
  timer: number
  resolve: () => void
  reject: (err: Error) => void
}

// ---- 常量（时长/截断/UA 全部对齐 Rust web.rs）----
const PAGE_LOAD_TIMEOUT_MS = 15000   // Rust Android loadUrlAndWait(15s) / 桌面 30×500ms readyState 轮询
const JS_EVAL_TIMEOUT_MS = 10000     // Rust evaluateJavascript(10s)
const HTTP_TIMEOUT_MS = 15000        // Rust reqwest timeout(15s)
const MAX_TEXT_LEN = 50000           // Rust text 截断 50000
const MAX_RAW_LEN = 200000           // Rust http_fetch raw 截断 200_000
const HTTP_UA = 'Mozilla/5.0 (compatible; Amiba/1.0)'

// 提取脚本：对齐 Rust EXTRACT_JS（title + body.innerText 截断 50000），外加 try/catch 防空页面。
// WebView 路径下 Rust 恒返回 raw="" / content_type="text/html"，故脚本只取 title/text。
const EXTRACT_JS: string =
  "(function(){try{return JSON.stringify({title:document.title||''," +
  "text:(document.body&&document.body.innerText)?document.body.innerText.slice(0,50000):''})" +
  "}catch(e){return '{}'}})()"

// get_content 简化 DOM 脚本：逐字对齐 Rust GET_CONTENT_JS（标签名/id/class，跳过 script/style 等，
// 表单元素带 name/type/placeholder/value、图片带 src/alt、链接带 href/文本，深度 15、上限 50000 字）。
// 注：模板字面量中 \\n / \\s 对应 JS 源码里的 '\n' / /\s/。
const GET_CONTENT_JS: string = `(function(){
  var out='',maxDepth=15,maxLen=50000;
  function walk(n,d){
    if(out.length>maxLen||d>maxDepth)return;
    if(n.nodeType===3){var t=n.textContent.trim().slice(0,200);if(t)out+=t+'\\n';return}
    if(n.nodeType!==1)return;
    var tag=n.tagName.toLowerCase();
    if(tag==='script'||tag==='style'||tag==='noscript'||tag==='svg'||tag==='link'||tag==='meta'||tag==='br'||tag==='hr')return;
    var attrs='';
    if(n.id)attrs+=' id='+JSON.stringify(n.id);
    if(n.className&&typeof n.className==='string'){var cls=n.className.trim().replace(/\\s+/g,' ');if(cls)attrs+=' class='+JSON.stringify(cls)}
    out+='<'+tag+attrs+'>\\n';
    if(tag==='input'||tag==='textarea'||tag==='select'){
      var name=n.getAttribute('name'),type=n.getAttribute('type'),placeholder=n.getAttribute('placeholder'),value=n.value;
      if(name)out+='  name='+JSON.stringify(name)+'\\n';
      if(type)out+='  type='+JSON.stringify(type)+'\\n';
      if(placeholder)out+='  placeholder='+JSON.stringify(placeholder.slice(0,100))+'\\n';
      if(value)out+='  value='+JSON.stringify(String(value).slice(0,200))+'\\n';
    }
    if(tag==='img'){
      var src=n.getAttribute('src'),alt=n.getAttribute('alt');
      if(src)out+='  src='+JSON.stringify(src.slice(0,200))+'\\n';
      if(alt)out+='  alt='+JSON.stringify(alt.slice(0,200))+'\\n';
    }
    if(tag==='a'){
      var href=n.getAttribute('href'),linkText=n.textContent.trim().slice(0,100);
      if(href)out+='  href='+JSON.stringify(href.slice(0,200))+'\\n';
      if(linkText)out+='  '+JSON.stringify(linkText)+'\\n';
    }
    for(var i=0;i<n.childNodes.length;i++)walk(n.childNodes[i],d+1);
    out+='</'+tag+'>\\n';
  }
  walk(document.body,0);
  return JSON.stringify({title:document.title||'',url:location.href,content:out.slice(0,maxLen)});
})()`

// 截图触发脚本：逐字对齐 Rust CAPTURE_TRIGGER_JS（html2canvas CDN 懒加载 → body 渲染为
// jpeg 0.65 dataURL 写入 window._amiba_screenshot；失败写 'ERROR:' 前缀串，原生侧轮询读取）
const CAPTURE_TRIGGER_JS: string = `(function(){
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
})()`

// click/input 交互整体超时兜底：对齐 Rust 桌面端 recv_timeout(12s)
// （脚本内部另有 10s/5s 自超时，正常路径不会触到本兜底）
const INTERACT_TIMEOUT_MS = 12000
// 截图轮询节奏：对齐 Rust web_capture_screenshot（500ms × 60 = 30s）
const SCREENSHOT_POLL_INTERVAL_MS = 500
const SCREENSHOT_POLL_COUNT = 60

// ---- JS 参数转义（对齐 Rust：先反斜杠后单引号，全局替换；input_text 额外转义换行）----
function escapeJsArg(s: string): string {
  // 对齐 Rust web_click: selector.replace('\\', "\\\\").replace('\'', "\\'")
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function escapeJsTextArg(s: string): string {
  // 对齐 Rust web_input_text: text 额外 .replace('\n', "\\n")
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')
}

// click 注入脚本：逐字对齐 Rust web_click format! 展开结果
// （完整鼠标事件序列 → requestSubmit/submit 表单兜底 → URL 轮询 + MutationObserver 等 DOM 稳定）
function buildClickJs(selector: string): string {
  const s = escapeJsArg(selector)
  return `(function(){
  var el=document.querySelector('${s}');
  if(!el) return 'not found: ${s}';
  var origUrl=location.href;

  // 派发完整鼠标事件序列
  ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(t){
    el.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window}));
  });

  // 表单提交：优先用 requestSubmit（W3C 标准，会触发 submit 事件+验证）
  var f=el.closest('form');
  var submitted=false;
  if(f){
    try{
      if(typeof f.requestSubmit==='function'){
        f.requestSubmit(el);  // 以该按钮为 submitter 提交
        submitted=true;
      }
    }catch(e){}
    if(!submitted){ try{ f.submit(); }catch(e){} }
    f.dispatchEvent(new SubmitEvent('submit',{submitter:el,bubbles:true,cancelable:true}));
  }

  return new Promise(function(resolve){
    var settled=false, timer;
    var done=function(msg){ if(!settled){ settled=true; clearInterval(urlCheck); observer.disconnect(); resolve(msg); } };
    var urlCheck=setInterval(function(){
      if(location.href!==origUrl) done('navigated: '+location.href);
    },200);
    var observer=new MutationObserver(function(){
      clearTimeout(timer);
      timer=setTimeout(function(){ done('stabilized'); },1500);
    });
    observer.observe(document.body,{childList:true,subtree:true,attributes:true});
    timer=setTimeout(function(){ done('stabilized'); },1500);
    setTimeout(function(){ done('stabilized (timeout)'); },10000);
  });
})()`
}

// input_text 注入脚本：逐字对齐 Rust web_input_text format! 展开结果
// （focus → React 兼容原生 setter 赋值 → input/keydown/keyup/change 事件序列 → MutationObserver 等稳定）
function buildInputTextJs(selector: string, text: string): string {
  const s = escapeJsArg(selector)
  const t = escapeJsTextArg(text)
  return `(function(){
  var el=document.querySelector('${s}');
  if(!el) return 'not found: ${s}';
  el.focus();
  el.dispatchEvent(new FocusEvent('focus',{bubbles:true}));
  // React 兼容：通过原生 setter 设置 value，触发 React 合成事件
  var nativeSetter=Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(el),'value'
  );
  if(nativeSetter&&nativeSetter.set){ nativeSetter.set.call(el,'${t}'); }
  else{ el.value='${t}'; }
  // 派发完整输入事件序列
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:''}));
  el.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:''}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
  return new Promise(function(resolve){
    var settled=false, timer;
    var done=function(){ if(!settled){ settled=true; observer.disconnect(); resolve('typed: '+el.value.length+' chars'); } };
    var observer=new MutationObserver(function(){
      clearTimeout(timer);
      timer=setTimeout(done,800);
    });
    observer.observe(document.body,{childList:true,subtree:true,attributes:true});
    timer=setTimeout(done,800);
    setTimeout(done,5000);
  });
})()`
}

// ---- 模块状态 ----
// 隐藏 WebView 控制器：由 Index.ets 隐藏 Web 组件 onControllerAttached 时注入
let hiddenController: webview.WebviewController | null = null
// 进行中的页面加载（串行队列保证同时最多一个非空）
let pendingLoad: PendingLoad | null = null
// 串行队列尾指针：WebView 路径同时只跑一个，后来的排队（对齐 Rust 单 WebView 复用语义）
let queueTail: Promise<null> = Promise.resolve(null)
let queueWaiting = 0
// 桥实例：由 Index.ets 注入（emitToWeb 推送 webview-screenshot）
let bridge: HarmonyBridge | null = null
// evalScript 哨兵变量序号（window.__amiba_eval_N 命名唯一化）
let evalSeq = 0

// ---- 会话注册表（对齐 Rust BrowserPool 结构）----
// 鸿蒙侧底层为单例隐藏 WebView（对齐 Rust 移动端 WebViewHelper 单 WebView 语义），
// Map 仅记录会话 id → 活跃标记以对齐 Rust 池结构：web_fetch(WebView) 成功即注册唯一会话，
// web_close(id) 删指定会话 / web_close(null) 清空全部，命中即重置隐藏 WebView。
const ACTIVE_SESSION_ID = 'amiba_browser_1'   // 命名对齐 Rust BrowserPool.next_id（amiba_browser_N）
const browserSessions = new Map<string, boolean>()

// ============================================================
// 初始化 / 页面事件注入（Index.ets 隐藏 Web 组件回调）
// ============================================================

export function initWebFetchController(controller: webview.WebviewController): void {
  hiddenController = controller
  console.log(`${TAG} ✓ 隐藏 WebView 控制器已注入`)
}

export function initWebFetchBridge(b: HarmonyBridge): void {
  bridge = b
  console.log(`${TAG} ✓ 桥已注入（webview-screenshot 事件推送）`)
}

// 隐藏 Web 的 onPageEnd：完成进行中的加载等待
export function notifyWebFetchPageEnd(pageUrl: string): void {
  const pending = pendingLoad
  if (pending === null) {
    return
  }
  clearTimeout(pending.timer)
  pendingLoad = null
  console.log(`${TAG} ✓ 页面加载完成: ${pageUrl}`)
  pending.resolve()
}

// 隐藏 Web 的 onErrorReceive：仅主资源失败视为致命（子资源错误不打断，对齐 Android WebViewHelper 主帧语义）
export function notifyWebFetchError(failedUrl: string, errInfo: string): void {
  const pending = pendingLoad
  if (pending === null) {
    console.warn(`${TAG} 空闲期资源加载错误（忽略）: ${failedUrl} ${errInfo}`)
    return
  }
  if (!sameUrl(failedUrl, pending.targetUrl)) {
    console.warn(`${TAG} 子资源加载错误（忽略）: ${failedUrl}`)
    return
  }
  clearTimeout(pending.timer)
  pendingLoad = null
  pending.reject(new Error(`WebView 加载失败: ${errInfo}`))
}

function sameUrl(a: string, b: string): boolean {
  const strip = (s: string): string => s.endsWith('/') ? s.substring(0, s.length - 1) : s
  return strip(a) === strip(b)
}

// ============================================================
// URL 安全校验（对齐 Rust is_safe_url：仅 http/https，禁 localhost/私网，错误文案一致）
// ============================================================
function checkSafeUrl(rawUrl: string): void {
  let parsed: urlUtil.URL
  try {
    parsed = urlUtil.URL.parseURL(rawUrl)
  } catch (e) {
    throw new Error(`Invalid URL: ${rawUrl}`)
  }
  const proto = parsed.protocol.toLowerCase()
  const scheme = proto.endsWith(':') ? proto.substring(0, proto.length - 1) : proto
  if (scheme !== 'http' && scheme !== 'https') {
    throw new Error(`Blocked protocol: ${scheme}`)
  }
  const host = parsed.hostname
  if (host.length === 0) {
    throw new Error(`Invalid URL: ${rawUrl}`)
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') {
    throw new Error('Blocked: localhost')
  }
  if (host.startsWith('10.') || host.startsWith('172.16.') ||
    host.startsWith('192.168.') || host.startsWith('0.')) {
    throw new Error('Blocked: private network')
  }
}

// ============================================================
// 串行队列（fetch / get_content / click / input_text 共享同一隐藏 WebView，
// 串行化避免 loadUrl 与 eval 交错；HTTP 直连无共享状态，无需排队）
// ============================================================
function enqueueWebTask<T>(task: () => Promise<T>): Promise<T> {
  if (queueWaiting > 0) {
    console.log(`${TAG} 前面有 ${queueWaiting} 个 web 任务在排队，等待串行执行`)
  }
  queueWaiting++
  const run = queueTail.then(() => {
    queueWaiting--
    return task()
  })
  queueTail = run.then((): null => null, (): null => null)
  return run
}

function enqueueWebFetch(task: () => Promise<FetchResultWire>): Promise<FetchResultWire> {
  return enqueueWebTask(task)
}

// ============================================================
// WebView 路径：loadUrl → 等 onPageEnd（15s 超时）→ runJavaScript 提取（10s 超时）
// ============================================================
function loadPageAndWait(ctl: webview.WebviewController, rawUrl: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingLoad !== null && pendingLoad.targetUrl === rawUrl) {
        pendingLoad = null
        reject(new Error('Page load timeout'))
      }
    }, PAGE_LOAD_TIMEOUT_MS)
    const pending: PendingLoad = {
      targetUrl: rawUrl,
      timer: timer,
      resolve: resolve,
      reject: reject
    }
    pendingLoad = pending
    try {
      ctl.loadUrl(rawUrl)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      clearTimeout(timer)
      pendingLoad = null
      reject(new Error(`navigate: ${msg}`))
    }
  })
}

async function evalWithTimeout(ctl: webview.WebviewController, script: string): Promise<string> {
  let timer = -1
  try {
    return await Promise.race([
      ctl.runJavaScript(script),
      new Promise<string>((resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error('eval: timeout'))
        }, JS_EVAL_TIMEOUT_MS)
      })
    ])
  } finally {
    if (timer >= 0) {
      clearTimeout(timer)
    }
  }
}

// 解析提取结果：runJavaScript 对字符串返回值有的桥实现会再包一层引号，解到对象为止（最多两层）
function parseExtractJson(json: string): Record<string, Object> | null {
  try {
    let v = JSON.parse(json) as Object
    if (typeof v === 'string') {
      v = JSON.parse(v as string) as Object
    }
    if (typeof v === 'object' && v !== null) {
      return v as Record<string, Object>
    }
  } catch (e) {
    // 落到 null 由调用方兜底
  }
  return null
}

async function fetchViaWebView(rawUrl: string): Promise<FetchResultWire> {
  const ctl = hiddenController
  if (ctl === null) {
    throw new Error('隐藏 WebView 未就绪')
  }
  await loadPageAndWait(ctl, rawUrl)
  const json = await evalWithTimeout(ctl, EXTRACT_JS)

  let title = ''
  let text = ''
  const v = parseExtractJson(json)
  if (v !== null) {
    const t = v['title']
    const x = v['text']
    title = typeof t === 'string' ? (t as string) : ''
    text = typeof x === 'string' ? (x as string) : ''
  } else {
    // 对齐 Rust Android/iOS 解析失败兜底：原始串进 text
    title = `[Harmony] ${rawUrl}`
    text = json
  }
  if (text.length > MAX_TEXT_LEN) {
    text = text.substring(0, MAX_TEXT_LEN)
  }
  // WebView 路径 raw 恒为空串、content_type 恒 text/html（对齐 Rust）
  const result: FetchResultWire = {
    url: rawUrl,
    title: title,
    text: text,
    raw: '',
    content_type: 'text/html'
  }
  // 注册浏览器会话（对齐 Rust BrowserPool.get_or_create_desktop 的会话建立时机）
  browserSessions.set(ACTIVE_SESSION_ID, true)
  return result
}

// ============================================================
// HTTP 降级路径（useWebview=false 或 WebView 失败）：对齐 Rust http_fetch
// ============================================================
function pickContentType(header: Object): string {
  const h = header as Record<string, Object>
  const keys = Object.keys(h)
  for (const k of keys) {
    if (k.toLowerCase() === 'content-type') {
      const v = h[k]
      if (typeof v === 'string') {
        return v as string
      }
      if (v instanceof Array) {
        const arr = v as Object[]
        if (arr.length > 0 && typeof arr[0] === 'string') {
          return arr[0] as string
        }
      }
    }
  }
  return 'unknown'   // Rust unwrap_or("unknown")
}

// 提取 <title>（对应 Rust extract_title；scraper 会解码实体，此处解码常见实体近似）
function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (m === null || m.length < 2) {
    return ''
  }
  return decodeEntities(m[1]).trim()
}

// 正文提取（对应 Rust extract_text）：剔除 script/style/nav/footer/header/noscript/svg/iframe（含内容），
// 去注释、剥所有标签后按行 trim、滤空行、'\n' 连接（scraper text() 语义的简化近似）
function extractText(html: string): string {
  let s = html.replace(/<(script|style|nav|footer|header|noscript|svg|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
  s = s.replace(/<!--[\s\S]*?-->/g, ' ')
  s = s.replace(/<[^>]+>/g, '\n')
  s = decodeEntities(s)
  const lines = s.split('\n')
  const kept: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (t.length > 0) {
      kept.push(t)
    }
  }
  return kept.join('\n')
}

// 常见 HTML 实体解码（&amp; 最后替换避免二次解码）
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
}

function destroyQuietly(req: http.HttpRequest): void {
  try {
    req.destroy()
  } catch (e) {
    // 已销毁/已结束：忽略
  }
}

async function fetchViaHttp(rawUrl: string): Promise<FetchResultWire> {
  const req = http.createHttp()
  try {
    const header: Record<string, string> = { 'User-Agent': HTTP_UA }
    const opts: http.HttpRequestOptions = {
      method: http.RequestMethod.GET,
      header: header,
      connectTimeout: HTTP_TIMEOUT_MS,
      readTimeout: HTTP_TIMEOUT_MS,
      expectDataType: http.HttpDataType.STRING
    }
    const resp = await req.request(rawUrl, opts)
    // Rust http_fetch 不校验状态码，原样读 body——此处对齐
    let body: string
    if (typeof resp.result === 'string') {
      body = resp.result as string
    } else if (resp.result instanceof ArrayBuffer) {
      body = util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(resp.result))
    } else {
      body = ''
    }
    const ct = pickContentType(resp.header)
    if (body.length > MAX_RAW_LEN) {
      body = body.substring(0, MAX_RAW_LEN)
    }
    const title = extractTitle(body)
    let text = extractText(body)
    if (text.length > MAX_TEXT_LEN) {
      text = text.substring(0, MAX_TEXT_LEN)
    }
    const result: FetchResultWire = {
      url: rawUrl,
      title: title,
      text: text,
      raw: body,
      content_type: ct
    }
    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`Request failed: ${msg}`)
  } finally {
    destroyQuietly(req)
  }
}

// ============================================================
// web_fetch：useWebview（默认 true，对齐 Rust use_webview.unwrap_or(true)）
// WebView 路径失败（加载错误/超时/提取异常）自动降级 HTTP 直连
// ============================================================
async function cmdWebFetch(args: Record<string, Object>): Promise<FetchResultWire> {
  const rawUrl = reqStr(args['url'], 'url')
  const useWebview = optBool(args['useWebview'], true)
  checkSafeUrl(rawUrl)

  if (useWebview) {
    if (hiddenController === null) {
      console.warn(`${TAG} 隐藏 WebView 未就绪，直接走 HTTP 直连`)
    } else {
      try {
        console.log(`${TAG} === web_fetch(WebView): ${rawUrl} ===`)
        const r = await enqueueWebFetch(() => fetchViaWebView(rawUrl))
        console.log(`${TAG} ✓ web_fetch(WebView): title="${r.title}" text=${r.text.length}字`)
        return r
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.warn(`${TAG} ✗ WebView 路径失败（${msg}），降级 HTTP 直连`)
      }
    }
  }

  console.log(`${TAG} === web_fetch(HTTP): ${rawUrl} ===`)
  const r = await fetchViaHttp(rawUrl)
  console.log(`${TAG} ✓ web_fetch(HTTP): content_type=${r.content_type} raw=${r.raw.length}B text=${r.text.length}字`)
  return r
}

// ============================================================
// JS 求值机制（get_content / click / input_text 共用）
// ============================================================
// ArkWeb runJavaScript 不等待 JS Promise（语义同 Android evaluateJavascript），而 Rust 的
// click/input 脚本返回 Promise——统一包一层：同步结果立即返回；Promise 结果（或异常）
// 写入 window 哨兵变量，原生侧 200ms 轮询读取。模式对齐 Rust 桌面端截图轮询
// （window._amiba_screenshot）；页面中途导航导致哨兵丢失时兜底返回 'timeout'
// （对齐 Rust 桌面端 recv_timeout 12s 兜底 "timeout"）。

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve()
    }, ms)
  })
}

// runJavaScript 对字符串结果可能再包一层 JSON 引号（桥实现相关），逐层解到非字符串为止（最多 3 层）
function unwrapBridgeString(raw: string): string {
  let cur = raw
  for (let i = 0; i < 3; i++) {
    try {
      const v = JSON.parse(cur) as Object
      if (typeof v === 'string') {
        cur = v as string
        continue
      }
    } catch (e) {
      // 非 JSON：已到最内层
    }
    break
  }
  return cur
}

// 从求值包装层产出（{"v":...} JSON 或原文）中提取最终结果串
function extractOutcomeValue(outcome: string): string {
  try {
    const v = JSON.parse(outcome) as Record<string, Object>
    const val = v['v']
    if (typeof val === 'string') {
      return val as string
    }
  } catch (e) {
    // 非包装 JSON：原文返回
  }
  return outcome
}

function clearEvalKey(ctl: webview.WebviewController, key: string): void {
  try {
    ctl.runJavaScript(`delete window[${JSON.stringify(key)}]`)
  } catch (e) {
    // 页面已导航/销毁：忽略
  }
}

async function evalScript(ctl: webview.WebviewController, script: string, pollTimeoutMs: number): Promise<string> {
  const key = `__amiba_eval_${++evalSeq}`
  const keyJson = JSON.stringify(key)
  // 包装层：同步结果 → JSON.stringify({v}) 立即返回；Promise → then/catch 写哨兵后返回 'PENDING'
  const wrapped: string =
    `(function(){var K=${keyJson};try{window[K]=null;var __r=(${script});` +
    `if(__r&&typeof __r.then==='function'){` +
    `__r.then(function(v){window[K]=JSON.stringify({v:String(v)})},` +
    `function(e){window[K]=JSON.stringify({v:'error: '+(e&&e.message?e.message:String(e))})});` +
    `return 'PENDING'}` +
    `return JSON.stringify({v:String(__r)})` +
    `}catch(e){return JSON.stringify({v:'error: '+(e&&e.message?e.message:String(e))})}})()`
  const first = unwrapBridgeString(await evalWithTimeout(ctl, wrapped))
  if (first !== 'PENDING') {
    return extractOutcomeValue(first)
  }
  const pollJs: string =
    `(function(){var v=window[${keyJson}];` +
    `return (v===null||v===undefined)?'PENDING':String(v)})()`
  const deadline = Date.now() + pollTimeoutMs
  while (Date.now() < deadline) {
    await sleep(200)
    const cur = unwrapBridgeString(await ctl.runJavaScript(pollJs))
    if (cur !== 'PENDING' && cur !== 'null' && cur.length > 0) {
      clearEvalKey(ctl, key)
      return extractOutcomeValue(cur)
    }
  }
  clearEvalKey(ctl, key)
  return 'timeout'   // 对齐 Rust 桌面端 recv_timeout 兜底 "timeout"
}

// ============================================================
// web_get_content / web_click / web_input_text（Rust 移动端语义：直接作用于单例隐藏 WebView）
// ============================================================
function requireBrowseController(): webview.WebviewController {
  const ctl = hiddenController
  if (ctl === null) {
    throw new Error('No active browser session. Call web_fetch first.')   // 错误文案对齐 Rust web_eval
  }
  return ctl
}

async function cmdWebGetContent(): Promise<EvalResultWire> {
  const ctl = requireBrowseController()
  console.log(`${BROWSE_TAG} === web_get_content ===`)
  const result = await enqueueWebTask(() => evalScript(ctl, GET_CONTENT_JS, JS_EVAL_TIMEOUT_MS))
  console.log(`${BROWSE_TAG} ✓ web_get_content: ${result.length} 字`)
  const r: EvalResultWire = { result: result }
  return r
}

async function cmdWebClick(args: Record<string, Object>): Promise<EvalResultWire> {
  const selector = reqStr(args['selector'], 'selector')
  const ctl = requireBrowseController()
  console.log(`${BROWSE_TAG} === web_click: ${selector} ===`)
  const result = await enqueueWebTask(() => evalScript(ctl, buildClickJs(selector), INTERACT_TIMEOUT_MS))
  console.log(`${BROWSE_TAG} ✓ web_click: ${result}`)
  const r: EvalResultWire = { result: result }
  return r
}

async function cmdWebInputText(args: Record<string, Object>): Promise<EvalResultWire> {
  const selector = reqStr(args['selector'], 'selector')
  const text = optStr(args['text']) ?? ''   // Rust 允许空文本（仅前端工具层要求非空）
  const ctl = requireBrowseController()
  console.log(`${BROWSE_TAG} === web_input_text: ${selector}（${text.length} 字）===`)
  const result = await enqueueWebTask(() => evalScript(ctl, buildInputTextJs(selector, text), INTERACT_TIMEOUT_MS))
  console.log(`${BROWSE_TAG} ✓ web_input_text: ${result}`)
  const r: EvalResultWire = { result: result }
  return r
}

// ============================================================
// web_close：关闭浏览器会话（可选 sessionId，不传关所有——对齐 Rust web_close）
// 鸿蒙侧单例隐藏 WebView：命中会话即重置（对齐 Rust 桌面端关窗 / Android WebViewHelper.close）
// ============================================================
function cmdWebClose(args: Record<string, Object>): null {
  const sessionId = optStr(args['sessionId'])
  if (sessionId !== null) {
    if (!browserSessions.delete(sessionId)) {
      console.log(`${BROWSE_TAG} web_close: 会话 ${sessionId} 不存在（忽略，对齐 Rust pool.remove 未知 id no-op）`)
      return null
    }
    console.log(`${BROWSE_TAG} === web_close: ${sessionId} ===`)
  } else {
    console.log(`${BROWSE_TAG} === web_close: 全部会话（${browserSessions.size} 个）===`)
    browserSessions.clear()
  }
  resetHiddenWebView()
  return null
}

function resetHiddenWebView(): void {
  const ctl = hiddenController
  if (ctl === null) {
    console.warn(`${BROWSE_TAG} 隐藏 WebView 未就绪，跳过重置`)
    return
  }
  // 中止进行中的页面加载等待（进行中的 web_fetch 会抛错并走 HTTP 降级，对齐销毁语义）
  const pending = pendingLoad
  if (pending !== null) {
    clearTimeout(pending.timer)
    pendingLoad = null
    pending.reject(new Error('web_close: 浏览器会话已关闭'))
  }
  try {
    ctl.stop()
    ctl.loadUrl('about:blank')
    console.log(`${BROWSE_TAG} ✓ 隐藏 WebView 已重置（about:blank）`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`${BROWSE_TAG} ✗ 重置隐藏 WebView 失败: ${msg}`)
  }
}

// ============================================================
// web_capture_screenshot：fire-and-forget（invoke 立即返回 null），
// 后台协程注入 CAPTURE_TRIGGER_JS 并轮询 window._amiba_screenshot（500ms × 60），
// 结果经 webview-screenshot 事件推送（载荷为裸字符串：dataURL 或 'ERROR:' 前缀串，对齐 Rust emit）
// ============================================================
function cmdWebCaptureScreenshot(): null {
  const ctl = hiddenController
  if (ctl === null) {
    console.warn(`${BROWSE_TAG} web_capture_screenshot: 无活跃浏览器会话（忽略，对齐 Rust 移动端 no-op）`)
    return null
  }
  console.log(`${BROWSE_TAG} === web_capture_screenshot（fire-and-forget）===`)
  captureScreenshotAsync(ctl).catch((e: Error) => {
    console.error(`${BROWSE_TAG} ✗ 截图流程异常: ${e.message}`)
  })
  return null
}

async function captureScreenshotAsync(ctl: webview.WebviewController): Promise<void> {
  // Step 1: 清空旧结果，注入截图触发脚本（对齐 Rust Step 1）
  await ctl.runJavaScript("window._amiba_screenshot='';")
  await ctl.runJavaScript(CAPTURE_TRIGGER_JS)
  // Step 2: 轮询读取结果（对齐 Rust：500ms × 60 轮询，超时仅记日志不推送）
  for (let i = 0; i < SCREENSHOT_POLL_COUNT; i++) {
    await sleep(SCREENSHOT_POLL_INTERVAL_MS)
    const val = unwrapBridgeString(await ctl.runJavaScript("window._amiba_screenshot||''"))
    if (val.length > 0 && val !== 'null') {
      emitScreenshot(val)
      return
    }
  }
  console.error(`${BROWSE_TAG} ✗ 截图轮询超时（30s）`)
}

function emitScreenshot(payload: string): void {
  const b = bridge
  if (b === null) {
    console.error(`${BROWSE_TAG} ✗ 桥未注入，无法推送 webview-screenshot`)
    return
  }
  if (payload.startsWith('ERROR:')) {
    console.error(`${BROWSE_TAG} ✗ 截图失败: ${payload}`)
  } else {
    console.log(`${BROWSE_TAG} ✓ 截图完成（${payload.length} 字），推送 webview-screenshot`)
  }
  b.emitToWeb('webview-screenshot', payload)
}

// ---- 参数提取（风格同 HttpCommands）----
function reqStr(v: Object | undefined, name: string): string {
  if (typeof v !== 'string' || (v as string).length === 0) {
    throw new Error(`缺少参数: ${name}`)
  }
  return v as string
}

function optStr(v: Object | undefined): string | null {
  return typeof v === 'string' && (v as string).length > 0 ? (v as string) : null
}

function optBool(v: Object | undefined, dft: boolean): boolean {
  return typeof v === 'boolean' ? (v as boolean) : dft
}

// ---- 命令入口 ----
export async function handleWebFetchCommand(cmd: string, args: Record<string, Object>): Promise<Object | null> {
  try {
    switch (cmd) {
      case 'web_fetch':
        return await cmdWebFetch(args)
      case 'web_get_content':
        return await cmdWebGetContent()
      case 'web_click':
        return await cmdWebClick(args)
      case 'web_input_text':
        return await cmdWebInputText(args)
      case 'web_close':
        return cmdWebClose(args)
      case 'web_capture_screenshot':
        return cmdWebCaptureScreenshot()
      default:
        throw new Error(`未知 web 命令: ${cmd}`)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`${TAG} ✗ ${cmd} 失败: ${msg}`)
    // ArkTS 限制 throw 只能抛 Error：统一重抛 Error 实例
    throw new Error(msg)
  }
}
