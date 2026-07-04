// ============================================================
// 变形虫 (Amiba) — 服务生成工具（generate_service）
// ============================================================
// 允许 Agent 通过自然语言描述生成完整的迷你 Web 应用包，
// 自动注册并安装到服务注册表中。
// ============================================================
import { toolRegistry } from './tool-registry'
import { generateService } from '../ai/generator'
import { registerService, storeServicePackage } from '../host/registry'
import type { ServicePackage } from '../types/service'

toolRegistry.register({
  name: 'generate_service',
  toolset: 'generate',
  category: 'generate',
  emoji: '🚀',
  description:
    '根据自然语言需求描述生成一个完整的迷你 Web 应用（HTML/CSS/JS），自动注册并安装到平台。生成前建议先用 service_list 检查是否已有类似服务。',
  maxResultSizeChars: 3000,
  schema: {
    type: 'function',
    function: {
      name: 'generate_service',
      description:
        '根据用户的自然语言需求描述，生成一个完整的迷你 Web 应用包（含 index.html、style.css、app.js），自动注册并安装。生成前请先用 service_list 和 requirements_summary 检查是否有重复或可通过修改现有服务满足的需求。',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '用户的需求描述，例如："帮我做一个番茄钟应用，25 分钟倒计时，有开始暂停和重置按钮"',
          },
        },
        required: ['prompt'],
      },
    },
  },
  handler: async (args) => {
    const prompt = String(args.prompt || '').trim()
    if (!prompt) {
      return JSON.stringify({ error: 'prompt 不能为空' })
    }

    try {
      const gen = generateService(prompt)

      let pkg: ServicePackage | null = null
      const errors: { node: string; message: string }[] = []

      for await (const result of gen) {
        if (Array.isArray(result)) {
          errors.push(...result)
        } else {
          pkg = result
        }
      }

      if (errors.length > 0) {
        return JSON.stringify({
          error: '生成校验失败',
          validation_errors: errors,
          hint: '请根据校验错误提示修改需求描述后重试',
        })
      }

      if (!pkg) {
        return JSON.stringify({ error: '生成失败：未返回有效的服务包' })
      }

      // 自动注册并安装
      console.log('[GenerateTool] 自动注册并安装:', pkg.manifest.id)
      await registerService(pkg.manifest, 'ai-generated')
      await storeServicePackage(pkg.manifest.id, pkg)

      return JSON.stringify({
        success: true,
        service_id: pkg.manifest.id,
        name: pkg.manifest.name,
        version: pkg.manifest.version,
        description: pkg.manifest.description,
        files_count: pkg.files.length,
        files: pkg.files.map((f) => f.path),
        permissions: pkg.manifest.permissions,
        installed: true,
        message: `服务 "${pkg.manifest.name}" (${pkg.manifest.id}) 已生成并安装成功。共 ${pkg.files.length} 个文件。`,
      })
    } catch (e: any) {
      console.error('[GenerateTool] 生成异常:', e)
      return JSON.stringify({ error: e.message || String(e) })
    }
  },
})
