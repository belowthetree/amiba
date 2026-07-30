// ============================================================
// 变形虫 (Amiba) — API 可用性检测
// 启动时与 API 设置引导页共用：最小化 chat 请求验证 baseUrl/Key/模型
// ============================================================

export interface ApiCheckResult {
  ok: boolean
  error?: string
}

/**
 * 发送最小化 chat completion 请求验证 API 是否可用。
 * 判定规则：
 * - 2xx / 400 / 422：服务可达且 Key 已被接受 → 可用
 * - 401 / 403 / 404：Key 无效或端点/模型不存在 → 不可用
 * - 网络错误 / 超时：不可用
 * - 其他状态（429/5xx 等瞬态错误）：不阻塞，视为可用
 */
export async function testApiConnection(
  baseUrl: string,
  apiKey: string,
  model: string,
  timeoutMs = 12000
): Promise<ApiCheckResult> {
  if (!apiKey) return { ok: false, error: 'API Key is empty' }
  if (!baseUrl) return { ok: false, error: 'Base URL is empty' }

  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions'
  const ctrl = new AbortController()
  const tmr = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: ctrl.signal,
    })
    if (res.ok || res.status === 400 || res.status === 422) return { ok: true }
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}` }
    }
    // 429 / 5xx 等瞬态错误不阻塞使用
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  } finally {
    clearTimeout(tmr)
  }
}
