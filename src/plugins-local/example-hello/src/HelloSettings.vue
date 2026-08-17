<template>
  <div class="hello-settings">
    <h3>👋 Hello Plugin</h3>
    <p>这是设置页的插件页签内容。</p>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'HelloSettings' })
</script>

<style scoped>
.hello-settings {
  padding: 16px;
}
</style>
