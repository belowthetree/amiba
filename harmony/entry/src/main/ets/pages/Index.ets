import { webview } from '@kit.ArkWeb'
import { HarmonyBridge } from '../bridge/HarmonyBridge'
import { initHttpBridge } from '../bridge/HttpCommands'
import { initNetworkBridge } from '../bridge/NetworkCommands'
import { initWebFetchController, initWebFetchBridge, notifyWebFetchPageEnd, notifyWebFetchError } from '../bridge/WebFetchCommands'
import { pickFilesForWeb } from '../bridge/PickerCommands'
import { initDownloadBridge, createDownloadDelegate } from '../bridge/WebDownloadDelegate'
import { initFormBridge } from '../bridge/FormCommands'
import { AMIBA_HOST, AMIBA_SCHEME, createRawfileSchemeHandler } from '../bridge/RawfileScheme'

const TAG = '[AmibaShell]'
const WEB_TAG = '[AmibaWeb]'
const DL_TAG = '[AmibaDownload]'

// ArkWeb 容器页：加载主仓前端产物（amiba://local/index.html → rawfile 根，
// 与 Tauri 自定义协议根布局一致，/assets、/libs 等绝对路径直接生效），
// 注入 javaScriptProxy 桥对象 window.__AMIBA_HARMONY__（H5 侧见 src/config/platform-bridge.ts）
@Entry
@Component
struct Index {
  private controller: webview.WebviewController = new webview.WebviewController()
  private bridge: HarmonyBridge = new HarmonyBridge()
  // web_fetch 专用的隐藏 WebView 控制器（JS 渲染抓取，见 bridge/WebFetchCommands.ets）
  private fetchController: webview.WebviewController = new webview.WebviewController()
  // 安全区（px，EntryAbility 经 avoidAreaChange 同步；@StorageProp 驱动根 Stack padding）
  @StorageProp('avoidTopPx') avoidTopPx: number = 0
  @StorageProp('avoidBottomPx') avoidBottomPx: number = 0
  @StorageProp('avoidKeyboardPx') avoidKeyboardPx: number = 0

  aboutToAppear(): void {
    this.bridge.attachController(this.controller)
    // 注入桥实例供 HttpCommands 推送 download-progress 事件
    initHttpBridge(this.bridge)
    // 注入桥实例供 WebFetchCommands 推送 webview-screenshot 事件（web_capture_screenshot）
    initWebFetchBridge(this.bridge)
    // 注入桥实例供 WebDownloadDelegate 推送 download-complete 事件
    initDownloadBridge(this.bridge)
    // 注入桥实例供 NetworkCommands 推送 network:* 事件（UDP 发现/WS 会话）
    initNetworkBridge(this.bridge)
    // 注入桥实例供 FormCommands 推送 amiba-widget-navigate 事件（桌面卡片点击热通道）
    initFormBridge(this.bridge)
    // 开发期打开 ArkWeb CDP 远程调试（chrome://inspect 经 hdc fport 连接；上架前关闭）
    webview.WebviewController.setWebDebuggingAccess(true)
    console.log(`${TAG} ArkWeb 容器初始化`)
  }

