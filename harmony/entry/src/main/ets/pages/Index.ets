import { webview } from '@kit.ArkWeb'
import { HarmonyBridge } from '../bridge/HarmonyBridge'
import { AMIBA_HOST, AMIBA_SCHEME, createRawfileSchemeHandler } from '../bridge/RawfileScheme'

const TAG = '[AmibaShell]'
const WEB_TAG = '[AmibaWeb]'

// ArkWeb 容器页：加载主仓前端产物（amiba://local/index.html → rawfile 根，
// 与 Tauri 自定义协议根布局一致，/assets、/libs 等绝对路径直接生效），
// 注入 javaScriptProxy 桥对象 window.__AMIBA_HARMONY__（H5 侧见 src/config/platform-bridge.ts）
@Entry
@Component
struct Index {
  private controller: webview.WebviewController = new webview.WebviewController()
  private bridge: HarmonyBridge = new HarmonyBridge()

  aboutToAppear(): void {
    this.bridge.attachController(this.controller)
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
    Column() {
      Web({ src: `${AMIBA_SCHEME}://${AMIBA_HOST}/index.html`, controller: this.controller })
        // 控制器与 Web 组件绑定完成的时机点：注册自定义协议处理器（aboutToAppear 里调会崩：
        // WebviewController must be associated with a Web component）
        .onControllerAttached(() => {
          this.controller.setWebSchemeHandler(AMIBA_SCHEME, createRawfileSchemeHandler())
          console.log(`${TAG} ✓ WebSchemeHandler 已注册`)
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
    }
    .width('100%')
    .height('100%')
  }
}
