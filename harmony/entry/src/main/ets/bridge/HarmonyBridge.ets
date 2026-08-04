import { webview } from '@kit.ArkWeb'
import { dispatchCommand } from './Dispatcher'

const TAG = '[AmibaBridge]'

// 经 javaScriptProxy 注入为 ArkWeb window.__AMIBA_HARMONY__ 的桥对象。
// 协议与 src/config/platform-bridge.ts 一一对应：
//   H5 → 原生：await __AMIBA_HARMONY__.invoke(cmd, argsJson) → 返回 JSON 字符串
//   原生 → H5：emitToWeb() 经 runJavaScript 调 window.__amiba_harmony_emit__(event, payloadJson)
export class HarmonyBridge {
  private controller: webview.WebviewController | null = null

  attachController(controller: webview.WebviewController): void {
    this.controller = controller
  }

  // H5 → 原生命令入口（javaScriptProxy methodList 声明）。
  // 抛出异常时 H5 侧 Promise 被 reject——各平台桥调用方均有 try/catch 降级。
  async invoke(cmd: string, argsJson: string): Promise<string> {
    console.log(`${TAG} invoke: ${cmd}`)
    try {
      const result = await dispatchCommand(cmd, argsJson)
      return JSON.stringify(result ?? null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`${TAG} ✗ ${cmd} 失败: ${msg}`)
      throw new Error(msg)
    }
  }

  // 原生 → H5 事件推送（network:* / download-progress / webview-screenshot 等）
  emitToWeb(event: string, payload: Object): void {
    const ctl = this.controller
    if (!ctl) {
      console.warn(`${TAG} 事件推送时 Web 未就绪: ${event}`)
      return
    }
    // 双重 stringify：外层是 JS 字符串字面量，内层是载荷 JSON（__amiba_harmony_emit__ 内再 parse）
    const js = `window.__amiba_harmony_emit__ && window.__amiba_harmony_emit__(${JSON.stringify(event)}, ${JSON.stringify(JSON.stringify(payload))})`
    ctl.runJavaScript(js)
  }
}
