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
  <div class="timeline">
    <section v-for="[y, ps] in years" :key="y" class="year">
      <h2 :id="'y' + y">{{ y }}<small>{{ ps.length }} 篇</small></h2>
      <ol>
        <li v-for="p in ps" :key="p.url">
          <time>{{ p.date.slice(5) }}</time>
          <a :href="withBase(p.url)">{{ p.title }}</a>
          <span class="cat">{{ p.category }}</span>
        </li>
      </ol>
    </section>
  </div>
</template>
<style scoped>
.year { margin-bottom: 40px; }
.year h2 { display: flex; align-items: baseline; gap: 12px; font-size: 28px; font-weight: 800; margin: 0 0 12px; border: 0; padding: 0; }
.year small { font-size: 14px; font-weight: 500; color: var(--vp-c-text-3); }
ol { list-style: none; margin: 0; padding: 0 0 0 20px; border-left: 2px solid var(--vp-c-divider); }
li { position: relative; display: flex; align-items: baseline; gap: 16px; padding: 12px 0; }
li::before { content: ''; position: absolute; left: -27px; top: 19px; width: 12px; height: 12px; border-radius: 50%; background: var(--vp-c-bg); border: 2px solid var(--vp-c-brand-1); transition: background .2s; }
li:hover::before { background: var(--vp-c-brand-1); }
time { flex: none; font-family: var(--vp-font-family-mono); font-size: 14px; color: var(--vp-c-text-3); }
a { color: var(--vp-c-text-1); font-weight: 550; text-decoration: none; line-height: 1.6; }
a:hover { color: var(--vp-c-brand-1); }
.cat { margin-left: auto; flex: none; font-size: 12px; padding: 2px 8px; border-radius: 6px; background: var(--vp-c-bg-soft); color: var(--vp-c-text-2); }
@media (max-width: 640px) { li { flex-wrap: wrap; gap: 4px 12px; } .cat { margin-left: 0; } }
</style>
