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

    <!-- ========== AI 供应商 ========== -->
    <div class="settings-section">
      <h3 class="section-label">🏭 AI 供应商</h3>

      <div v-if="providerList.length" class="skill-list">
        <div v-for="(p, i) in providerList" :key="p.id" class="skill-item">
          <template v-if="providerEditingIdx === i">
            <div class="skill-edit-form">
              <input v-model="providerForm.name" class="form-input" placeholder="显示名称" style="margin-bottom:4px" />
              <input v-model="providerForm.id" class="form-input" placeholder="唯一 ID（英文）" style="margin-bottom:4px" />
              <input v-model="providerForm.baseUrl" class="form-input" placeholder="Base URL" style="margin-bottom:4px" />
              <input v-model="providerForm.apiKey" class="form-input" placeholder="API Key" style="margin-bottom:4px" />
              <textarea v-model="providerForm.modelsStr" class="form-input" placeholder="模型列表（每行一个）" rows="2" style="margin-bottom:6px;resize:vertical" />
              <div class="action-row">
                <button class="sib save" @click="saveProviderEdit(i)">💾 保存</button>
                <button class="sx" @click="providerEditingIdx = -1">取消</button>
              </div>
            </div>
          </template>
          <template v-else>
            <span class="sn">{{ p.name }}</span>
            <span class="sd">{{ p.baseUrl }} · {{ p.models.length }} 个模型</span>
            <button class="sib" @click="startProviderEdit(i)">✏️</button>
            <button class="sx" @click="removeProvider(i)">✕</button>
          </template>
        </div>
      </div>
      <p v-else class="skill-empty">暂无自定义供应商（将使用上方 API 配置作为默认）</p>

      <button class="secondary-btn" style="margin-top:4px" @click="addProviderDialog">
        ➕ 添加供应商
      </button>
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
      <h3 class="section-label">🌐 网络</h3>

      <div class="form-group">
        <div class="toggle-row">
          <div>
            <label style="margin-bottom:0">局域网发现</label>
            <span class="toggle-desc">允许其他设备通过局域网发现本设备</span>
          </div>
          <label class="switch">
            <input type="checkbox" v-model="lanVisible" @change="toggleLan" />
            <span class="slider"></span>
          </label>
        </div>
        <p class="toggle-hint" v-if="lanVisible">✅ 本设备在局域网中可见</p>
        <p class="toggle-hint" v-else>🔒 本设备在局域网中隐藏</p>
      </div>
    </div>

    <div class="settings-section">
      <h3 class="section-label">数据管理</h3>
      <div class="action-row" style="margin-bottom:8px"><button class="secondary-btn" @click="scanForServices">🔍 扫描存储目录</button><button class="secondary-btn" @click="addSvcFile">📄 选择文件</button></div>
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
      <h3 class="section-label">🧩 技能管理</h3>

      <div v-if="userSkills.length" class="skill-list">
        <div v-for="(skill, i) in userSkills" :key="i" class="skill-item">
          <template v-if="editingIdx === i">
            <div class="skill-edit-form">
              <input v-model="editForm.name" class="form-input" placeholder="名称" style="margin-bottom:4px" />
              <input v-model="editForm.desc" class="form-input" placeholder="描述" style="margin-bottom:4px" />
              <input v-model="editForm.kws" class="form-input" placeholder="关键词（逗号分隔）" style="margin-bottom:4px" />
              <textarea v-model="editForm.tpl" class="form-input" placeholder="模板（可选）" rows="3" style="margin-bottom:6px;resize:vertical" />
              <div class="action-row">
                <button class="sib save" @click="saveEdit(i)">💾 保存</button>
                <button class="sx" @click="editingIdx = -1">取消</button>
              </div>
            </div>
          </template>
          <template v-else>
            <span class="sn">{{ skill.name }}</span>
            <span class="sd">{{ skill.description }}</span>
            <button class="sib" @click="startEdit(i)">✏️</button>
            <button class="sx" @click="removeSkill(i)">✕</button>
          </template>
        </div>
      </div>
      <p v-else class="skill-empty">暂无自定义 Skill</p>

      <button class="secondary-btn" style="margin-top:4px" @click="importSkillFolder">📁 导入 Skill 文件夹</button>
    </div>

    <!-- ========== 自定义 Agent ========== -->
    <div class="settings-section">
      <h3 class="section-label">🤖 自定义 Agent</h3>

      <div v-if="agentList.length" class="skill-list">
        <div v-for="(a, i) in agentList" :key="a.id" class="skill-item" :class="{ active: a.id === activeAgentId }">
          <template v-if="agentEditingIdx === i">
            <div class="skill-edit-form">
              <input v-model="agentForm.name" class="form-input" placeholder="显示名称" style="margin-bottom:4px" />
              <input v-model="agentForm.id" class="form-input" placeholder="唯一 ID（英文）" style="margin-bottom:4px" />
              <select v-model="agentForm.providerId" class="form-input" style="margin-bottom:4px">
                <option value="">-- 选择供应商 --</option>
                <option v-for="p in providerList" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
              <select v-model="agentForm.model" class="form-input" style="margin-bottom:4px">
                <option value="">-- 选择模型 --</option>
                <option v-for="m in availableModels" :key="m" :value="m">{{ m }}</option>
              </select>
              <div class="skill-checkboxes" style="margin-bottom:4px">
                <label class="skill-cb-label" v-for="s in userSkills" :key="s.name">
                  <input type="checkbox" :value="s.name" v-model="agentForm.selectedSkills" />
                  {{ s.name }}
                </label>
              </div>
              <textarea v-model="agentForm.systemPrompt" class="form-input" placeholder="自定义 System Prompt（可选）" rows="3" style="margin-bottom:6px;resize:vertical" />
              <div class="action-row">
                <button class="sib save" @click="saveAgentEdit(i)">💾 保存</button>
                <button class="sx" @click="agentEditingIdx = -1">取消</button>
              </div>
            </div>
          </template>
          <template v-else>
            <span class="sn">{{ a.name }}</span>
            <span class="sd">{{ getAgentProviderName(a) }} · {{ a.model }}{{ a.id === activeAgentId ? ' ✅' : '' }}</span>
            <button v-if="a.id !== activeAgentId" class="sib" @click="activateAgent(a.id)">启用</button>
            <button class="sib" @click="startAgentEdit(i)">✏️</button>
            <button class="sx" @click="removeAgent(i)">✕</button>
          </template>
        </div>
      </div>
      <p v-else class="skill-empty">暂无自定义 Agent（将使用默认 API 配置）</p>

      <button class="secondary-btn" style="margin-top:4px" @click="addAgentDialog">
        ➕ 添加 Agent
      </button>
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
import { ref, computed, watch } from 'vue'
import { settings, getApiKey, setApiKey } from '../config/config'
import { storageClear, storageKeys, storageGet, listServiceDirs, readServiceFile } from '../config/storage'
import { registerService, storeServicePackage, getServicePackage } from '../host/registry'
import { setVisibility, getVisibility, currentVisibility } from '../host/network-bridge'
import type { ServicePackage, ServiceManifest } from '../types/service'
import { loadUserSkills, addUserSkill, updateUserSkill, deleteUserSkill, importSkillFromFolder, type Skill } from '../ai/skills'
import { providers, addProvider, updateProvider, deleteProvider, initProviderStore } from '../ai/provider-store'
import { customAgents, activeAgentId, addCustomAgent, updateCustomAgent, deleteCustomAgent, setActiveAgent, initCustomAgentStore } from '../ai/custom-agent-store'
import type { AiProvider, CustomAgent } from '../types/service'

