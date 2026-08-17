<template>
  <div class="hello-dock">{{ message }}</div>
</template>

<script setup lang="ts">
defineOptions({ name: 'HelloDock' })

defineProps<{
  message: string
}>()
</script>

<style scoped>
.hello-dock {
  font-size: 12px;
  color: var(--color-text-secondary);
  padding: 4px 8px;
}
</style>
