<!-- ============================================================
变形虫 (Amiba) — SettingsPage
============================================================ -->
<template>
  <div class="settings-page">
    <h2 class="page-title">⚙️ {{ $t('settings.title') }}</h2>

    <!-- === 标签栏 === -->
    <div class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        :class="['tab-btn', { active: activeTab === tab.key }]"
        @click="activeTab = tab.key"
      >{{ tab.label }}</button>
    </div>

    <!-- ================================================================== -->
    <!-- 标签: 通用 -->
    <!-- ================================================================== -->
    <div v-show="activeTab === 'general'">

      <div class="settings-section">
        <h3 class="section-label">{{ $t('settings.general.apiConfig') }}</h3>

        <div class="form-group">
          <label>{{ $t('settings.general.apiKey') }}</label>
          <input
            :type="showKey ? 'text' : 'password'"
            v-model="settings.api_key"
            class="form-input"
            placeholder="sk-..."
          />
          <button class="toggle-key" @click="showKey = !showKey">
            {{ showKey ? '🙈' : '👁' }}
          </button>
        </div>

        <div class="form-group" v-if="!defaultProviderId">
          <label>{{ $t('settings.general.baseUrl') }}</label>
          <input
            v-model="settings.ai_base_url"
            class="form-input"
            placeholder="https://api.deepseek.com/v1"
          />
        </div>

        <div class="form-group">
          <label>{{ $t('settings.general.defaultProvider') }}</label>
          <select v-model="defaultProviderId" class="form-input" @change="onDefaultProviderChange">
            <option value="">{{ $t('settings.general.noProviderSelected') }}</option>
            <option v-for="p in providerList" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>

        <div class="form-group">
          <label>{{ $t('settings.general.model') }}</label>
          <select v-model="settings.ai_model" class="form-input" v-if="defaultProviderModels.length">
            <option v-for="m in defaultProviderModels" :key="m" :value="m">{{ m }}</option>
          </select>
          <input
            v-else
            v-model="settings.ai_model"
            class="form-input"
            :placeholder="$t('settings.general.customModelPlaceholder')"
            autocomplete="off"
          />
        </div>

        <div class="form-group">
          <label>{{ $t('settings.general.reasoningEffort') }}</label>
          <select v-model="settings.reasoning_effort" class="form-input">
            <option :value="undefined">{{ $t('settings.general.reasoningDefault') }}</option>
            <option value="low">{{ $t('settings.general.reasoningLow') }}</option>
            <option value="medium">{{ $t('settings.general.reasoningMedium') }}</option>
            <option value="high">{{ $t('settings.general.reasoningHigh') }}</option>
            <option value="xhigh">{{ $t('settings.general.reasoningXhigh') }}</option>
            <option value="max">{{ $t('settings.general.reasoningMax') }}</option>
          </select>
        </div>
      </div>

      <div class="settings-section">
        <h3 class="section-label">🏭 {{ $t('settings.general.aiProvider') }}</h3>

        <div v-if="providerList.length" class="skill-list">
          <div v-for="(p, i) in providerList" :key="p.id" class="skill-item">
            <template v-if="providerEditingIdx === i">
              <div class="skill-edit-form">
                <input v-model="providerForm.name" class="form-input" :placeholder="$t('settings.general.providerNamePlaceholder')" style="margin-bottom:4px" />
                <input v-model="providerForm.id" class="form-input" :placeholder="$t('settings.general.providerIdPlaceholder')" style="margin-bottom:4px" />
                <input v-model="providerForm.baseUrl" class="form-input" :placeholder="$t('settings.general.providerBaseUrlPlaceholder')" style="margin-bottom:4px" />
                <input v-model="providerForm.apiKey" class="form-input" :placeholder="$t('settings.general.providerApiKeyPlaceholder')" style="margin-bottom:4px" />
                <textarea v-model="providerForm.modelsStr" class="form-input" :placeholder="$t('settings.general.providerModelsPlaceholder')" rows="2" style="margin-bottom:6px;resize:vertical" />
                <div class="action-row">
                  <button class="sib save" @click="saveProviderEdit(i)">💾 {{ $t('settings.general.save') }}</button>
                  <button class="sx" @click="providerEditingIdx = -1">{{ $t('settings.general.cancel') }}</button>
                </div>
              </div>
            </template>
            <template v-else>
              <span class="sn">{{ p.name }}</span>
              <span class="sd">{{ p.baseUrl }} · {{ p.models.length }} {{ $t('settings.general.modelCount') }}</span>
              <button class="sib" @click="startProviderEdit(i)">✏️</button>
              <button class="sx" @click="removeProvider(i)">✕</button>
            </template>
          </div>
        </div>
        <p v-else class="skill-empty">{{ $t('settings.general.noProviders') }}</p>

        <button class="secondary-btn" style="margin-top:4px" @click="addProviderDialog">
          ➕ {{ $t('settings.general.addProvider') }}
        </button>
      </div>

      <div class="settings-section">
        <h3 class="section-label">🎨 {{ $t('settings.appearance.title') }}</h3>

        <!-- 主题选择下拉 -->
        <div class="form-group">
          <label>{{ $t('settings.appearance.activeTheme') }}</label>
          <select v-model="selectedTheme" class="form-input" @change="handleThemeSwitch">
            <option
              v-for="t in themeListItems"
              :key="t.name"
              :value="t.name"
            >{{ t.name }}{{ t.builtin ? ' (' + $t('settings.appearance.builtinTag') + ')' : '' }}</option>
          </select>
        </div>

        <!-- 配色预览 -->
        <div v-if="Object.keys(themeState.variables).length" class="form-group">
          <label>{{ $t('settings.appearance.colorPreview') }}</label>
          <div class="color-grid">
            <div
              v-for="(val, key) in themeState.variables"
              :key="key"
              class="color-chip"
              :style="{ background: val }"
              :title="`${key}: ${val}`"
            ></div>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <h3 class="section-label">{{ $t('settings.general.appearance') }}</h3>

        <div class="form-group">
          <label>{{ $t('settings.general.themeMode') }}</label>
          <select v-model="settings.theme_mode" class="form-input">
            <option value="system">{{ $t('settings.general.themeSystem') }}</option>
            <option value="light">{{ $t('settings.general.themeLight') }}</option>
            <option value="dark">{{ $t('settings.general.themeDark') }}</option>
          </select>
        </div>

        <div class="form-group">
          <label>{{ $t('settings.general.language') }}</label>
          <select v-model="settings.language" class="form-input">
            <option value="zh-CN">{{ $t('settings.general.languageZh') }}</option>
            <option value="en">{{ $t('settings.general.languageEn') }}</option>
          </select>
        </div>
      </div>

      <div class="settings-section">
        <h3 class="section-label">🌐 {{ $t('settings.general.network') }}</h3>

        <div class="form-group">
          <div class="toggle-row">
            <div>
              <label style="margin-bottom:0">{{ $t('settings.general.lanDiscovery') }}</label>
              <span class="toggle-desc">{{ $t('settings.general.lanDesc') }}</span>
            </div>
            <label class="switch">
              <input type="checkbox" v-model="settings.network_lan_visible" @change="toggleLan" />
              <span class="slider"></span>
            </label>
          </div>
          <p class="toggle-hint" v-if="settings.network_lan_visible">✅ {{ $t('settings.general.lanVisible') }}</p>
          <p class="toggle-hint" v-else>🔒 {{ $t('settings.general.lanHidden') }}</p>
        </div>
      </div>

      <div class="settings-section">
        <h3 class="section-label">🔄 {{ $t('settings.general.backgroundServices') }}</h3>

        <div class="form-group">
          <div class="toggle-row">
            <div>
              <label style="margin-bottom:0">{{ $t('settings.general.backgroundServices') }}</label>
              <span class="toggle-desc">{{ $t('settings.general.backgroundDesc') }}</span>
            </div>
            <label class="switch">
              <input type="checkbox" v-model="settings.background_services_enabled" />
              <span class="slider"></span>
            </label>
          </div>
        </div>

        <div class="form-group" v-if="settings.background_services_enabled">
          <label>{{ $t('settings.general.backgroundMax') }}</label>
          <input type="number" v-model.number="settings.max_background_services" class="form-input" min="1" max="10" style="width:80px" />
          <span class="toggle-hint">{{ $t('settings.general.backgroundMaxHint') }}</span>
        </div>
      </div>

      <div class="settings-section">
        <h3 class="section-label">{{ $t('settings.general.about') }}</h3>
        <div class="about-info">
          <p><strong>{{ $t('settings.general.aboutTitle') }}</strong> v{{ appVersion }}</p>
          <p>{{ $t('settings.general.aboutSubtitle') }}</p>
          <p>{{ $t('settings.general.aboutStack') }}</p>
        </div>
        <div class="update-area">
          <button
            class="secondary-btn"
            :disabled="updateStatus.stage === 'checking' || updateStatus.stage === 'downloading' || updateStatus.stage === 'installing'"
            @click="doCheckUpdate"
          >
            <template v-if="updateStatus.stage === 'checking'">⏳ {{ $t('settings.general.checking') }}</template>
            <template v-else>🔍 {{ $t('settings.general.checkUpdate') }}</template>
          </button>

          <p v-if="updateStatus.stage === 'error'" class="update-msg error">{{ updateStatus.message }}</p>
          <p v-else-if="updateStatus.stage === 'upToDate'" class="update-msg ok">✅ {{ $t('settings.general.upToDate') }} (v{{ updateStatus.currentVersion }})</p>
          <div v-else-if="updateStatus.stage === 'available'" class="update-available">
            <p class="update-msg available">🆕 {{ $t('settings.general.newVersion') }} <strong>v{{ updateStatus.info.latestVersion }}</strong>（当前 v{{ updateStatus.info.currentVersion }}）</p>
            <p v-if="updateStatus.info.body" class="update-notes">{{ updateStatus.info.body }}</p>
            <button class="primary-btn" @click="doDownload(updateStatus.info)">📥 {{ $t('settings.general.directDownload') }}</button>
          </div>
          <div v-else-if="updateStatus.stage === 'downloading'" class="download-progress">
            <p class="update-msg">📥 {{ $t('settings.general.downloading') }} ({{ formatSize(updateStatus.received) }} / {{ formatSize(updateStatus.total) }})</p>
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: downloadPercent + '%' }"></div>
            </div>
            <button class="danger-btn" style="margin-top:8px" @click="doCancelDownload">✕ {{ $t('settings.general.cancelDownload') }}</button>
          </div>
          <p v-else-if="updateStatus.stage === 'installing'" class="update-msg ok">🔧 {{ $t('settings.general.installing') }}</p>
          <div v-else-if="updateStatus.stage === 'downloaded'" class="update-available">
            <p class="update-msg ok">✅ {{ $t('settings.general.downloaded') }} {{ updateStatus.fileName }}</p>
            <button class="primary-btn" @click="doInstall(updateStatus.filePath)">📦 {{ $t('settings.general.installNow') }}</button>
            <button class="secondary-btn" style="margin-left:8px" @click="doRedownload">🔄 {{ $t('settings.general.reDownload') }}</button>
          </div>
          <p v-else-if="updateStatus.stage === 'cancelled'" class="update-msg" style="color:#f57c00">⚠️ {{ $t('settings.general.downloadCancelled') }}</p>
        </div>
      </div>
    </div>

    <!-- ================================================================== -->
    <!-- 标签: 技能 & Agent -->
    <!-- ================================================================== -->
    <div v-show="activeTab === 'skills'">

      <div class="settings-section">
        <h3 class="section-label">🧩 {{ $t('settings.skills.skillManagement') }}</h3>

        <div v-if="userSkills.length" class="skill-cards">
          <div v-for="(skill, i) in userSkills" :key="i" class="skill-card">
            <template v-if="editingIdx === i">
              <div class="skill-edit-form">
                <input v-model="editForm.name" class="form-input" :placeholder="$t('settings.skills.skillNamePlaceholder')" style="margin-bottom:4px" />
                <input v-model="editForm.desc" class="form-input" :placeholder="$t('settings.skills.skillDescPlaceholder')" style="margin-bottom:4px" />
                <input v-model="editForm.kws" class="form-input" :placeholder="$t('settings.skills.skillKwsPlaceholder')" style="margin-bottom:4px" />
                <textarea v-model="editForm.tpl" class="form-input" :placeholder="$t('settings.skills.skillTplPlaceholder')" rows="3" style="margin-bottom:6px;resize:vertical" />
                <div class="action-row">
                  <button class="primary-btn" @click="saveEdit(i)">{{ $t('settings.skills.save') }}</button>
                  <button class="secondary-btn" @click="editingIdx = -1">{{ $t('settings.skills.cancel') }}</button>
                </div>
              </div>
            </template>
            <template v-else>
              <div class="skill-card-body">
                <div class="skill-card-title">{{ skill.name }}</div>
                <div class="skill-card-desc">{{ skill.description }}</div>
              </div>
              <div class="skill-card-actions">
                <button class="action-btn" @click="startEdit(i)">✏️ {{ $t('settings.skills.edit') }}</button>
                <button class="action-btn" @click="exportSkillZip(skill.slug!)">📥 {{ $t('settings.skills.exportZip') }}</button>
                <button class="action-btn" @click="openSkillShareDialog(skill.slug!)">📡 {{ $t('settings.skills.shareLan') }}</button>
                <button class="action-btn danger" @click="removeSkill(i)">🗑 {{ $t('app.delete') }}</button>
              </div>
            </template>
          </div>
        </div>
        <p v-else class="skill-empty">{{ $t('settings.skills.noSkills') }}</p>

        <button class="secondary-btn" style="margin-top:4px" @click="importSkillFolder">📁 {{ $t('settings.skills.importFolder') }}</button>
        <button class="secondary-btn" style="margin-top:4px;margin-left:8px" :disabled="importingSkill" @click="importSkillZip">📦 {{ importingSkill ? '...' : $t('settings.skills.importZip') }}</button>
        <div class="url-import-row" style="margin-top:8px">
          <input
            v-model="importUrl"
            class="form-input url-input"
            :placeholder="$t('settings.skills.importUrlPlaceholder')"
            @keyup.enter="importSkillFromUrl"
          />
          <button class="secondary-btn" :disabled="importingSkill || !importUrl.trim()" @click="importSkillFromUrl">
            🔗 {{ importingSkill ? '...' : $t('settings.skills.importFromUrl') }}
          </button>
        </div>
      </div>

      <div class="settings-section">
        <h3 class="section-label">🤖 {{ $t('settings.skills.customAgent') }}</h3>

        <div v-if="agentList.length" class="skill-list">
          <div v-for="(a, i) in agentList" :key="a.id" class="skill-item" :class="{ active: a.id === settings.active_agent_id }">
            <template v-if="agentEditingIdx === i">
              <div class="skill-edit-form">
                <input v-model="agentForm.name" class="form-input" :placeholder="$t('settings.skills.agentNamePlaceholder')" style="margin-bottom:4px" />
                <input v-model="agentForm.id" class="form-input" :placeholder="$t('settings.skills.agentIdPlaceholder')" style="margin-bottom:4px" />
                <select v-model="agentForm.providerId" class="form-input" style="margin-bottom:4px">
                  <option value="">{{ $t('settings.skills.agentProviderDefault') }}</option>
                  <option v-for="p in providerList" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
                <select v-model="agentForm.model" class="form-input" style="margin-bottom:4px">
                  <option value="">{{ $t('settings.skills.agentModelDefault') }}</option>
                  <option v-for="m in availableModels" :key="m" :value="m">{{ m }}</option>
                </select>
                <select v-model="agentForm.reasoning_effort" class="form-input" style="margin-bottom:4px">
                  <option :value="undefined">{{ $t('settings.skills.agentReasoningDefault') }}</option>
                  <option value="low">{{ $t('settings.general.reasoningLow') }}</option>
                  <option value="medium">{{ $t('settings.general.reasoningMedium') }}</option>
                  <option value="high">{{ $t('settings.general.reasoningHigh') }}</option>
                  <option value="xhigh">{{ $t('settings.general.reasoningXhigh') }}</option>
                  <option value="max">{{ $t('settings.general.reasoningMax') }}</option>
                </select>
                <div class="skill-checkboxes" style="margin-bottom:4px">
                  <label class="skill-cb-label" v-for="s in userSkills" :key="s.name">
                    <input type="checkbox" :value="s.name" v-model="agentForm.selectedSkills" />
                    {{ s.name }}
                  </label>
                </div>
                <textarea v-model="agentForm.systemPrompt" class="form-input" :placeholder="$t('settings.skills.agentSystemPromptPlaceholder')" rows="3" style="margin-bottom:6px;resize:vertical" />
                <div class="action-row">
                  <button class="sib save" @click="saveAgentEdit(i)">💾 {{ $t('settings.skills.save') }}</button>
                  <button class="sx" @click="agentEditingIdx = -1">{{ $t('settings.skills.cancel') }}</button>
                </div>
              </div>
            </template>
            <template v-else>
              <span class="sn">{{ a.name }}</span>
              <span class="sd">{{ getAgentProviderName(a) }} · {{ a.model }}{{ a.id === settings.active_agent_id ? ' ✅' : '' }}</span>
              <button v-if="a.id !== settings.active_agent_id" class="sib" @click="activateAgent(a.id)">{{ $t('settings.skills.activate') }}</button>
              <button class="sib" @click="startAgentEdit(i)">✏️</button>
              <button class="sx" @click="removeAgent(i)">✕</button>
            </template>
          </div>
        </div>
        <p v-else class="skill-empty">{{ $t('settings.skills.noAgents') }}</p>

        <button class="secondary-btn" style="margin-top:4px" @click="addAgentDialog">
          ➕ {{ $t('settings.skills.addAgent') }}
        </button>
      </div>
    </div>

    <!-- ================================================================== -->
    <!-- 标签: 数据 -->
    <!-- ================================================================== -->
    <div v-show="activeTab === 'data'">

      <div class="settings-section">
        <h3 class="section-label">📦 {{ $t('settings.data.serviceImport') }}</h3>
        <div class="action-row" style="margin-bottom:8px">
          <button class="secondary-btn" @click="scanForServices">🔍 {{ $t('settings.data.scanStorage') }}</button>
          <button class="secondary-btn" @click="addSvcFile">📄 {{ $t('settings.data.selectFile') }}</button>
        </div>
        <div v-if="pending.length" class="sl" style="margin-bottom:8px">
          <div class="si" v-for="(svc,i) in pending" :key="i">
            <span class="sn">{{ svc.name }}</span>
            <span class="sd">{{ svc.desc }}</span>
            <button class="sib" @click="installSvc(i)">{{ $t('settings.data.install') }}</button>
            <button class="sx" @click="pending.splice(i,1)">✕</button>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <h3 class="section-label">💾 {{ $t('settings.data.storage') }}</h3>
        <div class="action-row" style="flex-wrap:wrap;gap:8px">
          <button class="secondary-btn" @click="exportData">📥 {{ $t('settings.data.exportConfig') }}</button>
          <button
            class="danger-btn"
            :disabled="deletingSessions"
            @click="deleteAllSessions"
          >{{ deletingSessions ? $t('settings.data.deleting') : '🗑 ' + $t('settings.data.deleteSessions') }}</button>
        </div>
        <p class="toggle-desc" style="margin-top:8px">{{ $t('settings.data.deleteSessionsHint') }}</p>
        <button class="danger-btn" style="margin-top:12px;width:100%" @click="clearAllData">⚠️ {{ $t('settings.data.clearAllData') }}</button>
      </div>
    </div>

    <!-- ================================================================== -->
    <!-- 标签: 日志 -->
    <!-- ================================================================== -->
    <div v-show="activeTab === 'logs'">

      <div class="settings-section">
        <h3 class="section-label">📋 {{ $t('settings.logs.settings') }}</h3>

        <div class="form-group">
          <div class="toggle-row">
            <label style="margin-bottom:0">{{ $t('settings.logs.enabled') }}</label>
            <label class="switch">
              <input type="checkbox" v-model="settings.log_enabled" @change="onLogConfigChange" />
              <span class="slider"></span>
            </label>
          </div>
        </div>

        <div class="form-group" v-if="settings.log_enabled">
          <label>{{ $t('settings.logs.level') }}</label>
          <select v-model.number="settings.log_level" class="form-input" @change="onLogConfigChange">
            <option :value="0">{{ $t('settings.logs.levels.debug') }}</option>
            <option :value="1">{{ $t('settings.logs.levels.info') }}</option>
            <option :value="2">{{ $t('settings.logs.levels.warn') }}</option>
            <option :value="3">{{ $t('settings.logs.levels.error') }}</option>
          </select>
        </div>

        <div class="form-group" v-if="settings.log_enabled">
          <label>{{ $t('settings.logs.maxFiles') }}</label>
          <input type="number" v-model.number="settings.log_max_files" class="form-input" min="1" max="50" style="width:120px" />
        </div>

        <div class="form-group" v-if="settings.log_enabled">
          <label>{{ $t('settings.logs.maxSize') }}</label>
          <input type="number" v-model.number="settings.log_max_size_mb" class="form-input" min="1" max="100" style="width:120px" />
        </div>
      </div>

      <div class="settings-section">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <h3 class="section-label" style="margin-bottom:0">📁 {{ $t('settings.logs.files') }}</h3>
          <div style="display:flex;gap:6px">
            <button class="secondary-btn" style="font-size:12px;padding:4px 10px" @click="refreshLogFiles">🔄</button>
            <button class="danger-btn" style="font-size:12px;padding:4px 10px" @click="doClearAllLogs">🗑 {{ $t('settings.logs.actions.clearAll') }}</button>
          </div>
        </div>
        <div v-if="logFiles.length" class="log-file-list">
          <div
            v-for="f in logFiles"
            :key="f.name"
            :class="['log-file-item', { active: selectedLogFile === f.name }]"
            @click="selectLogFile(f.name)"
          >
            <span class="log-file-name">{{ f.name }}</span>
            <span class="log-file-meta">{{ formatSize(f.size) }}</span>
            <button class="log-file-del" @click.stop="doDeleteLogFile(f.name)">✕</button>
          </div>
        </div>
        <p v-else class="skill-empty">{{ $t('settings.logs.noLogs') }}</p>
      </div>

      <div class="settings-section" v-if="selectedLogFile">
        <h3 class="section-label">🔍 {{ $t('settings.logs.viewer') }}</h3>

        <div class="log-controls">
          <div class="log-level-filters">
            <label
              v-for="lvl in ['DEBUG','INFO','WARN','ERROR']"
              :key="lvl"
              :class="['log-lvl-btn', { active: logFilterLevels.includes(lvl) }]"
            >
              <input type="checkbox" :value="lvl" v-model="logFilterLevels" />
              <span :class="'level-badge level-' + lvl.toLowerCase()">{{ lvl }}</span>
            </label>
          </div>
          <div class="log-search-row" style="margin-bottom:8px">
            <input
              v-model="logSearch"
              class="form-input log-search-input"
              :placeholder="$t('settings.logs.search')"
              @input="onLogSearch"
            />
            <button class="secondary-btn" style="font-size:12px;padding:6px 10px" @click="doExportLog">
              📥 {{ $t('settings.logs.actions.export') }}
            </button>
          </div>
        </div>

        <div class="log-table-wrap">
          <table class="log-table" v-if="filteredLogEntries.length">
            <thead>
              <tr>
                <th class="col-time">{{ $t('settings.logs.columns.time') }}</th>
                <th class="col-level">{{ $t('settings.logs.columns.level') }}</th>
                <th class="col-module">{{ $t('settings.logs.columns.module') }}</th>
                <th class="col-msg">{{ $t('settings.logs.columns.message') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(entry, i) in filteredLogEntries"
                :key="i"
                :class="'log-row level-' + entry.level.toLowerCase()"
              >
                <td class="col-time">{{ formatLogTime(entry.time) }}</td>
                <td class="col-level"><span :class="'level-badge level-' + entry.level.toLowerCase()">{{ entry.level }}</span></td>
                <td class="col-module">{{ entry.module }}</td>
                <td class="col-msg">{{ entry.message }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="skill-empty">{{ logSearch ? $t('settings.logs.noLogs') : $t('settings.logs.noContent') }}</p>
        </div>
      </div>

      <!-- Crash 诊断 -->
      <div v-if="tombstoneText" class="settings-section" style="margin-top:20px">
        <h3 class="section-label">🪦 上次崩溃诊断 (Native Crash)</h3>
        <div class="log-table-wrap" style="max-height:300px">
          <pre class="tombstone-block">{{ tombstoneText }}</pre>
        </div>
        <button class="secondary-btn" style="margin-top:6px;font-size:12px" @click="copyTombstone">
          📋 {{ tombstoneCopied ? '已复制!' : '复制堆栈信息' }}
        </button>
      </div>

      <div class="settings-section" v-else>
        <p class="skill-empty">{{ $t('settings.logs.noContent') }}</p>
      </div>
    </div>

    <div class="saved-hint" v-if="showSaved">✅ {{ $t('settings.confirm.saved') }}</div>
    <SkillShareDialog v-model="shareSkillDialog" :preselect-slug="shareSkillSlug" />

    <!-- 插槽: settings.extra -->
    <SlotRenderer name="settings.extra" :html="slotHtml('settings.extra')" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { settings } from '../config/config'
import { storageClear, storageKeys, storageGet, listServiceDirs, readServiceFile } from '../config/storage'
import { registerService, storeServicePackage, getServicePackage } from '../host/registry'
import { setVisibility, getVisibility } from '../host/network-bridge'
import type { ServicePackage, ServiceManifest } from '../types/service'
import { loadUserSkills, addUserSkill, updateUserSkill, deleteUserSkill, importSkillFromFolder, type Skill } from '../ai/skills'
import { pickAndImportZip, exportAndSaveZip, importSkillFromUrl as fetchImportUrl } from '../ai/skill-zip'
import { pickFolder } from '../config/folder-picker'
import { providers, addProvider, updateProvider, deleteProvider, initProviderStore } from '../ai/provider-store'
import { customAgents, addCustomAgent, updateCustomAgent, deleteCustomAgent, setActiveAgent, initCustomAgentStore } from '../ai/custom-agent-store'
import type { AiProvider, CustomAgent } from '../types/service'
import { getCurrentVersion, checkForUpdate, downloadUpdate, installUpdate, getCachedUpdate, type UpdateStatus, type UpdateInfo } from '../config/updater'
import { listSessions, deleteSession } from '../ai/session'
import { getLogFiles, readLogFile, deleteLogFile, clearAllLogs, exportLogFile as exportLog, formatSize, type LogFileInfo, type LogEntry } from '../config/logger'
import SkillShareDialog from './SkillShareDialog.vue'
import SlotRenderer from '../components/SlotRenderer.vue'
import { themeState, switchTheme, isBuiltinTheme } from '../config/theme-store'

const { t } = useI18n()

const slotHtml = (name: string) => themeState.slots[name] || ''

// ---- 外观 ----

const selectedTheme = ref(themeState.activeTheme)

const themeListItems = computed(() =>
  themeState.themes.map((name) => ({
    name,
    builtin: isBuiltinTheme(name),
  }))
)

async function handleThemeSwitch() {
  if (selectedTheme.value === themeState.activeTheme) return
  try {
    await switchTheme(selectedTheme.value)
  } catch (e: any) {
    alert(e.message)
    selectedTheme.value = themeState.activeTheme
  }
}

const appVersion = ref('...')
const activeTab = ref('general')
const tabs = computed(() => [
  { key: 'general', label: t('settings.tabs.general') },
  { key: 'skills', label: t('settings.tabs.skills') },
  { key: 'data', label: t('settings.tabs.data') },
  { key: 'logs', label: t('settings.tabs.logs') },
])
const updateStatus = ref<UpdateStatus>({ stage: 'idle' })
const showKey = ref(false)
const showSaved = ref(false); const pending = ref<any[]>([])
const deletingSessions = ref(false)

// --- Log management ---
const logFiles = ref<LogFileInfo[]>([])
const selectedLogFile = ref('')
const logEntries = ref<LogEntry[]>([])
const logFilterLevels = ref<string[]>(['DEBUG', 'INFO', 'WARN', 'ERROR'])
const logSearch = ref('')
let logSearchTimer: ReturnType<typeof setTimeout> | null = null

// --- Crash 诊断 ---
const tombstoneText = ref('')
const tombstoneCopied = ref(false)

const filteredLogEntries = computed(() => {
  let entries = logEntries.value
  if (logSearch.value.trim()) {
    const q = logSearch.value.toLowerCase()
    entries = entries.filter(e =>
      e.message.toLowerCase().includes(q) ||
      e.module.toLowerCase().includes(q)
    )
  }
  if (logFilterLevels.value.length < 4) {
    entries = entries.filter(e => logFilterLevels.value.includes(e.level))
  }
  return entries
})

async function refreshLogFiles() {
  logFiles.value = await getLogFiles()
}

async function selectLogFile(name: string) {
  selectedLogFile.value = name
  logEntries.value = await readLogFile(name)
  logSearch.value = ''
}

async function doDeleteLogFile(name: string) {
  if (!confirm(t('settings.confirm.deleteLogFile'))) return
  await deleteLogFile(name)
  if (selectedLogFile.value === name) {
    selectedLogFile.value = ''
    logEntries.value = []
  }
  await refreshLogFiles()
}

async function doClearAllLogs() {
  if (!confirm(t('settings.confirm.clearAllLogs'))) return
  await clearAllLogs()
  selectedLogFile.value = ''
  logEntries.value = []
  await refreshLogFiles()
}

async function doExportLog() {
  if (!selectedLogFile.value) return
  try {
    const blob = await exportLog(selectedLogFile.value)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = selectedLogFile.value
    a.click()
    URL.revokeObjectURL(url)
  } catch { /* ignore */ }
}

function formatLogTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('zh-CN', { hour12: false })
  } catch { return iso }
}

function onLogSearch() {
  if (logSearchTimer) clearTimeout(logSearchTimer)
  logSearchTimer = setTimeout(() => {
    // trigger reactive update
  }, 200)
}

function onLogConfigChange() {
  flashSaved()
}

async function loadTombstone() {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const text = await invoke<string>('read_tombstone')
    tombstoneText.value = text
  } catch {
    tombstoneText.value = ''
  }
}

