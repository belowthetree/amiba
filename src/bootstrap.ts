// ============================================================
// Amiba — 应用启动组合器
// ============================================================
// 这是 main.ts 与内核之间的唯一粘合层：
//   1. 取内置插件定义；
//   2. startKernel() 装配；
//   3. 把 KernelLoader 接入诊断页并注册隐藏诊断路由。
// 不包含任何业务初始化逻辑（业务初始化在 legacy-bootstrap 插件内）。
// ============================================================

import { defineComponent, h } from 'vue'
import type { Router } from 'vue-router'
import { startKernel } from './kernel'
import type { KernelLoader } from './kernel'
import { builtinPluginDefinitions } from './plugins/registry'
import type { AmibaDiagnosticsService } from './plugins/ui-diagnostics'

/** 启动应用并返回内核 loader（供测试/诊断使用）。 */
export async function startAmiba(): Promise<KernelLoader> {
  const { loader } = await startKernel(builtinPluginDefinitions())

  const failed = loader.listInstances().filter((instance) => instance.status === 'failed')
  if (failed.length > 0) {
    console.warn('[Amiba] 部分插件装配失败:', failed)
  }

  attachDiagnostics(loader)
  
  return loader
}

function attachDiagnostics(loader: KernelLoader): void {
  const diagnostics = loader.root.get<AmibaDiagnosticsService>('diagnostics')
  const router = loader.root.get<Router>('router')
  if (!diagnostics || !router) {
    console.warn('[Amiba] 诊断页未接入：缺少 diagnostics / router 服务')
    return
  }

  diagnostics.setSource(loader)

  const DiagnosticsRoute = defineComponent({
    name: 'AmibaDiagnosticsRoute',
    setup() {
      return () => h(diagnostics.component, { source: loader })
    },
  })

  router.addRoute({
    path: diagnostics.path,
    name: 'amiba-diagnostics',
    component: DiagnosticsRoute,
  })
  console.log(`[Amiba] 诊断页已接入: ${diagnostics.path}`)
}

