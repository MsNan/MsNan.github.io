<script setup lang="ts">
defineProps<{ title: string; desc?: string; eyebrow?: string }>()
</script>
<template>
  <header class="page-header">
    <p v-if="eyebrow" class="eyebrow">{{ eyebrow }}</p>
    <h1>{{ title }}</h1>
    <p v-if="desc" class="desc">{{ desc }}</p>
  </header>
</template>
<style scoped>
.page-header { padding: 24px 0 32px; }
.eyebrow { margin: 0 0 8px; font-size: 13px; font-weight: 600; letter-spacing: .12em; color: var(--vp-c-brand-1); text-transform: uppercase; }
h1 { margin: 0; font-size: clamp(28px, 4vw, 40px); font-weight: 750; letter-spacing: -.01em; line-height: 1.25; border: 0; padding: 0; }
.desc { margin: 12px 0 0; color: var(--vp-c-text-2); font-size: 16px; line-height: 1.8; max-width: 640px; }
</style>
