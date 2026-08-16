// ============================================================
// @amiba/platform — 平台能力内核服务插件
// ============================================================
// 收编对象：
//   - config/polyfill.ts        启动期 polyfill（本文件最先 import）
//   - config/platform-bridge.ts 宿主探测 + nativeInvoke/nativeListen
//   - config/native-fs.ts       文件系统兼容 shim
//   - app-lifecycle.ts          前后台生命周期
//
// 注意：本插件只是把既有实现注册到内核服务容器，
// 原模块仍保留原路径导出，现有 main.ts 行为不变。
// ============================================================

import '../../config/polyfill'

import type { AmibaContext } from '../../kernel'
import * as platformBridge from '../../config/platform-bridge'
import type { NativeEventHandler, NativeEvent } from '../../config/platform-bridge'
import * as nativeFs from '../../config/native-fs'
import { initAppLifecycle } from '../../app-lifecycle'
import type { LifecycleHandlers } from '../../app-lifecycle'

export const name = '@amiba/platform'
export const inject: string[] = []
export const provides = ['platform', 'fs', 'lifecycle']

/** `ctx.get('platform')` 返回的服务面。 */
export interface AmibaPlatformService {
  detectHost(): platformBridge.HostPlatform
  isTauriRuntime(): boolean
  isHarmonyRuntime(): boolean
  nativeInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>
  nativeListen<T = unknown>(event: string, handler: NativeEventHandler<T>): Promise<platformBridge.UnlistenFn>
  getAppVersion(): Promise<string>
}

/** `ctx.get('lifecycle')` 返回的服务面。 */
export interface AmibaLifecycleService {
  init(handlers: LifecycleHandlers): () => void
}

export function apply(ctx: AmibaContext): void {
  const platform: AmibaPlatformService = {
    detectHost: () => platformBridge.detectHost(),
    isTauriRuntime: () => platformBridge.isTauriRuntime(),
    isHarmonyRuntime: () => platformBridge.isHarmonyRuntime(),
    nativeInvoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => platformBridge.nativeInvoke<T>(cmd, args),
    nativeListen: <T = unknown>(event: string, handler: NativeEventHandler<T>) => platformBridge.nativeListen<T>(event, handler),
    getAppVersion: () => platformBridge.getAppVersion(),
  }

  const lifecycle: AmibaLifecycleService = {
    init: (handlers) => initAppLifecycle(handlers),
  }

  ctx.provide('platform', platform)
  ctx.provide('fs', nativeFs)
  ctx.provide('lifecycle', lifecycle)
}

export type { NativeEvent }
