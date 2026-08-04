// ==== 平台桥：统一宿主探测与原生通道分发 ====
// 三种宿主：
//   tauri   — 桌面 / Android（Tauri 运行时，window.__TAURI_INTERNALS__ 由运行时注入）
//   harmony — 鸿蒙 ArkTS 壳（ArkWeb javaScriptProxy 注入 window.__AMIBA_HARMONY__）
//   browser — 纯浏览器（原生能力不可用，各调用方自行降级，与既有行为一致）
//
// 约束：业务代码禁止直接 import '@tauri-apps/api/core' / '@tauri-apps/api/event'，
// invoke / listen 一律经本模块；文件系统访问经 native-fs.ts。
// 协议注册表见 src/types/native-bridge.ts，迁移方案见 docs/harmonyos-migration.md。

export type HostPlatform = 'tauri' | 'harmony' | 'browser'

import { APP_COMMANDS } from '../types/native-bridge'

// 鸿蒙壳经 javaScriptProxy 注入的桥对象（ArkTS 侧 HarmonyBridge 类）
interface HarmonyJsBridge {
  invoke(cmd: string, argsJson: string): Promise<string>
}

declare global {
  interface Window {
    __AMIBA_HARMONY__?: HarmonyJsBridge
    __amiba_harmony_emit__?: (event: string, payloadJson: string) => void
  }
}

export function detectHost(): HostPlatform {
  if (typeof window !== 'undefined' && window.__AMIBA_HARMONY__) return 'harmony'
  // Tauri v2 运行时恒注入 __TAURI_INTERNALS__（__TAURI__ 仅在 withGlobalTauri 开启时存在，本项目未开启）
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) return 'tauri'
  return 'browser'
}

export function isTauriRuntime(): boolean {
  return detectHost() === 'tauri'
}

export function isHarmonyRuntime(): boolean {
  return detectHost() === 'harmony'
}

// ---- invoke（前端 → 原生）----

export async function nativeInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const host = detectHost()
  if (host === 'harmony') {
    const raw = await window.__AMIBA_HARMONY__!.invoke(cmd, JSON.stringify(args ?? {}))
    return (raw ? JSON.parse(raw) : null) as T
  }
  if (host === 'tauri') {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<T>(cmd, args)
  }
  throw new Error('[PlatformBridge] 原生桥不可用（浏览器环境）')
}

// ---- listen（原生 → 前端事件）----

// 与 Tauri event 载荷包络一致：handler 收到 { payload } 形状
export interface NativeEvent<T> {
  payload: T
}
export type NativeEventHandler<T> = (event: NativeEvent<T>) => void
export type UnlistenFn = () => void

const harmonyListeners = new Map<string, Set<NativeEventHandler<unknown>>>()

// 鸿蒙壳 → 前端事件入口：ArkTS 侧经 runJavaScript 调用。
// 模块加载即注册（不等地业务 listen），ArkTS 侧须保证在页面加载完成后再推送事件。
if (typeof window !== 'undefined') {
  window.__amiba_harmony_emit__ = (event: string, payloadJson: string) => {
    let payload: unknown = payloadJson
    try {
      payload = JSON.parse(payloadJson)
    } catch {
      // 非 JSON 载荷原样透传
    }
    const set = harmonyListeners.get(event)
    if (!set?.size) {
      console.warn(`[PlatformBridge] 收到无监听者的事件: ${event}`)
      return
    }
    console.log(`[PlatformBridge] === 收到原生事件: ${event} ===`)
    set.forEach((cb) => {
      try {
        cb({ payload })
      } catch (e) {
        console.error(`[PlatformBridge] ✗ 事件处理异常: ${event}`, e)
      }
    })
  }
}

export async function nativeListen<T = unknown>(
  event: string,
  handler: NativeEventHandler<T>,
): Promise<UnlistenFn> {
  const host = detectHost()
  if (host === 'harmony') {
    let set = harmonyListeners.get(event)
    if (!set) {
      set = new Set()
      harmonyListeners.set(event, set)
    }
    const h = handler as NativeEventHandler<unknown>
    set.add(h)
    return () => set.delete(h)
  }
  if (host === 'tauri') {
    const { listen } = await import('@tauri-apps/api/event')
    return listen<T>(event, handler as (e: { payload: T }) => void)
  }
  // 浏览器无事件源，返回空取消函数静默降级（与既有行为一致）
  return () => {}
}

// ---- 应用版本 ----

export async function getAppVersion(): Promise<string> {
  const host = detectHost()
  if (host === 'harmony') {
    try {
      const info = await nativeInvoke<{ version: string }>(APP_COMMANDS.getAppInfo)
      if (info?.version) return info.version
    } catch {
      // 壳未实现时降级到前端构建版本
    }
  }
  if (host === 'tauri') {
    try {
      const { getVersion } = await import('@tauri-apps/api/app')
      return await getVersion()
    } catch {
      // 继续降级
    }
  }
  return __APP_VERSION__
}