const apiKey = ref('')
const showKey = ref(false)
const showSaved = ref(false); const pending = ref<any[]>([])

// --- Network visibility ---
const lanVisible = ref(currentVisibility.lan)

async function toggleLan() {
  const vis = { lan: lanVisible.value, ble: false }
  try {
    await setVisibility(vis)
    flashSaved()
  } catch { /* non-Tauri env */ }
}

// Init network toggle state — 若默认可见，必须调用 setVisibility 启动 TCP 监听
;(async () => {
  try {
    const vis = await getVisibility()
    lanVisible.value = vis.lan
    if (vis.lan) {
      await setVisibility({ lan: true, ble: false })
    }
  } catch { /* use default */ }
})()

// --- Skill management ---
const userSkills = ref<Skill[]>([])
const editingIdx = ref(-1)
const editForm = ref({ name: '', desc: '', kws: '', tpl: '' })

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

async function addSvcFile() { const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json"; inp.multiple = true; inp.style.display = "none"; document.body.appendChild(inp); inp.onchange = async () => { document.body.removeChild(inp); const svcs: any[] = []; for (const f of Array.from(inp.files || [])) { try { const t = await f.text(); const s = JSON.parse(t); if (s.manifest && s.files && Array.isArray(s.files)) svcs.push({ name: s.manifest.name || f.name, id: s.manifest.id || f.name, desc: s.manifest.description || "", data: s as ServicePackage }) } catch {} } if (svcs.length) { pending.value = [...pending.value, ...svcs]; flashSaved() } }; inp.click() }

async function installSvc(idx: number) { const s: any = pending.value[idx]; if (!s) return; try { const pkg: ServicePackage = s.data; const m: any = { id: pkg.manifest.id || ("user." + s.id), name: pkg.manifest.name || s.name, version: pkg.manifest.version || "1.0.0", description: pkg.manifest.description || "", permissions: pkg.manifest.permissions || [] }; await registerService(m, "ai-generated"); await storeServicePackage(m.id, pkg); pending.value.splice(idx, 1); flashSaved() } catch (e: any) { console.error(e); alert("安装失败: " + e.message) } }

async function scanForServices() { let count = 0; const dirs = await listServiceDirs(); console.log("[Scan] service dirs:", dirs); for (const dir of dirs) { try { const raw = await readServiceFile(dir, 'manifest.json'); if (!raw) continue; const manifest: ServiceManifest = JSON.parse(raw); const pkg = await getServicePackage(dir); if (!pkg) continue; await registerService(manifest, 'ai-generated'); await storeServicePackage(manifest.id, pkg); console.log("[Scan] installed:", manifest.name); count++; } catch (e) { console.log("[Scan] skip:", dir, e) } } if (count > 0) { alert("已安装 " + count + " 个服务"); location.reload() } else { alert("未发现可安装的服务") } }

// --- Skill management functions ---
async function refreshSkills() { userSkills.value = await loadUserSkills() }

async function importSkillFolder() {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const dir = await open({ directory: true, multiple: false, title: '选择 Skill 文件夹' })
    if (!dir || typeof dir !== 'string') return
    await importSkillFromFolder(dir)
    await refreshSkills()
    flashSaved()
  } catch (e: any) {
    alert('导入失败: ' + e.message)
  }
}

