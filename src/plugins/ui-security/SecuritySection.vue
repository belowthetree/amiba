<template>
  <div class="plugin-security">
    <h3>🛡 插件安全</h3>

    <section>
      <h4>权限声明</h4>
      <p v-if="policies.length === 0" class="empty">暂无权限策略。</p>
      <table v-else>
        <thead>
          <tr><th>插件</th><th>allow</th><th>deny</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in policies" :key="item.pluginId">
            <td>{{ item.pluginId }}</td>
            <td>{{ (item.policy.allow ?? []).join(', ') || '-' }}</td>
            <td>{{ (item.policy.deny ?? []).join(', ') || '-' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section>
      <h4>权限审计（最近 200 条）</h4>
      <p v-if="auditLog.length === 0" class="empty">暂无审计记录。</p>
      <table v-else>
        <thead>
          <tr><th>时间</th><th>插件</th><th>能力</th><th>目标</th><th>结果</th></tr>
        </thead>
        <tbody>
          <tr v-for="(entry, index) in auditLog" :key="index">
            <td>{{ entry.at }}</td>
            <td>{{ entry.pluginId }}</td>
            <td>{{ entry.capability }}</td>
            <td>{{ entry.target ?? '-' }}</td>
            <td :data-allowed="entry.allowed">{{ entry.allowed ? 'allow' : 'deny' }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { pluginManagerService } from '../plugin-manager/service'

defineOptions({ name: 'PluginSecuritySection' })

const policies = computed(() => pluginManagerService.listPolicies())
const auditLog = computed(() => pluginManagerService.getAuditLog().slice(-200).reverse())
</script>

<style scoped>
.plugin-security {
  padding: 16px;
}
.empty {
  color: var(--color-text-secondary);
  font-size: 12px;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0 16px;
  font-size: 11px;
}
th,
td {
  border: 1px solid var(--color-border);
  padding: 6px 8px;
  text-align: left;
  word-break: break-all;
}
td[data-allowed='false'] {
  color: var(--color-error);
}
</style>
