<script setup lang="ts">
import { withBase } from 'vitepress'
import { data as projects } from '../projects.data'
withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
</script>
<template>
  <div class="proj-grid" :class="{ compact }">
    <article v-for="p in projects" :key="p.repo" class="proj-card">
      <div class="head">
        <span class="icon" aria-hidden="true">{{ p.icon }}</span>
        <div class="names"><h3>{{ p.name }}</h3><span class="repo">{{ p.repo }}</span></div>
      </div>
      <p class="desc">{{ p.desc }}</p>
      <div class="tags"><span v-for="t in p.tags" :key="t" class="tag-chip static">{{ t }}</span></div>
      <div class="foot">
        <span class="stat" :title="`${p.stars} stars`"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"/></svg>{{ p.stars }}</span>
        <span v-if="p.lang" class="stat"><i class="dot" aria-hidden="true" />{{ p.lang }}</span>
        <span class="spacer" />
        <a v-if="p.post" class="link" :href="withBase(p.post)">文章</a>
        <a class="link gh" :href="`https://github.com/${p.repo}`" target="_blank" rel="noopener">GitHub ↗</a>
      </div>
    </article>
  </div>
</template>
<style scoped>
.proj-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
.proj-card { display: flex; flex-direction: column; gap: 14px; padding: 22px; border-radius: var(--radius-lg); background: var(--surface); border: 1px solid var(--vp-c-divider); transition: transform .25s, box-shadow .25s, border-color .25s; }
.proj-card:hover { transform: translateY(-4px); box-shadow: var(--shadow-lg); border-color: color-mix(in srgb, var(--vp-c-brand-1) 35%, var(--vp-c-divider)); }
.head { display: flex; align-items: center; gap: 14px; }
.icon { width: 48px; height: 48px; flex: none; display: grid; place-items: center; font-size: 24px; border-radius: 14px; background: var(--brand-soft); }
.names h3 { margin: 0; font-size: 17px; font-weight: 650; border: 0; padding: 0; }
.repo { font-size: 12.5px; color: var(--vp-c-text-3); font-family: var(--vp-font-family-mono); }
.desc { margin: 0; font-size: 14.5px; line-height: 1.75; color: var(--vp-c-text-2); flex: 1; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; }
.foot { display: flex; align-items: center; gap: 14px; padding-top: 14px; border-top: 1px dashed var(--vp-c-divider); font-size: 13px; color: var(--vp-c-text-2); }
.stat { display: inline-flex; align-items: center; gap: 5px; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--vp-c-brand-2); display: inline-block; }
.spacer { flex: 1; }
.link { font-weight: 600; color: var(--vp-c-brand-1); text-decoration: none; }
.link:hover { text-decoration: underline; }
</style>