function startEdit(idx: number) {
  const s = userSkills.value[idx]; editingIdx.value = idx
  editForm.value = { name: s.name, desc: s.description, kws: s.keywords.join(', '), tpl: s.template }
}
async function saveEdit(idx: number) {
  const f = editForm.value; const oldName = userSkills.value[idx].name
  if (!f.name.trim() || !f.desc.trim()) { alert('名称和描述不能为空'); return }
  try {
    await updateUserSkill(oldName, { name: f.name.trim(), description: f.desc.trim(), keywords: f.kws.split(/[,，]/).map(k => k.trim()).filter(Boolean), template: f.tpl })
    await refreshSkills(); editingIdx.value = -1; flashSaved()
  } catch (e: any) { alert(e.message) }
}
async function removeSkill(idx: number) {
  const s = userSkills.value[idx]
  if (!confirm(`确定要删除 Skill "${s.name}" 吗？`)) return
  try {
    await deleteUserSkill(s.name)
    await refreshSkills(); flashSaved()
  } catch (e: any) { alert(e.message) }
}
refreshSkills()
getApiKey().then(k => { apiKey.value = k })

// --- Provider management ---
const providerList = providers as AiProvider[]
const providerEditingIdx = ref(-1)
const providerForm = ref({ name: '', id: '', baseUrl: '', apiKey: '', modelsStr: '' })

function addProviderDialog() {
  providerForm.value = { name: '', id: '', baseUrl: '', apiKey: '', modelsStr: '' }
  providerList.push({ id: `provider-${Date.now()}`, name: '新供应商', baseUrl: '', apiKey: '', models: [] })
  providerEditingIdx.value = providerList.length - 1
}

function startProviderEdit(idx: number) {
  const p = providerList[idx]
  providerForm.value = { name: p.name, id: p.id, baseUrl: p.baseUrl, apiKey: p.apiKey, modelsStr: p.models.join('\n') }
  providerEditingIdx.value = idx
}

function saveProviderEdit(idx: number) {
  const f = providerForm.value
  if (!f.name.trim() || !f.id.trim() || !f.baseUrl.trim()) { alert('名称、ID 和 Base URL 不能为空'); return }
  const patch: Partial<AiProvider> = {
    name: f.name.trim(),
    id: f.id.trim(),
    baseUrl: f.baseUrl.trim(),
    apiKey: f.apiKey.trim(),
    models: f.modelsStr.split('\n').map(m => m.trim()).filter(Boolean),
  }
  try {
    if (providerList[idx] && providerList[idx].id !== f.id.trim()) {
      deleteProvider(providerList[idx].id)
      addProvider(patch as AiProvider)
    } else {
      updateProvider(providerList[idx].id, patch)
    }
    providerEditingIdx.value = -1
    flashSaved()
  } catch (e: any) { alert(e.message) }
}

function removeProvider(idx: number) {
  const p = providerList[idx]
  if (!confirm(`确定要删除供应商 "${p.name}" 吗？`)) return
  try {
    deleteProvider(p.id)
    flashSaved()
  } catch (e: any) { alert(e.message) }
}