async function copyTombstone() {
  try {
    await navigator.clipboard.writeText(tombstoneText.value)
    tombstoneCopied.value = true
    setTimeout(() => { tombstoneCopied.value = false }, 2000)
  } catch { /* clipboard denied */ }
}

// Load log files on tab switch
watch(activeTab, (tab) => {
  if (tab === 'logs') {
    refreshLogFiles()
    loadTombstone()
  }
})

// --- Network visibility ---

async function toggleLan() {
  const vis = { lan: settings.network_lan_visible, ble: false }
  try {
    await setVisibility(vis)
    flashSaved()
  } catch { /* non-Tauri env */ }
}

// Init network toggle state — 仅同步 UI，setVisibility 已由 initNetworkBridge 处理
;(async () => {
  try {
    const vis = await getVisibility()
    settings.network_lan_visible = vis.lan
  } catch { /* use default */ }
})()

// --- Skill management ---
const userSkills = ref<Skill[]>([])
const editingIdx = ref(-1)
const editForm = ref({ name: '', desc: '', kws: '', tpl: '' })
const shareSkillDialog = ref(false)
const shareSkillSlug = ref('')
const importingSkill = ref(false)
const importUrl = ref('')

let saveTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => ({ ...settings }),
  () => {
    flashSaved()
  },
  { deep: true, flush: 'sync' }
)