  // 返回键优先回退 Web 历史（服务页/路由在 Web 层），无历史时退出
  onBackPress(): boolean {
    if (this.controller.accessStep(-1)) {
      this.controller.backward()
      return true
    }
    return false
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      // 注意 src 用 '/' 而非 '/index.html'：vue-router createWebHistory 按 pathname 匹配路由，
      // '/index.html' 无路由可配 → RouterView 空白（真机踩坑）；'/' 匹配聊天页，
      // RawfileScheme.urlToRawfilePath 会把空路径映射到 index.html
      Web({ src: `${AMIBA_SCHEME}://${AMIBA_HOST}/`, controller: this.controller })
        // 控制器与 Web 组件绑定完成的时机点：注册自定义协议处理器（aboutToAppear 里调会崩：
        // WebviewController must be associated with a Web component）
        .onControllerAttached(() => {
          this.controller.setWebSchemeHandler(AMIBA_SCHEME, createRawfileSchemeHandler())
          console.log(`${TAG} ✓ WebSchemeHandler 已注册`)
          // 下载代理：<a download> 导出落盘 ${filesDir}/amiba/downloads/（WebDownloadDelegate.ets）。
          // setDownloadDelegate 需 API 18+，失败降级为仅 onDownloadStart 日志
          try {
            this.controller.setDownloadDelegate(createDownloadDelegate())
            console.log(`${TAG} ✓ WebDownloadDelegate 已注册`)
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            console.error(`${TAG} ✗ 下载代理注册失败（需 API 18+，下载落盘不可用）: ${msg}`)
          }
        })
        .javaScriptAccess(true)
        .domStorageAccess(true)          // 服务沙箱 localStorage 依赖
        .fileAccess(true)                // srcdoc iframe / 本地资源
        .onlineImageAccess(true)
        .javaScriptProxy({
          object: this.bridge,
          name: '__AMIBA_HARMONY__',
          methodList: ['invoke'],
          controller: this.controller
        })
        // <input type=file>（技能 ZIP 导入、图片选择等）：DocumentViewPicker 选文件 →
        // 拷入沙箱 amiba/uploads/ → file:// URI 列表回传（详见 PickerCommands.pickFilesForWeb 注释）
        .onShowFileSelector((event) => {
          if (!event) {
            return false
          }
          const param = event.fileSelector
          console.log(`${TAG} === onShowFileSelector: mode=${param.getMode()} accept=[${param.getAcceptType().join(',')}] capture=${param.isCapture()} ===`)
          pickFilesForWeb(param.getAcceptType(), param.getMode(), param.isCapture())
            .then((uris: string[]) => {
              event.result.handleFileList(uris)
            })
            .catch((e: Error) => {
              console.error(`${TAG} ✗ 文件选择失败: ${e.message}`)
              event.result.handleFileList([])
            })
          return true
        })
        // 下载触发元数据日志（载荷无 WebDownloadItem，落盘由 WebDownloadDelegate 接管；
        // data: URL 下载 ArkWeb 不保证触发本事件，不支持）
        .onDownloadStart((event) => {
          if (event) {
            console.log(`${DL_TAG} onDownloadStart: url=${event.url} mime=${event.mimetype} len=${event.contentLength} disposition=${event.contentDisposition}`)
          }
        })
        .onPageBegin((event) => {
          console.log(`${TAG} === onPageBegin: ${event?.url} ===`)
        })
        .onPageEnd((event) => {
          console.log(`${TAG} ✓ onPageEnd: ${event?.url}`)
        })
        .onErrorReceive((event) => {
          console.error(`${TAG} ✗ ArkWeb 加载错误: ${event?.error.getErrorInfo()} url=${event?.request.getRequestUrl()}`)
        })
        // 前端 console.* 转发到原生日志（Log 窗口过滤 AmibaWeb）
        .onConsole((event) => {
          if (event) {
            const m = event.message
            console.log(`${WEB_TAG} ${m.getMessage()} (${m.getSourceId()}:${m.getLineNumber()})`)
          }
          return false
        })
        .width('100%')
        .height('100%')

      // 隐藏 Web：web 引擎的 JS 渲染/交互载体（web_fetch 抓取 + click/input/get_content/截图）。
      // 必须留在布局树中才会加载/执行 JS——用 480vp×360vp + opacity(0) 保持占位：
      // 尺寸对齐 Rust 桌面端隐藏窗口（480x360），截图/页面布局需要真实视口；
      // 不用 Visibility.Hidden/None（组件可能完全不渲染、加载不触发）；
      // hitTestBehavior(None) 使占位不拦截触摸；固定宽高，根 Stack padding 变化不影响其布局
      Web({ src: 'about:blank', controller: this.fetchController })
        .onControllerAttached(() => {
          initWebFetchController(this.fetchController)
          console.log(`${TAG} ✓ 隐藏 Web 已挂载（web 引擎）`)
        })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .onPageEnd((event) => {
          notifyWebFetchPageEnd(event?.url ?? '')
        })
        .onErrorReceive((event) => {
          if (event) {
            notifyWebFetchError(event.request.getRequestUrl(), event.error.getErrorInfo())
          }
        })
        .hitTestBehavior(HitTestMode.None)
        .opacity(0)
        .width(480)
        .height(360)
    }
    .width('100%')
    .height('100%')
    // edge-to-edge 手动安全区 padding（EntryAbility avoidAreaChange → AppStorage 同步 px）：
    // 顶部=状态栏；底部=手势条与键盘取 max（键盘 avoidArea 含手势条区，键盘隐藏时为 0）。
    // 键盘弹起时 padding 增大压缩 Web 视口高度——聊天输入框随键盘上移（resize 语义，
    // 对齐 Android setupWindowInsets 的 IME padding）；px→vp 走 UIContext（全局 px2vp 已弃用）
    .padding({
      top: this.getUIContext().px2vp(this.avoidTopPx),
      bottom: Math.max(this.getUIContext().px2vp(this.avoidBottomPx), this.getUIContext().px2vp(this.avoidKeyboardPx))
    })
  }
}