// --- Custom Agent management ---
const agentList = customAgents as CustomAgent[]
const agentEditingIdx = ref(-1)
const agentForm = ref({ name: '', id: '', providerId: '', model: '', selectedSkills: [] as string[], systemPrompt: '' })

// 当前选中供应商的模型列表
const availableModels = computed(() => {
  if (!agentForm.value.providerId) return []
  const p = providerList.find(p => p.id === agentForm.value.providerId)
  return p?.models || []
})

function addAgentDialog() {
  agentForm.value = { name: '', id: '', providerId: providerList[0]?.id || '', model: '', selectedSkills: [], systemPrompt: '' }
  agentList.push({ id: `agent-${Date.now()}`, name: '新 Agent', providerId: providerList[0]?.id || '', model: '', skills: [] })
  agentEditingIdx.value = agentList.length - 1
}

function startAgentEdit(idx: number) {
  const a = agentList[idx]
  agentForm.value = { name: a.name, id: a.id, providerId: a.providerId, model: a.model, selectedSkills: [...a.skills], systemPrompt: a.systemPrompt || '' }
  agentEditingIdx.value = idx
}

function saveAgentEdit(idx: number) {
  const f = agentForm.value
  if (!f.name.trim() || !f.id.trim() || !f.providerId || !f.model.trim()) { alert('名称、ID、供应商和模型不能为空'); return }
  const patch: Partial<CustomAgent> = {
    name: f.name.trim(),
    id: f.id.trim(),
    providerId: f.providerId,
    model: f.model.trim(),
    skills: [...f.selectedSkills],
    systemPrompt: f.systemPrompt.trim() || undefined,
  }
  try {
    if (agentList[idx] && agentList[idx].id !== f.id.trim()) {
      deleteCustomAgent(agentList[idx].id)
      addCustomAgent(patch as CustomAgent)
    } else {
      updateCustomAgent(agentList[idx].id, patch)
    }
    agentEditingIdx.value = -1
    flashSaved()
  } catch (e: any) { alert(e.message) }
}

function removeAgent(idx: number) {
  const a = agentList[idx]
  if (!confirm(`确定要删除 Agent "${a.name}" 吗？`)) return
  try {
    deleteCustomAgent(a.id)
    flashSaved()
  } catch (e: any) { alert(e.message) }
}

function activateAgent(id: string) {
  setActiveAgent(id)
  flashSaved()
}

function getAgentProviderName(a: CustomAgent): string {
  const p = providerList.find(p => p.id === a.providerId)
  return p ? p.name : a.providerId
}
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
.sl{display:flex;flex-direction:column;gap:4px}.si{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f9f9f9;border-radius:6px;font-size:13px}.sn{font-weight:600;color:#333;white-space:nowrap}.sd{flex:1;color:#999;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sx{border:none;background:none;color:#e53935;cursor:pointer;font-size:14px;padding:2px 6px}.sib{border:1px solid #4CAF50;color:#4CAF50;background:white;border-radius:4px;cursor:pointer;font-size:12px;padding:2px 8px;white-space:nowrap}.sib:hover{background:#E8F5E9}
.skill-list{display:flex;flex-direction:column;gap:6px;margin-bottom:4px}
.skill-item{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f9f9f9;border-radius:6px;font-size:13px}
.skill-edit-form{background:#f5f5f5;border-radius:8px;padding:10px}
.skill-empty{font-size:13px;color:#bbb;text-align:center;margin:8px 0}
.sib.save{border-color:#1976D2;color:#1976D2}.sib.save:hover{background:#E3F2FD}
.skill-item.active{background:#E3F2FD;border:1px solid #1976D2}
.skill-checkboxes{display:flex;flex-wrap:wrap;gap:6px}
.skill-cb-label{font-size:12px;display:flex;align-items:center;gap:3px;cursor:pointer;padding:2px 6px;border-radius:4px;background:#f0f0f0}
.skill-cb-label:hover{background:#e0e0e0}

/* ---- Network toggle ---- */
.toggle-row{display:flex;align-items:center;justify-content:space-between}
.toggle-desc{display:block;font-size:12px;color:#bbb;margin-top:2px}
.toggle-hint{font-size:12px;color:#999;margin-top:6px}
.switch{position:relative;display:inline-block;width:48px;height:26px;flex-shrink:0}
.switch input{opacity:0;width:0;height:0}
.switch .slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:#ccc;border-radius:26px;transition:0.3s}
.switch .slider:before{position:absolute;content:"";height:20px;width:20px;left:3px;bottom:3px;background-color:white;border-radius:50%;transition:0.3s}
.switch input:checked+.slider{background-color:#1976D2}
.switch input:checked+.slider:before{transform:translateX(22px)}
</style>
