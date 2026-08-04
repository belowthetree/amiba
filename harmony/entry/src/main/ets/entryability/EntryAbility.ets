import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit'
import { window } from '@kit.ArkUI'
import { initFsDirs } from '../bridge/FsCommands'

const TAG = '[AmibaShell]'

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    console.log(`${TAG} === onCreate ===`)
    // 初始化 fs 桥沙箱根目录（filesDir/cacheDir）
    initFsDirs(this.context)
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    // 默认非全屏布局：系统栏不占内容区，与 Android 端 setupWindowInsets 的 padding 语义一致。
    // 软键盘避让依赖 ArkUI 默认的 IME 自适应，真机验证见 README「PoC 真机验证清单」。
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        console.error(`${TAG} ✗ loadContent 失败: ${JSON.stringify(err)}`)
        return
      }
      console.log(`${TAG} ✓ loadContent 成功`)
    })
  }

  onDestroy(): void {
    console.log(`${TAG} === onDestroy ===`)
  }
}
