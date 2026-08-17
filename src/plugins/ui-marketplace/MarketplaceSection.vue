<template>
  <div class="plugin-marketplace">
    <h3>🧩 本地插件</h3>
    <p class="hint">通过 CLI 安装源码插件，或导入预编译 <code>.amiba-plugin</code> 包。</p>

    <section>
      <button :disabled="installing" @click="fileInput?.click()">
        {{ installing ? '安装中...' : '📦 导入 .amiba-plugin 包' }}
      </button>
      <input ref="fileInput" type="file" accept=".zip,.amiba-plugin" style="display:none" @change="onImportFile" />
      <p v-if="message" class="message">{{ message }}</p>
    </section>

    <section>
      <h4>已启用本地插件</h4>
      <p v-if="localPlugins.length === 0" class="empty">暂无本地插件。</p>
      <table v-else>
        <thead>
          <tr><th>ID</th><th>包名</th><th>kind</th><th>order</th></tr>
        </thead>
        <tbody>
          <tr v-for="plugin in localPlugins" :key="plugin.id">
            <td>{{ plugin.id }}</td>
            <td>{{ plugin.name }}</td>
            <td>{{ plugin.kind }}</td>
            <td>{{ plugin.order }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section>
      <h4>运行时装配状态</h4>
      <p v-if="instances.length === 0" class="empty">内核尚未提供装配信息。</p>
      <table v-else>
        <thead>
          <tr><th>实例</th><th>插件</th><th>状态</th><th>错误</th></tr>
        </thead>
        <tbody>
          <tr v-for="instance in instances" :key="instance.instanceId">
            <td>{{ instance.instanceId }}</td>
            <td>{{ instance.pluginId }}</td>
            <td :data-status="instance.status">{{ instance.status }}</td>
            <td>{{ instance.error ?? '-' }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { pluginManagerService } from '../plugin-manager/service'

defineOptions({ name: 'PluginMarketplaceSection' })

const localPlugins = computed(() => pluginManagerService.listLocalPlugins())
const instances = computed(() => pluginManagerService.listInstances())

const fileInput = ref<HTMLInputElement>()
const installing = ref(false)
const message = ref('')

async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  installing.value = true
  message.value = ''
  try {
    const result = await pluginManagerService.installFromFile(file)
    message.value = `✅ 已安装 ${result.id} v${result.version}${result.serviceInstalled ? '（含沙箱服务）' : ''}`
  } catch (error) {
    message.value = `❌ ${error instanceof Error ? error.message : String(error)}`
  } finally {
    installing.value = false
  }
}
</script>

<style scoped>
.plugin-marketplace {
  padding: 16px;
}
.hint,
.empty {
  color: var(--color-text-secondary);
  font-size: 12px;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0 16px;
}
th,
td {
  border: 1px solid var(--color-border);
  padding: 6px 8px;
  text-align: left;
  font-size: 12px;
}
td[data-status='failed'] {
  color: var(--color-error);
}
</style>
