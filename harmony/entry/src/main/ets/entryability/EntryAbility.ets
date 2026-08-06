import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit'
import { window, KeyboardAvoidMode } from '@kit.ArkUI'
import { webview } from '@kit.ArkWeb'
import { initFsDirs } from '../bridge/FsCommands'
import { initDb } from '../bridge/DbCommands'
import { initPickerContext, initPickerUiContext } from '../bridge/PickerCommands'
import { initNetworkContext } from '../bridge/NetworkCommands'
import { initFormDirs, handleHotTap } from '../bridge/FormCommands'
import { recordTap } from '../bridge/FormStore'
import { AMIBA_SCHEME, initRawfileContext } from '../bridge/RawfileScheme'

const TAG = '[AmibaShell]'

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    console.log(`${TAG} === onCreate ===`)
    // 初始化 fs 桥沙箱根目录（filesDir/cacheDir）
    initFsDirs(this.context)
    initRawfileContext(this.context)
    // 初始化会话库（relationalStore，对应 Tauri db.rs；内部捕获异常，失败时命令报「会话库未初始化」）
    initDb(this.context)
    // 注入文件夹选取器上下文（DocumentViewPicker 需要 UIAbilityContext；PickerCommands.ets）
    initPickerContext(this.context)
    // 装载网络模块设备身份（device_id 落盘复用 + device_name；NetworkCommands.ets）
    initNetworkContext(this.context)
    // 初始化桌面卡片数据目录（amiba-form/；FormStore.ets）
    initFormDirs(this.context.filesDir)
    // 卡片点击冷通道：postCardAction router 拉起本 ability，want.params 带 tapPath
    // （对齐 Android MainActivity onCreate 读 widget_tap_path 暂存，前端启动后经
    // form_widget_consume_tap 消费）
    this.handleWidgetTap(want, false)
    // 注册自定义协议（须在 Web 引擎初始化前）：amiba://local/* → rawfile 离线包（RawfileScheme.ets）
    const scheme: webview.WebCustomScheme = {
      schemeName: AMIBA_SCHEME,
      isSupportCORS: true,
      isSupportFetch: true,
      isStandard: true
    }
    webview.WebviewController.customizeSchemes([scheme])
  }

  onNewWant(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    // 卡片点击热通道：App 已在前台/后台存活时被 router 拉起，
    // 经 emitToWeb 推 amiba-widget-navigate（事件名对齐 Android 热通道）
    console.log(`${TAG} === onNewWant ===`)
    this.handleWidgetTap(want, true)
  }

  // 解析卡片点击 want 参数：tapPath 以 '/' 开头的应用内跳转路径才有效
  private handleWidgetTap(want: Want, hot: boolean): void {
    const params = want.parameters
    if (!params) {
      return
    }
    const path = params['tapPath']
    if (typeof path !== 'string' || !path.startsWith('/')) {
      return
    }
    console.log(`${TAG} === 桌面卡片点击(${hot ? '热' : '冷'}): ${path} ===`)
    if (hot) {
      handleHotTap(path)
    } else {
      recordTap(path)
    }
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    // edge-to-edge（docs/harmonyos-migration.md §5.7）：全屏沉浸式布局，系统栏/手势条/键盘避让
    // 由 Index 页面根 Stack 的手动 padding 承担（不用 expandSafeArea——选官方推荐的
    // 「avoidArea → AppStorage → 页面 @StorageProp padding」链路，padding 值语义与
    // Android setupWindowInsets 的 systemBars/IME padding 一一对应）
    const win = windowStage.getMainWindowSync()
    win.setWindowLayoutFullScreen(true).then(() => {
      console.log(`${TAG} ✓ 沉浸式全屏布局已开启`)
    }).catch((e: Error) => {
      console.error(`${TAG} ✗ setWindowLayoutFullScreen 失败: ${e.message}`)
    })
    this.syncAvoidAreas(win, 'init')
    win.on('avoidAreaChange', (opts: window.AvoidAreaOptions) => {
      this.syncAvoidAreas(win, `type=${opts.type}`)
    })

    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        console.error(`${TAG} ✗ loadContent 失败: ${JSON.stringify(err)}`)
        return
      }
      console.log(`${TAG} ✓ loadContent 成功`)
      // 关闭 ArkUI 默认键盘 OFFSET 避让（默认会把整页平移上移，与手动 padding 叠加成双倍位移）；
      // 键盘高度经 TYPE_KEYBOARD avoidArea 同步为底部 padding（resize 语义）。
      // 注意必须在 loadContent 之后调用：此前 UIContent 未创建，getUIContext 抛 1300002
      try {
        const uiContext = win.getUIContext()
        uiContext.setKeyboardAvoidMode(KeyboardAvoidMode.NONE)
        // 注入 picker UI 线程上下文（file_access_pick_folder 经 runScopedTask 切 UI 线程拉起）
        initPickerUiContext(uiContext)
      } catch (e) {
        console.error(`${TAG} ✗ setKeyboardAvoidMode/UIContext 注入失败: ${(e as Error).message}`)
      }
    })
  }

  // 安全区同步（px 值写入 AppStorage，Index.ets 经 @StorageProp + px2vp 转 vp 后作根 Stack padding）：
  // TYPE_SYSTEM → 状态栏（top）；TYPE_NAVIGATION_INDICATOR → 底部手势条（bottom）；
  // TYPE_KEYBOARD → 软键盘（bottom，隐藏时为 0，与手势条高度取 max）
  private syncAvoidAreas(win: window.Window, reason: string): void {
    const sys = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM)
    const nav = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR)
    const kb = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_KEYBOARD)
    AppStorage.setOrCreate('avoidTopPx', sys.topRect.height)
    AppStorage.setOrCreate('avoidBottomPx', nav.bottomRect.height)
    AppStorage.setOrCreate('avoidKeyboardPx', kb.bottomRect.height)
    console.log(`${TAG} 安全区同步(${reason}): top=${sys.topRect.height} nav=${nav.bottomRect.height} kb=${kb.bottomRect.height}`)
  }

  onDestroy(): void {
    console.log(`${TAG} === onDestroy ===`)
  }
}
