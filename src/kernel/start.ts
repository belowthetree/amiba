// ============================================================
// Amiba Kernel — startKernel 装配入口
// ============================================================
// 只负责创建 KernelLoader 并执行装配，不 import 任何插件/业务模块。
// 插件定义由调用方（当前是 src/plugins/registry.ts）传入。
// ============================================================

import { KernelLoader } from './loader'
import type { KernelLoaderOptions } from './loader'
import type { PluginDefinition } from './types'

export interface StartKernelResult {
  loader: KernelLoader
}

/**
 * 按定义装配插件。
 * 装配完成后若存在 failed 实例，会写入日志但不会阻止返回；
 * 调用方应检查 loader.listInstances() 决定是否继续挂载。
 */
export async function startKernel(
  definitions: PluginDefinition[],
  options: KernelLoaderOptions = {},
): Promise<StartKernelResult> {
  const loader = new KernelLoader(options)
  await loader.load(definitions)
  return { loader }
}
