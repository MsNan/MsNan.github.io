<script setup lang="ts">
import { withBase } from 'vitepress'
defineProps<{ post: { title: string; url: string; date: string; category: string; tags: string[]; description: string } }>()
</script>
<template>
  <article class="card">
    <a class="title" :href="withBase(post.url)">{{ post.title }}</a>
    <p class="desc">{{ post.description }}</p>
    <div class="meta">
      <span>📅 {{ post.date }}</span>
      <a :href="withBase('/categories#' + encodeURIComponent(post.category))">📁 {{ post.category }}</a>
      <a v-for="t in post.tags" :key="t" :href="withBase('/tags#' + encodeURIComponent(t))"># {{ t }}</a>
    </div>
  </article>
</template>
<style scoped>
.card { padding: 20px 0; border-bottom: 1px solid var(--vp-c-divider); }
.title { font-size: 20px; font-weight: 600; color: var(--vp-c-text-1); text-decoration: none; line-height: 1.4; }
.title:hover { color: var(--vp-c-brand-1); }
.desc { margin: 8px 0; color: var(--vp-c-text-2); font-size: 15px; line-height: 1.6; }
.meta { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 13px; color: var(--vp-c-text-3); }
.meta a { color: var(--vp-c-text-3); text-decoration: none; }
.meta a:hover { color: var(--vp-c-brand-1); }
</style>
