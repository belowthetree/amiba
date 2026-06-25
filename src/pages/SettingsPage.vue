<!-- ============================================================
变形虫 (Amiba) — SettingsPage
============================================================ -->
<template>
  <div class="settings-page">
    <h2 class="page-title">⚙️ 设置</h2>

    <div class="settings-section">
      <h3 class="section-label">API 配置</h3>

      <div class="form-group">
        <label>API Key</label>
        <input
          :type="showKey ? 'text' : 'password'"
          v-model="apiKey"
          class="form-input"
          placeholder="sk-..."
        />
        <button class="toggle-key" @click="showKey = !showKey">
          {{ showKey ? '🙈' : '👁' }}
        </button>
      </div>

      <div class="form-group">
        <label>Base URL</label>
        <input
          v-model="settings.ai_base_url"
          class="form-input"
          placeholder="https://api.deepseek.com/v1"
        />
      </div>

      <div class="form-group">
        <label>对话模型</label>
        <input
          v-model="settings.ai_model"
          class="form-input"
          placeholder="deepseek-chat"
        />
      </div>

      <div class="form-group">
        <label>生成模型</label>
        <input
          v-model="settings.ai_generation_model"
          class="form-input"
          placeholder="deepseek-chat"
        />
      </div>
    </div>

    <div class="settings-section">
      <h3 class="section-label">外观</h3>

      <div class="form-group">
        <label>主题模式</label>
        <select v-model="settings.theme_mode" class="form-input">
          <option value="system">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
      </div>

      <div class="form-group">
        <label>语言</label>
        <select v-model="settings.language" class="form-input">
          <option value="zh-CN">中文</option>
          <option value="en">English</option>
        </select>
      </div>
    </div>

    <div class="settings-section">
      <h3 class="section-label">数据管理</h3>
      <div class="action-row" style="margin-bottom:8px"><button class="secondary-btn" @click="scanForServices">🔍 扫描存储目录</button><button class="secondary-btn" @click="addSvcFolder">📁 选择文件夹</button><button class="secondary-btn" @click="addSvcFile">📄 选择文件</button></div>
      <div v-if="pending.length" class="sl" style="margin-bottom:8px"><div class="si" v-for="(svc,i) in pending" :key="i"><span class="sn">{{ svc.name }}</span><span class="sd">{{ svc.desc }}</span><button class="sib" @click="installSvc(i)">安装</button><button class="sx" @click="pending.splice(i,1)">✕</button></div></div><div class="action-row">
        <button class="danger-btn" @click="clearAllData">
          🗑 清除所有数据
        </button>
        <button class="secondary-btn" @click="exportData">
          📥 导出配置
        </button>
      </div>
    </div>

    <div class="settings-section">
      <h3 class="section-label">关于</h3>
      <div class="about-info">
        <p><strong>变形虫 Amiba</strong> v1.0.0</p>
        <p>AI 驱动的跨平台即时应用平台</p>
        <p>Vue 3 + TypeScript + Tauri</p>
      </div>
    </div>

    <div class="saved-hint" v-if="showSaved">✅ 已保存</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { settings, getApiKey, setApiKey } from '../config/config'
import { storageClear, storageKeys, storageGet } from '../config/storage'
import { buildHtmlFromUI } from '../ai/generator'
import { registerService, storeServiceHtml } from '../host/registry'

const apiKey = ref('')
const showKey = ref(false)
const showSaved = ref(false); const pending = ref<any[]>([])

let saveTimer: ReturnType<typeof setTimeout> | null = null

watch(apiKey, (val) => {
  void setApiKey(val).then(() => flashSaved())
})

watch(
  () => ({ ...settings }),
  () => {
    flashSaved()
  },
  { deep: true }
)

function flashSaved() {
  showSaved.value = true
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    showSaved.value = false
  }, 1500)
}

async function clearAllData() {
  if (confirm('确定要清除所有数据吗？这将删除配置、记忆和已安装的服务。此操作不可撤销！')) {
    await storageClear()
    location.reload()
  }
}