function flashSaved() {
  showSaved.value = true
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    showSaved.value = false
  }, 1500)
}

async function clearAllData() {
  if (confirm(t('settings.confirm.clearAllData'))) {
    await storageClear()
    location.reload()
  }
}

async function deleteAllSessions() {
  if (!confirm(t('settings.confirm.deleteSessions'))) return
  deletingSessions.value = true
  try {
    const sessions = await listSessions()
    for (const s of sessions) {
      await deleteSession(s.id)
    }
    console.log('[Settings]', t('settings.dialect.deletedAllSessions'), '—', sessions.length, '个')
    flashSaved()
  } catch (e: any) {
    alert((e.message || String(e)))
  } finally {
    deletingSessions.value = false
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

async function installSvc(idx: number) { const s: any = pending.value[idx]; if (!s) return; try { const pkg: ServicePackage = s.data; const m: any = { id: pkg.manifest.id || ("user." + s.id), name: pkg.manifest.name || s.name, version: pkg.manifest.version || "1.0.0", description: pkg.manifest.description || "", permissions: pkg.manifest.permissions || [] }; await registerService(m, "ai-generated"); await storeServicePackage(m.id, pkg); pending.value.splice(idx, 1); flashSaved() } catch (e: any) { console.error(e); alert(t('settings.confirm.installFailed') + ": " + e.message) } }

async function scanForServices() { let count = 0; const dirs = await listServiceDirs(); console.log("[Scan] service dirs:", dirs); for (const dir of dirs) { try { const raw = await readServiceFile(dir, 'manifest.json'); if (!raw) continue; const manifest: ServiceManifest = JSON.parse(raw); const pkg = await getServicePackage(dir); if (!pkg) continue; await registerService(manifest, 'ai-generated'); await storeServicePackage(manifest.id, pkg); console.log("[Scan] installed:", manifest.name); count++; } catch (e) { console.log("[Scan] skip:", dir, e) } } if (count > 0) { alert(t('settings.dialect.installedNServices', { n: count })); location.reload() } else { alert(t('settings.dialect.noServicesFound')) } }

// --- Skill management functions ---
async function refreshSkills() { userSkills.value = await loadUserSkills() }

async function importSkillFolder() {
  try {
    const dir = await pickFolder('选择 Skill 文件夹')
    if (!dir) return
    await importSkillFromFolder(dir)
    await refreshSkills()
    flashSaved()
  } catch (e: any) {
    alert(t('settings.confirm.importFailed') + ': ' + e.message)
  }
}

async function importSkillZip() {
  importingSkill.value = true
  try {
    const slug = await pickAndImportZip()
    await refreshSkills()
    flashSaved()
    console.log('[Settings] ZIP 导入完成:', slug)
  } catch (e: any) {
    if (e.message !== '用户取消') {
      alert(t('settings.confirm.importZipFailed', { reason: e.message }))
    }
  } finally {
    importingSkill.value = false
  }
}

async function exportSkillZip(slug: string) {
  try {
    await exportAndSaveZip(slug)
    flashSaved()
  } catch (e: any) {
    alert(t('settings.confirm.importZipFailed', { reason: e.message }))
  }
}

function openSkillShareDialog(slug: string) {
  shareSkillSlug.value = slug
  shareSkillDialog.value = true
}

async function importSkillFromUrl() {
  const url = importUrl.value.trim()
  if (!url) return
  importingSkill.value = true
  try {
    const slug = await fetchImportUrl(url)
    importUrl.value = ''
    await refreshSkills()
    flashSaved()
    console.log('[Settings] URL 导入完成:', slug)
  } catch (e: any) {
    alert(t('settings.confirm.importZipFailed', { reason: e.message }))
  } finally {
    importingSkill.value = false
  }
}

function startEdit(idx: number) {
  const s = userSkills.value[idx]; editingIdx.value = idx
  editForm.value = { name: s.name, desc: s.description, kws: s.keywords.join(', '), tpl: s.template }
}
async function saveEdit(idx: number) {
  const f = editForm.value; const oldName = userSkills.value[idx].name
  if (!f.name.trim() || !f.desc.trim()) { alert(t('settings.confirm.nameDescRequired')); return }
  try {
    await updateUserSkill(oldName, { name: f.name.trim(), description: f.desc.trim(), keywords: f.kws.split(/[,，]/).map(k => k.trim()).filter(Boolean), template: f.tpl })
    await refreshSkills(); editingIdx.value = -1; flashSaved()
  } catch (e: any) { alert(e.message) }
}
async function removeSkill(idx: number) {
  const s = userSkills.value[idx]
  if (!confirm(t('settings.confirm.deleteSkill', { name: s.name }))) return
  try {
    await deleteUserSkill(s.name)
    await refreshSkills(); flashSaved()
  } catch (e: any) { alert(e.message) }
}
refreshSkills()

// --- Provider management ---
const providerList = providers as AiProvider[]
const providerEditingIdx = ref(-1)
const providerForm = ref({ name: '', id: '', baseUrl: '', apiKey: '', modelsStr: '' })

function addProviderDialog() {
  providerForm.value = { name: '', id: '', baseUrl: '', apiKey: '', modelsStr: '' }
  providerList.push({ id: `provider-${Date.now()}`, name: t('settings.skills.newProviderName'), baseUrl: '', apiKey: '', models: [] })
  providerEditingIdx.value = providerList.length - 1
}

function startProviderEdit(idx: number) {
  const p = providerList[idx]
  providerForm.value = { name: p.name, id: p.id, baseUrl: p.baseUrl, apiKey: p.apiKey, modelsStr: p.models.join('\n') }
  providerEditingIdx.value = idx
}

function saveProviderEdit(idx: number) {
  const f = providerForm.value
  if (!f.name.trim() || !f.id.trim() || !f.baseUrl.trim()) { alert(t('settings.confirm.providerFieldsRequired')); return }
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
  if (!confirm(t('settings.confirm.deleteProvider', { name: p.name }))) return
  try {
    deleteProvider(p.id)
    flashSaved()
  } catch (e: any) { alert(e.message) }
}

// --- 当前默认供应商的模型列表（通用页签模型下拉框） ---
const defaultProviderId = ref(settings.default_provider_id || '')
const defaultProviderModels = computed(() => {
  if (!defaultProviderId.value) return []
  const p = providerList.find(p => p.id === defaultProviderId.value)
  return p?.models || []
})

function onDefaultProviderChange() {
  settings.default_provider_id = defaultProviderId.value || undefined
  if (defaultProviderId.value) {
    const p = providerList.find(p => p.id === defaultProviderId.value)
    if (p) {
      // 自动填充 base_url
      if (p.baseUrl) settings.ai_base_url = p.baseUrl
      if (p.apiKey) settings.api_key = p.apiKey
      // 如果当前模型不在供应商列表中，清空让其重新选择
      if (p.models.length && !p.models.includes(settings.ai_model)) {
        settings.ai_model = p.models[0]
      }
    }
  }
}

// --- Custom Agent management ---
const agentList = customAgents as CustomAgent[]
const agentEditingIdx = ref(-1)
const agentForm = ref({ name: '', id: '', providerId: '', model: '', selectedSkills: [] as string[], systemPrompt: '', reasoning_effort: '' })

const availableModels = computed(() => {
  if (!agentForm.value.providerId) return []
  const p = providerList.find(p => p.id === agentForm.value.providerId)
  return p?.models || []
})

function addAgentDialog() {
  agentForm.value = { name: '', id: '', providerId: providerList[0]?.id || '', model: '', selectedSkills: [], systemPrompt: '', reasoning_effort: '' }
  agentList.push({ id: `agent-${Date.now()}`, name: t('settings.skills.newAgentName'), providerId: providerList[0]?.id || '', model: '', skills: [] })
  agentEditingIdx.value = agentList.length - 1
}

function startAgentEdit(idx: number) {
  const a = agentList[idx]
  agentForm.value = { name: a.name, id: a.id, providerId: a.providerId, model: a.model, selectedSkills: [...a.skills], systemPrompt: a.systemPrompt || '', reasoning_effort: a.reasoning_effort || '' }
  agentEditingIdx.value = idx
}

function saveAgentEdit(idx: number) {
  const f = agentForm.value
  if (!f.name.trim() || !f.id.trim() || !f.providerId || !f.model.trim()) { alert(t('settings.confirm.agentFieldsRequired')); return }
  const patch: Partial<CustomAgent> = {
    name: f.name.trim(),
    id: f.id.trim(),
    providerId: f.providerId,
    model: f.model.trim(),
    skills: [...f.selectedSkills],
    systemPrompt: f.systemPrompt.trim() || undefined,
    reasoning_effort: (f.reasoning_effort || undefined) as CustomAgent['reasoning_effort'],
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
  if (!confirm(t('settings.confirm.deleteAgent', { name: a.name }))) return
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

// ---- 更新检查 ----

let downloadAbort: AbortController | null = null

const downloadPercent = computed(() => {
  const s = updateStatus.value
  if (s.stage !== 'downloading' || s.total === 0) return 0
  return Math.round((s.received / s.total) * 100)
})

async function doCheckUpdate() {
  updateStatus.value = { stage: 'checking' }
  try {
    const info = await checkForUpdate()
    if (info.hasUpdate) {
      // 检查本地是否已有同版本的缓存文件
      const cached = await getCachedUpdate(info.latestVersion, info.currentVersion)
      if (cached) {
        updateStatus.value = {
          stage: 'downloaded',
          filePath: cached.filePath,
          fileName: cached.fileName,
        }
        return
      }
      updateStatus.value = { stage: 'available', info }
    } else {
      updateStatus.value = { stage: 'upToDate', currentVersion: info.currentVersion, latestVersion: info.latestVersion }
    }
  } catch (e: any) {
    console.error('[Settings] 更新检查失败:', e)
    updateStatus.value = { stage: 'error', message: e.message || t('settings.general.checkFailed') }
  }
}

async function doDownload(info: UpdateInfo) {
  if (!info.downloadUrl) {
    updateStatus.value = { stage: 'error', message: t('settings.general.noPlatformAsset') }
    return
  }

  downloadAbort = new AbortController()

  updateStatus.value = {
    stage: 'downloading',
    received: 0,
    total: 0,
    cancel: () => downloadAbort?.abort(),
  }

  try {
    const result = await downloadUpdate(
      info.downloadUrl,
      info.latestVersion,
      (received, total) => {
        updateStatus.value = {
          stage: 'downloading',
          received,
          total,
          cancel: () => downloadAbort?.abort(),
        }
      },
      downloadAbort.signal,
    )

    updateStatus.value = { stage: 'installing' }
    await installUpdate(result.filePath)
    // 安装已发起，保留文件路径以便重试
    updateStatus.value = {
      stage: 'downloaded',
      filePath: result.filePath,
      fileName: result.fileName,
    }
  } catch (e: any) {
    console.error('[Settings] 下载/安装失败:', e)
    if (e.name === 'AbortError') {
      updateStatus.value = { stage: 'cancelled' }
    } else {
      updateStatus.value = { stage: 'error', message: e.message || String(e) || t('settings.general.downloadFailed') }
    }
  } finally {
    downloadAbort = null
  }
}

async function doInstall(filePath: string) {
  updateStatus.value = { stage: 'installing' }
  try {
    await installUpdate(filePath)
    updateStatus.value = { stage: 'downloaded', filePath, fileName: filePath.split('/').pop() || filePath }
  } catch (e: any) {
    updateStatus.value = { stage: 'error', message: e.message || String(e) || t('settings.general.installFailed') }
  }
}

async function doRedownload() {
  // 清缓存后重新检查
  updateStatus.value = { stage: 'checking' }
  try {
    const info = await checkForUpdate()
    if (info.hasUpdate) {
      updateStatus.value = { stage: 'available', info }
    } else {
      updateStatus.value = { stage: 'upToDate', currentVersion: info.currentVersion, latestVersion: info.latestVersion }
    }
  } catch (e: any) {
    updateStatus.value = { stage: 'error', message: e.message || t('settings.general.checkFailed') }
  }
}

async function doCancelDownload() {
  downloadAbort?.abort()
  // 通知 Rust 端取消流式下载
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('cancel_download')
  } catch { /* ignore */ }
}

onMounted(async () => {
  appVersion.value = await getCurrentVersion()
})
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
  color: var(--color-text);
}

.settings-section {
  background: var(--color-surface);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
  box-shadow: var(--shadow-sm);
}

.section-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.tab-bar {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  background: var(--color-hover-bg);
  border-radius: 10px;
  padding: 3px;
}

.tab-btn {
  flex: 1;
  padding: 8px 12px;
  border: none;
  background: transparent;
  border-radius: 8px;
  font-size: 13px;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.tab-btn.active {
  background: var(--color-surface);
  color: var(--color-primary);
  font-weight: 600;
  box-shadow: var(--shadow-md);
}

.tab-btn:hover:not(.active) {
  color: var(--color-text);
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
  color: var(--color-text-secondary);
  margin-bottom: 4px;
}

.form-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
}

.form-input:focus {
  border-color: var(--color-primary);
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
  border: 1px solid var(--color-error);
  color: var(--color-error);
  background: var(--color-surface);
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}

.danger-btn:hover {
  background: var(--color-warning-light);
}

.secondary-btn {
  padding: 8px 16px;
  border: 1px solid var(--color-primary);
  color: var(--color-primary);
  background: var(--color-surface);
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}
.secondary-btn:hover {
  background: var(--color-primary-light);
}

.about-info {
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.8;
}

.saved-hint {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--color-text);
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

/* --- inline service list --- */
.sl {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.si {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--color-bg);
  border-radius: 6px;
  font-size: 13px;
}
.sn {
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
}
.sd {
  flex: 1;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sx {
  border: none;
  background: none;
  color: var(--color-error);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 6px;
}
.sib {
  border: 1px solid var(--color-success);
  color: var(--color-success);
  background: var(--color-surface);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  padding: 2px 8px;
  white-space: nowrap;
}
.sib:hover {
  background: var(--color-success-light);
}

.skill-list{display:flex;flex-direction:column;gap:6px;margin-bottom:4px}
.skill-item{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--color-bg);border-radius:6px;font-size:13px}
.skill-edit-form{padding:10px}
.skill-empty{font-size:13px;color:var(--color-text-muted);text-align:center;margin:8px 0}
.sib.save{border-color:var(--color-primary);color:var(--color-primary)}
.sib.save:hover{background:var(--color-primary-light)}
.skill-item.active{background:var(--color-primary-light);border:1px solid var(--color-primary)}
.skill-checkboxes{display:flex;flex-wrap:wrap;gap:6px}
.skill-cb-label{font-size:12px;display:flex;align-items:center;gap:3px;cursor:pointer;padding:2px 6px;border-radius:4px;background:var(--color-hover-bg)}
.skill-cb-label:hover{background:var(--color-hover-bg)}

/* ---- Skill cards ---- */
.skill-cards{display:flex;flex-direction:column;gap:8px;margin-bottom:8px}
.skill-card{background:var(--color-surface);border:1px solid var(--color-border);border-radius:10px;padding:14px 16px;transition:box-shadow 0.2s}
.skill-card:hover{box-shadow:var(--shadow-sm)}
.skill-card-body{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}
.skill-card-title{font-size:14px;font-weight:600;color:var(--color-text)}
.skill-card-desc{font-size:12px;color:var(--color-text-secondary);line-height:1.5}
.skill-card-actions{display:flex;gap:6px;flex-wrap:wrap}
.action-btn{padding:5px 10px;border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text-secondary);border-radius:6px;font-size:12px;cursor:pointer;white-space:nowrap;transition:all 0.15s}
.action-btn:hover{background:var(--color-bg);border-color:var(--color-primary);color:var(--color-primary)}
.action-btn.danger:hover{background:var(--color-warning-light);border-color:var(--color-error);color:var(--color-error)}
.url-import-row{display:flex;gap:6px;align-items:center}
.url-import-row .url-input{flex:1}

/* ---- Network toggle ---- */
.toggle-row{display:flex;align-items:center;justify-content:space-between}
.toggle-desc{display:block;font-size:12px;color:var(--color-text-muted);margin-top:2px}
.toggle-hint{font-size:12px;color:var(--color-text-secondary);margin-top:6px}
.switch{position:relative;display:inline-block;width:48px;height:26px;flex-shrink:0}
.switch input{opacity:0;width:0;height:0}
.switch .slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:var(--color-text-muted);border-radius:26px;transition:0.3s}
.switch .slider:before{position:absolute;content:"";height:20px;width:20px;left:3px;bottom:3px;background-color:var(--color-surface);border-radius:50%;transition:0.3s}
.switch input:checked+.slider{background-color:var(--color-primary)}
.switch input:checked+.slider:before{transform:translateX(22px)}

