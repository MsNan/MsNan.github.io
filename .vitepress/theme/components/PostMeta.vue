<script setup lang="ts">
import { useData, withBase } from 'vitepress'
import { computed } from 'vue'
const { frontmatter, page } = useData()
const isPost = computed(() => page.value.relativePath.startsWith('posts/') && frontmatter.value.date)
const date = computed(() => frontmatter.value.date ? new Date(frontmatter.value.date).toISOString().slice(0, 10) : '')
</script>

<template>
  <div v-if="isPost" class="post-meta">
    <h1 class="post-title">{{ frontmatter.title }}</h1>
    <div class="meta-line">
      <span>📅 {{ date }}</span>
      <span>⏱ 约 {{ frontmatter.readingTime }} 分钟</span>
      <a v-if="frontmatter.category" :href="withBase('/categories#' + encodeURIComponent(frontmatter.category))">📁 {{ frontmatter.category }}</a>
      <span class="tags">
        <a v-for="t in frontmatter.tags || []" :key="t" class="tag" :href="withBase('/tags#' + encodeURIComponent(t))"># {{ t }}</a>
      </span>
    </div>
  </div>
</template>

<style scoped>
.post-meta { margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--vp-c-divider); }
.post-title { font-size: 30px; line-height: 1.35; font-weight: 700; margin: 0 0 12px; }
.meta-line { display: flex; flex-wrap: wrap; gap: 8px 16px; font-size: 14px; color: var(--vp-c-text-2); }
.meta-line a { color: var(--vp-c-text-2); text-decoration: none; }
.meta-line a:hover { color: var(--vp-c-brand-1); }
.tags { display: inline-flex; flex-wrap: wrap; gap: 6px; }
@media (max-width: 640px) { .post-title { font-size: 24px; } }
</style>
