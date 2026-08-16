// ============================================================
// Amiba Kernel — 结构化日志接口
// ============================================================
// 提供内核与插件统一使用的 Logger。
// 当前只实现 console 适配器；后续可把现有 config/logger.ts
// 的文件日志作为 adapter 注册进来，本接口保持不变。
// ============================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  child(scope: string): Logger
}

export interface LoggerOptions {
  /** 默认 info。 */
  level?: LogLevel
  /** 日志前缀，例如插件 id。 */
  scope?: string
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

/** console 适配器：不依赖任何平台模块，浏览器/Node 通用。 */
export class ConsoleLogger implements Logger {
  private readonly levelWeight: number
  private readonly scope: string | undefined

  constructor(options: LoggerOptions = {}) {
    this.levelWeight = LEVEL_WEIGHT[options.level ?? 'info'] ?? LEVEL_WEIGHT.info
    this.scope = options.scope
  }

  debug(...args: unknown[]): void {
    if (this.levelWeight > LEVEL_WEIGHT.debug) return
    console.debug(...this.prefix(), ...args)
  }

  info(...args: unknown[]): void {
    if (this.levelWeight > LEVEL_WEIGHT.info) return
    console.info(...this.prefix(), ...args)
  }

  warn(...args: unknown[]): void {
    if (this.levelWeight > LEVEL_WEIGHT.warn) return
    console.warn(...this.prefix(), ...args)
  }

  error(...args: unknown[]): void {
    if (this.levelWeight > LEVEL_WEIGHT.error) return
    console.error(...this.prefix(), ...args)
  }

  child(scope: string): Logger {
    const nextScope = this.scope ? `${this.scope}:${scope}` : scope
    return new ConsoleLogger({ level: this.currentLevel(), scope: nextScope })
  }

  private prefix(): string[] {
    return this.scope ? [`[${this.scope}]`] : []
  }

  private currentLevel(): LogLevel {
    // 反查权重只是为了 child 继承级别；ConsoleLogger 内部存权重即可。
    for (const [level, weight] of Object.entries(LEVEL_WEIGHT)) {
      if (weight === this.levelWeight) return level as LogLevel
    }
    return 'info'
  }
}

/** 默认内核日志实例。 */
export function createLogger(options: LoggerOptions = {}): Logger {
  return new ConsoleLogger(options)
}
