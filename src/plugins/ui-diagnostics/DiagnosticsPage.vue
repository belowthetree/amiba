<!-- ============================================================
  @amiba/ui-diagnostics — 内核装配诊断页
  当前阶段不注册路由；只作为组件通过 diagnostics 服务提供。
  接入内核后，由外部页面把 KernelLoader 作为 source prop 传入。
============================================================ -->
<template>
  <section class="amiba-diagnostics">
    <h1>Amiba 插件诊断</h1>

    <p v-if="!source" class="amiba-diagnostics-empty">
      内核尚未接入。请在装配完成后通过 <code>source</code> 属性传入 KernelLoader。
    </p>

    <template v-else>
      <h2>装配树</h2>
      <p v-if="instances.length === 0" class="amiba-diagnostics-empty">当前没有已装配的插件实例。</p>
      <table v-else class="amiba-diagnostics-table">
        <thead>
          <tr>
            <th>实例</th>
            <th>插件</th>
            <th>状态</th>
            <th>错误</th>
          </tr>
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

      <h2>事件总线</h2>
      <p v-if="events.length === 0" class="amiba-diagnostics-empty">当前没有已注册的事件。</p>
      <ul v-else class="amiba-diagnostics-events">
        <li v-for="event in events" :key="event">{{ event }}</li>
      </ul>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { KernelDiagnosticsSource } from './types'

const props = defineProps<{
  source?: KernelDiagnosticsSource
}>()

const instances = computed(() => props.source?.listInstances() ?? [])
const events = computed(() => props.source?.bus.listEvents() ?? [])
</script>

<style scoped>
.amiba-diagnostics {
  padding: 24px;
  color: var(--amiba-color-text, inherit);
}

.amiba-diagnostics h1,
.amiba-diagnostics h2 {
  margin: 0 0 12px;
}

.amiba-diagnostics-empty {
  color: var(--amiba-color-label-tertiary, #888);
}

.amiba-diagnostics-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 24px;
}

.amiba-diagnostics-table th,
.amiba-diagnostics-table td {
  border: 1px solid var(--amiba-color-border, rgba(128, 128, 128, 0.35));
  padding: 8px 10px;
  text-align: left;
}

.amiba-diagnostics-table [data-status='failed'] {
  color: #d33;
}

.amiba-diagnostics-events {
  padding-left: 20px;
}
</style>