async function exportData() {
  const data: Record<string, any> = {}
  const ks = await storageKeys(); for (const key of ks) { data[key] = await storageGet(key) }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `amiba-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  flashSaved()
}

async function addSvcFolder() { try { const dh = await (window as any).showDirectoryPicker(); const svcs: any[] = []; for await (const [n, h] of (dh as any).entries()) { if (h.kind !== "file") continue; try { const t = await (await h.getFile()).text(); const s = JSON.parse(t); if (s.manifest && s.ui && s.logic !== undefined) svcs.push({ name: s.manifest.name || n, id: s.manifest.id || n, desc: s.manifest.description || "", data: s }) } catch {} } if (svcs.length) { pending.value = [...pending.value, ...svcs]; flashSaved() } else alert("未发现有效服务 JSON") } catch (e: any) { if (e.name !== "AbortError") alert("失败: " + e.message) } }

async function addSvcFile() { const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json"; inp.multiple = true; inp.style.display = "none"; document.body.appendChild(inp); inp.onchange = async () => { document.body.removeChild(inp); const svcs: any[] = []; for (const f of Array.from(inp.files || [])) { try { const t = await f.text(); const s = JSON.parse(t); if (s.manifest && s.ui && s.logic !== undefined) svcs.push({ name: s.manifest.name || f.name, id: s.manifest.id || f.name, desc: s.manifest.description || "", data: s }) } catch {} } if (svcs.length) { pending.value = [...pending.value, ...svcs]; flashSaved() } }; inp.click() }

async function installSvc(idx: number) { const s: any = pending.value[idx]; if (!s) return; try { const html = buildHtmlFromUI(s.data.ui, s.data.logic || ""); const m: any = { id: s.data.manifest.id || ("user." + s.id), name: s.data.manifest.name || s.name, version: s.data.manifest.version || "1.0.0", description: s.data.manifest.description || "", permissions: s.data.manifest.permissions || [] }; await registerService(m, "ai-generated"); await storeServiceHtml(m.id, html); pending.value.splice(idx, 1); flashSaved() } catch (e: any) { console.error(e); alert("安装失败: " + e.message) } }

async function scanForServices() { let count = 0; const keys = await storageKeys(); console.log("[Scan] files:", keys); for (const key of keys) { if (key.startsWith("amiba_")) continue; try { const raw = await storageGet(key); if (!raw) continue; const svc = JSON.parse(raw); if (svc.manifest && svc.ui && svc.logic !== undefined) { const html = buildHtmlFromUI(svc.ui, svc.logic || ""); const m = { id: svc.manifest.id || ("user." + key), name: svc.manifest.name || key, version: svc.manifest.version || "1.0.0", description: svc.manifest.description || "", permissions: svc.manifest.permissions || [] }; await registerService(m, "ai-generated"); await storeServiceHtml(m.id, html); console.log("[Scan] installed:", m.name); count++; } } catch (e) { console.log("[Scan] skip:", key, e) } } if (count > 0) { alert("已安装 " + count + " 个服务"); location.reload() } else { alert("未发现可安装的服务 JSON") } }
</script>

<style scoped>
.settings-page {
  padding: 16px;
  max-width: 500px;
  margin: 0 auto;
}

.page-title {
  font-size: 22px;
  margin-bottom: 20px;
  color: #333;
}

.settings-section {
  background: white;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.section-label {
  font-size: 14px;
  font-weight: 600;
  color: #666;
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.form-group {
  margin-bottom: 12px;
  position: relative;
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-group label {
  display: block;
  font-size: 13px;
  color: #999;
  margin-bottom: 4px;
}

.form-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
}

.form-input:focus {
  border-color: #1976D2;
}

.toggle-key {
  position: absolute;
  right: 8px;
  bottom: 8px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
}

.action-row {
  display: flex;
  gap: 8px;
}

.danger-btn {
  padding: 8px 16px;
  border: 1px solid #e53935;
  color: #e53935;
  background: white;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}

.danger-btn:hover {
  background: #FFF3E0;
}

.secondary-btn {
  padding: 8px 16px;
  border: 1px solid #1976D2;
  color: #1976D2;
  background: white;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}

.about-info {
  font-size: 13px;
  color: #999;
  line-height: 1.8;
}

.saved-hint {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: #333;
  color: white;
  padding: 8px 20px;
  border-radius: 20px;
  font-size: 13px;
  z-index: 999;
  animation: fadeInOut 1.5s ease;
}

@keyframes fadeInOut {
  0% { opacity: 0; transform: translateX(-50%) translateY(10px); }
  20% { opacity: 1; transform: translateX(-50%) translateY(0); }
  80% { opacity: 1; }
  100% { opacity: 0; }
}
.sl{display:flex;flex-direction:column;gap:4px}.si{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f9f9f9;border-radius:6px;font-size:13px}.sn{font-weight:600;color:#333;white-space:nowrap}.sd{flex:1;color:#999;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sx{border:none;background:none;color:#e53935;cursor:pointer;font-size:14px;padding:2px 6px}.sib{border:1px solid #4CAF50;color:#4CAF50;background:white;border-radius:4px;cursor:pointer;font-size:12px;padding:2px 8px;white-space:nowrap}.sib:hover{background:#E8F5E9}</style>
