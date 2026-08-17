// ============================================================
// @amiba/file-logger — 文件日志服务插件
// ============================================================
// 包装 config/logger.ts；init(settings) 仍由 legacy-bootstrap
// 在原位置调用，以保持 console monkey-patch 时机不变。
// ============================================================

import { initLogger } from '../../config/logger'
import type { AppSettings } from '../../types/service'
import type { AmibaContext } from '../../kernel'

export const name = '@amiba/file-logger'
export const inject: string[] = []
export const provides = ['fileLogger']

export interface AmibaFileLoggerService {
  init(settings: AppSettings): void
}

export function apply(ctx: AmibaContext): void {
  const service: AmibaFileLoggerService = {
    init: (settings) => initLogger(settings),
  }
  ctx.provide('fileLogger', service)
}
