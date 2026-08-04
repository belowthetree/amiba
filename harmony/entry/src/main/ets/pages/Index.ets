import { webview } from '@kit.ArkWeb'
import { HarmonyBridge } from '../bridge/HarmonyBridge'

const TAG = '[AmibaShell]'

// ArkWeb 容器页：加载主仓前端产物（resource://rawfile/dist/index.html），
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
      Web({ src: 'resource://rawfile/dist/index.html', controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)          // 服务沙箱 localStorage 依赖
        .fileAccess(true)                // srcdoc iframe / rawfile 资源
        .onlineImageAccess(true)
        .javaScriptProxy({
          object: this.bridge,
          name: '__AMIBA_HARMONY__',
          methodList: ['invoke'],
          controller: this.controller
        })
        .onPageEnd(() => {
          console.log(`${TAG} ✓ ArkWeb 页面加载完成`)
        })
        .onErrorReceive((event) => {
          console.error(`${TAG} ✗ ArkWeb 加载错误: ${event?.error.getErrorInfo()}`)
        })
        .width('100%')
        .height('100%')
    }
    .width('100%')
    .height('100%')
  }
}
