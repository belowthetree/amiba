<!-- ============================================================
变形虫 (Amiba) — RemoteServicesPage (远程服务仓库浏览)
============================================================ -->
<template>
  <div class="registry-page">
    <h2 class="page-title">🌐 {{ $t('registry.title') }}</h2>

    <!-- 仓库地址输入 -->
    <div class="registry-url-bar">
      <label class="url-label">{{ $t('registry.source') }}</label>
      <div class="url-import-row">
        <input
          v-model="repoUrlInput"
          class="form-input url-input"
          :placeholder="$t('registry.urlPlaceholder')"
          @keyup.enter="applyUrl"
        />
        <button class="secondary-btn" @click="applyUrl" :disabled="!repoUrlInput.trim()">
          {{ $t('registry.go') }}
        </button>
      </div>
    </div>

    <!-- 加载中 -->
    <div v-if="loading" class="registry-loading">
      <span class="spinner"></span>
      {{ $t('registry.loading') }}
    </div>

    <!-- 错误 -->
    <div v-else-if="error" class="registry-error">
      <p>{{ error }}</p>
      <button class="secondary-btn" @click="fetchServices">{{ $t('registry.retry') }}</button>
    </div>

    <!-- 空仓库 -->
    <div v-else-if="!services.length" class="registry-empty">
      <p>{{ $t('registry.empty') }}</p>
    </div>

    <!-- 服务列表 -->
    <div v-else class="registry-list">
      <div
        v-for="svc in services"
        :key="svc.id"
        class="registry-card"
      >
        <div class="registry-card-body">
          <div class="registry-card-header">
            <span class="registry-card-icon">📦</span>
            <span class="registry-card-name">{{ svc.manifest?.name || svc.id }}</span>
            <span class="registry-card-version">v{{ svc.manifest?.version || '?' }}</span>
            <span v-if="svc.installed" class="registry-badge installed">
              {{ svc.updateAvailable ? $t('registry.updateAvailable') : $t('registry.installed') }}
            </span>
          </div>
          <p class="registry-card-desc">{{ svc.manifest?.description || $t('registry.noDescription') }}</p>
        </div>
        <div class="registry-card-actions">
          <button
            v-if="!svc.installed"
            class="primary-btn registry-install-btn"
            :disabled="installingId === svc.id"
            @click="installService(svc)"
          >{{ installingId === svc.id ? '⏳ ' + $t('registry.installing') : '📥 ' + $t('registry.install') }}</button>
          <button
            v-else-if="svc.updateAvailable"
            class="primary-btn registry-install-btn"
            :disabled="installingId === svc.id"
            @click="installService(svc)"
          >{{ installingId === svc.id ? '⏳ ' + $t('registry.installing') : '🔄 ' + $t('registry.update') }}</button>
          <span v-else class="registry-done">✅ {{ svc.installedVersion }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { settings } from '../config/config'
import { getService, registerService, storeServicePackage } from '../host/registry'
import type { ServiceManifest } from '../types/service'

const { t } = useI18n()

const repoUrl = computed(() => settings.service_registry_url || '')

// 本地输入框（双向绑定 settings.service_registry_url）
const repoUrlInput = ref(settings.service_registry_url || '')

function applyUrl() {
  const trimmed = repoUrlInput.value.trim()
  settings.service_registry_url = trimmed
  if (trimmed) {
    fetchServices()
  } else {
    error.value = t('registry.noUrl')
  }
}

interface RemoteServiceEntry {
  id: string
  files: string[]
}

interface RemoteServiceIndex {
  services: RemoteServiceEntry[]
}

interface DisplayService {
  id: string
  manifest: ServiceManifest | null
  installed: boolean
  installedVersion: string
  updateAvailable: boolean
  files: string[]
}

const loading = ref(false)
const error = ref('')
const services = ref<DisplayService[]>([])
const installingId = ref('')

onMounted(() => {
  if (repoUrl.value) {
    fetchServices()
  } else {
    error.value = t('registry.noUrl')
  }
})

/**
 * 规范化仓库 URL → raw 文件基础路径。
 * 支持三种输入格式：
 *   - 直接 raw URL: https://gitee.com/u/r/raw/master 或 https://raw.githubusercontent.com/...
 *   - 仓库首页:     https://gitee.com/u/r → 自动补 /raw/master
 *   - 仓库首页:     https://github.com/u/r → 自动转 raw.githubusercontent.com/u/r/main
 */
function normalizeBaseUrl(input: string): string {
  let url = input.replace(/\/+$/, '')

  // gitee.com 仓库首页 → raw 路径
  const giteeMatch = url.match(/^https?:\/\/gitee\.com\/([^\/]+\/[^\/]+)$/)
  if (giteeMatch) {
    return `${url}/raw/master`
  }

  // github.com 仓库首页 → raw 路径
  const ghMatch = url.match(/^https?:\/\/github\.com\/([^\/]+\/[^\/]+)$/)
  if (ghMatch) {
    return `https://raw.githubusercontent.com/${ghMatch[1]}/main`
  }

  return url
}

/**
 * 跨域安全的 HTTP GET。
 * Tauri 环境优先走 Rust reqwest（绕过 CORS），浏览器环境降级到 fetch。
 */
async function safeFetch(url: string): Promise<string> {
  // 尝试 Tauri Rust HTTP（绕过 CORS）
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const result = await invoke<{ text: string; raw: string; content_type: string }>('web_fetch', {
      url,
      useWebview: false,
    })
    console.log('[Registry] Tauri fetch OK:', url)
    return result.raw || result.text
  } catch {
    // 降级到浏览器 fetch（同源或支持 CORS 的场景）
    console.log('[Registry] 降级浏览器 fetch:', url)
    const resp = await fetch(url)
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`)
    }
    return resp.text()
  }
}

async function fetchServices() {
  loading.value = true
  error.value = ''
  services.value = []

  try {
    const baseUrl = normalizeBaseUrl(repoUrl.value)
    const indexUrl = `${baseUrl}/index.json`

    console.log('[Registry] 获取服务列表:', indexUrl)
    const raw = await safeFetch(indexUrl)
    const data: RemoteServiceIndex = JSON.parse(raw)
    if (!data.services || !Array.isArray(data.services)) {
      throw new Error(t('registry.invalidIndex'))
    }

    // 并行获取各服务的 manifest
    const displayList: DisplayService[] = []
    for (const entry of data.services) {
      const manifestUrl = `${baseUrl}/${entry.id}/manifest.json`
      let manifest: ServiceManifest | null = null
      try {
        const mRaw = await safeFetch(manifestUrl)
        manifest = JSON.parse(mRaw) as ServiceManifest
      } catch {
        console.warn('[Registry] 无法获取 manifest:', manifestUrl)
      }

      // 检查本地安装状态
      const localEntry = getService(entry.id)
      const installed = !!localEntry
      const installedVersion = localEntry?.manifest?.version || ''
      const updateAvailable = !!(installed &&
        manifest?.version &&
        compareVersions(manifest.version, installedVersion) > 0)

      displayList.push({
        id: entry.id,
        manifest,
        installed,
        installedVersion,
        updateAvailable,
        files: entry.files,
      })
    }

    services.value = displayList
    console.log('[Registry] ✓ 获取到 %d 个服务', displayList.length)
  } catch (e: any) {
    const msg = e?.message || String(e) || t('registry.fetchFailed')
    error.value = msg
    console.error('[Registry] 获取失败:', msg)
  } finally {
    loading.value = false
  }
}

async function installService(svc: DisplayService) {
  if (!svc.manifest) return

  installingId.value = svc.id
  try {
    const baseUrl = normalizeBaseUrl(repoUrl.value)
    const files: { path: string; content: string }[] = []

    for (const filePath of svc.files) {
      const fileUrl = `${baseUrl}/${svc.id}/${filePath}`
      console.log('[Registry] 下载文件:', fileUrl)
      const content = await safeFetch(fileUrl)
      files.push({ path: filePath, content })
    }

    // 注册服务
    try {
      registerService(svc.manifest, 'downloaded')
    } catch {
      // 已注册则跳过
    }

    // 存储文件
    await storeServicePackage(svc.id, {
      manifest: svc.manifest,
      files,
    })

    // 刷新本地状态
    const localEntry = getService(svc.id)
    svc.installed = true
    svc.installedVersion = svc.manifest.version
    svc.updateAvailable = false

    console.log('[Registry] ✓ 安装完成:', svc.id, svc.manifest.version)
  } catch (e: any) {
    const msg = e?.message || String(e) || t('registry.installFailed')
    alert(msg)
    console.error('[Registry] 安装失败:', msg)
  } finally {
    installingId.value = ''
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}
</script>

<style scoped>
/* ==== 页面布局 ==== */
.registry-page {
  padding: var(--spacing-md);
  max-width: 640px;
  margin: 0 auto;
}

.page-title {
  font-size: var(--font-size-xl);
  font-weight: 700;
  letter-spacing: -0.3px;
  color: var(--color-text);
  margin-bottom: var(--spacing-lg);
}

/* ==== 仓库地址输入 ==== */
.registry-url-bar {
  margin-bottom: var(--spacing-lg);
}

.url-label {
  display: block;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: 8px;
  letter-spacing: 0.4px;
}

.url-import-row {
  display: flex;
  gap: var(--spacing-sm);
  align-items: center;
}

.url-import-row .url-input {
  flex: 1;
}

/* ==== 按钮层级（与项目统一） ==== */
.primary-btn,
.secondary-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 40px;
  padding: 0 16px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}

.primary-btn:active,
.secondary-btn:active {
  transform: scale(0.97);
}

.primary-btn {
  background: var(--color-primary);
  color: var(--color-on-primary);
}
.primary-btn:hover {
  background: var(--color-primary-hover);
}

.secondary-btn {
  background: var(--color-surface);
  border-color: var(--color-border);
  color: var(--color-text);
}
.secondary-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-light);
}

.primary-btn:disabled,
.secondary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

/* ==== 表单输入 ==== */
.form-input {
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--color-text);
  background: var(--color-surface);
  outline: none;
  transition: border-color 0.15s ease;
}
.form-input::placeholder {
  color: var(--color-text-muted);
}
.form-input:hover {
  border-color: var(--color-text-muted);
}
.form-input:focus {
  border-color: var(--color-primary);
}

/* ==== 加载 / 错误 / 空状态 ==== */
.registry-loading,
.registry-error,
.registry-empty {
  text-align: center;
  padding: 60px 16px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-md);
}
.registry-error {
  color: var(--color-error);
}
.registry-error .secondary-btn {
  margin-top: 12px;
}

.spinner {
  display: inline-block;
  width: 18px;
  height: 18px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  margin-right: 8px;
  vertical-align: middle;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ==== 服务列表 ==== */
.registry-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.registry-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  transition: all 0.2s ease;
}
.registry-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.registry-card-body {
  flex: 1;
  min-width: 0;
}

.registry-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  flex-wrap: wrap;
}

.registry-card-icon {
  font-size: 22px;
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-primary-light);
  border-radius: var(--radius-md);
  flex-shrink: 0;
}

.registry-card-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--color-text);
}

.registry-card-version {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  background: var(--color-hover-bg);
  padding: 2px 8px;
  border-radius: 999px;
}

.registry-badge {
  font-size: var(--font-size-xs);
  padding: 2px 10px;
  border-radius: 999px;
  font-weight: 500;
}
.registry-badge.installed {
  background: var(--color-success-light);
  color: var(--color-success);
}

.registry-card-desc {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.registry-card-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.registry-done {
  font-size: var(--font-size-sm);
  color: var(--color-success);
  font-weight: 500;
}

/* ==== 响应式 ==== */
@media (max-width: 768px) {
  .registry-card {
    flex-direction: column;
    align-items: stretch;
  }
  .registry-card-actions {
    align-self: flex-end;
  }
}
</style>
