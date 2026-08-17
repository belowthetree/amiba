// ============================================================
// @amiba/plugin-manager — 预编译插件运行时装载器
// ============================================================
// 包内 plugin.js 采用 CJS + window.__AMIBA_MODULE_LOADER__.load。
// 这里把 vue / vue-router / pinia / @amiba/sdk 等平台模块注入 require。
// ============================================================
import * as Vue from 'vue'
import * as VueRouter from 'vue-router'
import * as Pinia from 'pinia'
import { defineAmibaPlugin } from '../../sdk'
import { PermissionError } from '../../kernel'
import type { AmibaPluginModule, PluginDefinition, PluginManifest } from '../../kernel'

export interface RuntimeModuleLoader {
  load(options: { id: string; factory: (require: RuntimeRequire) => AmibaPluginModule }): void
  getModule(id: string): AmibaPluginModule | undefined
  removeModule(id: string): void
}

export type RuntimeRequire = (name: string) => unknown

declare global {
  interface Window {
    __AMIBA_MODULE_LOADER__?: RuntimeModuleLoader
  }
}

const modules = new Map<string, AmibaPluginModule>()

function createRequire(): RuntimeRequire {
  return (name: string) => {
    if (name === 'vue') return Vue
    if (name === 'vue-router') return VueRouter
    if (name === 'pinia') return Pinia
    if (name === '@amiba/sdk') return { defineAmibaPlugin }
    if (name === '@amiba/kernel') return { PermissionError }
    throw new Error(`[runtime-loader] 不支持的平台模块: ${name}`)
  }
}

const loader: RuntimeModuleLoader = {
  load({ id, factory }) {
    const module = factory(createRequire())
    if (typeof module?.apply !== 'function') {
      throw new Error(`[runtime-loader] 插件 bundle "${id}" 未导出 apply`)
    }
    modules.set(id, module)
  },
  getModule(id) {
    return modules.get(id)
  },
  removeModule(id) {
    modules.delete(id)
  },
}

/** 安装全局 loader；可重复调用。 */
export function ensureRuntimeLoader(): RuntimeModuleLoader {
  if (!window.__AMIBA_MODULE_LOADER__) {
    window.__AMIBA_MODULE_LOADER__ = loader
  }
  return window.__AMIBA_MODULE_LOADER__
}

/** 执行预编译 bundle 文本（bundle 会主动调用全局 loader.load）。 */
export function evaluatePluginBundle(code: string, sourceUrl: string): void {
  ensureRuntimeLoader()
  const evaluate = new Function('window', `${code}\n//# sourceURL=${sourceUrl}`)
  evaluate(window)
}

/** 将已装载模块包装为内核 PluginDefinition。 */
export function createRuntimePluginDefinition(
  id: string,
  module: AmibaPluginModule,
  manifest: PluginManifest,
): PluginDefinition {
  return {
    instanceId: id,
    pluginId: manifest.id,
    name: module.name || manifest.id,
    kind: manifest.kind,
    manifest,
    module,
    config: { ...(manifest.config?.defaults ?? {}) },
    order: 1000,
  }
}

export function hasRuntimeModule(id: string): boolean {
  return modules.has(id)
}
