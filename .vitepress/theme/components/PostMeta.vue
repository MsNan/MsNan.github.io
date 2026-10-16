<script setup lang="ts">
import { useData, withBase } from 'vitepress'
import { computed } from 'vue'
import Cover from './Cover.vue'
const { frontmatter, page } = useData()
const isPost = computed(() => page.value.relativePath.startsWith('posts/') && frontmatter.value.date)
const date = computed(() => frontmatter.value.date ? new Date(frontmatter.value.date).toISOString().slice(0, 10) : '')
</script>
<template>
  <header v-if="isPost" class="post-head">
    <a class="cat" :href="withBase('/categories#' + encodeURIComponent(frontmatter.category))">{{ frontmatter.category }}</a>
    <h1 class="post-title">{{ frontmatter.title }}</h1>
    <p v-if="frontmatter.description" class="lead">{{ frontmatter.description }}</p>
    <div class="meta">
      <span class="author"><img :src="withBase('/favicon.svg')" alt="" />涛哥</span>
      <span>{{ date }}</span><span aria-hidden="true">·</span><span>{{ frontmatter.readingTime }} 分钟阅读</span>
    </div>
    <div class="tags"><a v-for="t in frontmatter.tags || []" :key="t" class="tag-chip" :href="withBase('/tags#' + encodeURIComponent(t))">#{{ t }}</a></div>
    <div v-if="frontmatter.cover" class="cover-wrap"><Cover :category="frontmatter.category" :title="frontmatter.title" :src="frontmatter.cover" /></div>
  </header>
</template>
<style scoped>
.post-head { margin-bottom: 36px; padding-bottom: 28px; border-bottom: 1px solid var(--vp-c-divider); }
.cat { display: inline-block; font-size: 13px; font-weight: 700; letter-spacing: .06em; color: var(--vp-c-brand-1); text-decoration: none; padding: 4px 12px; border-radius: 999px; background: var(--brand-soft); }
.post-title { margin: 16px 0 0; font-size: clamp(26px, 3.6vw, 36px); line-height: 1.35; font-weight: 800; letter-spacing: -.01em; }
.lead { margin: 14px 0 0; font-size: 17px; line-height: 1.8; color: var(--vp-c-text-2); }
.meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 18px; font-size: 14px; color: var(--vp-c-text-2); }
.author { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; color: var(--vp-c-text-1); margin-right: 6px; }
.author img { width: 26px; height: 26px; border-radius: 8px; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
.cover-wrap { margin-top: 24px; border-radius: var(--radius-lg); overflow: hidden; }
</style>