/* ---- Update check ---- */
.update-area{margin-top:12px;display:flex;flex-direction:column;gap:8px}
.update-area .secondary-btn:disabled{opacity:.5;cursor:not-allowed}
.update-msg{font-size:13px;margin:4px 0;line-height:1.5}
.update-msg.error{color:var(--color-error)}
.update-msg.ok{color:var(--color-success)}
.update-msg.available{color:var(--color-text)}
.update-notes{font-size:12px;color:var(--color-text-secondary);margin:4px 0;max-height:80px;overflow-y:auto;white-space:pre-wrap;line-height:1.5;background:var(--color-bg);padding:8px;border-radius:6px}
.primary-btn{padding:8px 16px;background:var(--color-primary);color:white;border:none;border-radius:8px;font-size:13px;cursor:pointer}
.primary-btn:hover{background:var(--color-primary-hover)}
.progress-bar{width:100%;height:8px;background:var(--color-hover-bg);border-radius:4px;overflow:hidden}
.progress-fill{height:100%;background:var(--color-primary);border-radius:4px;transition:width .3s ease}
.download-progress{display:flex;flex-direction:column;gap:4px}

/* ---- Log viewer ---- */
.log-file-list{display:flex;flex-direction:column;gap:2px;max-height:200px;overflow-y:auto}
.log-file-item{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--color-bg);border-radius:6px;font-size:12px;cursor:pointer;transition:background 0.15s}
.log-file-item:hover{background:var(--color-primary-light)}
.log-file-item.active{background:var(--color-primary-light);border:1px solid var(--color-primary)}
.log-file-name{flex:1;font-family:monospace;color:var(--color-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.log-file-meta{color:var(--color-text-secondary);white-space:nowrap}
.log-file-del{border:none;background:none;color:var(--color-error);cursor:pointer;font-size:14px;padding:0 4px}
.log-file-del:hover{color:var(--color-error-dark)}
.log-controls{margin-bottom:8px}
.log-level-filters{display:flex;gap:6px;margin-bottom:8px}
.log-lvl-btn{display:flex;align-items:center;gap:2px;cursor:pointer;font-size:12px}
.log-lvl-btn input{display:none}
.log-lvl-btn .level-badge{opacity:0.4;transition:opacity 0.15s}
.log-lvl-btn.active .level-badge{opacity:1}
.log-search-row{display:flex;gap:6px}
.log-search-input{flex:1;font-size:13px;padding:6px 10px}
.log-table-wrap{max-height:400px;overflow:auto}
.log-table{width:100%;border-collapse:collapse;font-size:12px}
.log-table th{position:sticky;top:0;background:var(--color-bg);padding:6px 8px;text-align:left;font-weight:600;color:var(--color-text-secondary);border-bottom:2px solid var(--color-border);z-index:1}
.log-table td{padding:5px 8px;border-bottom:1px solid var(--color-border-light, #f0f0f0);vertical-align:top}
.col-time{width:80px;white-space:nowrap;font-family:monospace;color:var(--color-text-secondary)}
.col-level{width:60px;white-space:nowrap}
.col-module{width:100px;white-space:nowrap;color:var(--color-primary)}
.col-msg{word-break:break-word}
.log-row:hover{background:var(--color-primary-light)}
.log-row.level-error{background:var(--color-error-light)}
.log-row.level-error:hover{background:var(--color-error-light)}
.log-row.level-warn{background:var(--color-warning-light)}
.log-row.level-warn:hover{background:var(--color-warning-light)}
.level-badge{display:inline-block;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:600;white-space:nowrap}
.level-debug{background:var(--color-hover-bg);color:var(--color-text-secondary)}
.level-info{background:var(--color-primary-light);color:var(--color-primary-hover)}
.level-warn{background:var(--color-warning-light);color:var(--color-warning)}
.level-error{background:var(--color-error-light);color:var(--color-error-dark)}

/* ---- Tombstone (crash diagnostics) ---- */
.tombstone-block {
  margin: 0;
  padding: 12px;
  background: #1a1a2e;
  color: #e0e0e0;
  font-family: 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre;
  overflow-x: auto;
  border-radius: 8px;
}

/* === 外观 Tab === */
.theme-active-badge{display:flex;align-items:center;gap:8px}
.theme-active-name{font-weight:600;font-size:15px;color:var(--color-text)}
.theme-tag{font-size:10px;padding:2px 6px;border-radius:4px;font-weight:600}
.theme-tag.builtin{background:var(--color-primary-light);color:var(--color-primary-hover)}
.theme-tag.user{background:var(--color-success-light);color:#2E7D32}
.theme-list{display:flex;flex-direction:column;gap:4px}
.theme-item{display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;cursor:pointer;transition:background .15s}
.theme-item:hover{background:var(--color-bg)}
.theme-item.active{background:var(--color-primary-light);font-weight:600}
.theme-item-name{flex:1;font-size:14px}
.theme-item-del{width:24px;height:24px;border:none;background:none;color:var(--color-text-secondary);cursor:pointer;font-size:14px;border-radius:4px;display:flex;align-items:center;justify-content:center}
.theme-item-del:hover{background:var(--color-error-light);color:var(--color-error-dark)}
.theme-create-row{display:flex;gap:8px;align-items:center}
.theme-create-row .form-input{flex:1}
.theme-create-row .action-btn{white-space:nowrap;padding:8px 16px;background:var(--color-primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px}
.color-grid{display:flex;flex-wrap:wrap;gap:8px}
.color-chip{width:32px;height:32px;border-radius:6px;border:1px solid var(--color-border);cursor:default}
</style>
