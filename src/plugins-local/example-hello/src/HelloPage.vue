<template>
  <div class="hello-page">
    <h2>👋 Hello Plugin</h2>
    <p>这是一个由页面注册表注入的示例页面。</p>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'HelloPage' })
</script>

<style scoped>
.hello-page {
  padding: 24px;
}
</style>
