<script setup lang="ts">
import { computed } from 'vue'
import { withBase } from 'vitepress'
import { data as posts } from '../posts.data'
const years = computed(() => {
  const m: Record<string, typeof posts> = {}
  posts.forEach((p) => (m[p.date.slice(0, 4)] ||= []).push(p))
  return Object.entries(m).sort((a, b) => b[0].localeCompare(a[0]))
})
</script>
<template>
  <p>共 {{ posts.length }} 篇文章</p>
  <section v-for="[y, ps] in years" :key="y">
    <h2 :id="'y' + y">{{ y }} <small>（{{ ps.length }} 篇）</small></h2>
    <ul class="arc">
      <li v-for="p in ps" :key="p.url"><span class="d">{{ p.date.slice(5) }}</span><a :href="withBase(p.url)">{{ p.title }}</a></li>
    </ul>
  </section>
</template>
<style scoped>
.arc { list-style: none; padding: 0; }
.arc li { display: flex; gap: 12px; padding: 6px 0; }
.d { color: var(--vp-c-text-3); font-family: var(--vp-font-family-mono); flex: none; }
</style>
