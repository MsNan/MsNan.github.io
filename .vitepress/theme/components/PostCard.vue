<script setup lang="ts">
import { withBase } from 'vitepress'
import Cover from './Cover.vue'
import type { Post } from '../posts.data'
defineProps<{ post: Post }>()
</script>
<template>
  <article class="post-card">
    <a class="cover-link" :href="withBase(post.url)" tabindex="-1" aria-hidden="true"><Cover :category="post.category" :title="post.title" :src="post.cover" /></a>
    <div class="body">
      <div class="meta">
        <a class="cat" :href="withBase('/categories#' + encodeURIComponent(post.category))">{{ post.category }}</a>
        <span>{{ post.date }}</span><span aria-hidden="true">·</span><span>{{ post.readingTime }} 分钟阅读</span>
      </div>
      <h3 class="title"><a :href="withBase(post.url)">{{ post.title }}</a></h3>
      <p class="desc">{{ post.description }}</p>
      <div class="tags"><a v-for="t in post.tags" :key="t" class="tag-chip" :href="withBase('/tags#' + encodeURIComponent(t))">#{{ t }}</a></div>
    </div>
  </article>
</template>
<style scoped>
.post-card { display: flex; flex-direction: column; border-radius: var(--radius-lg); overflow: hidden; background: var(--surface); border: 1px solid var(--vp-c-divider); transition: transform .25s ease, box-shadow .25s ease, border-color .25s; }
.post-card:hover { transform: translateY(-4px); box-shadow: var(--shadow-lg); border-color: color-mix(in srgb, var(--vp-c-brand-1) 35%, var(--vp-c-divider)); }
.cover-link { display: block; }
.body { padding: 18px 20px 20px; display: flex; flex-direction: column; gap: 10px; flex: 1; }
.meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; font-size: 13px; color: var(--vp-c-text-2); }
.cat { color: var(--vp-c-brand-1); font-weight: 600; text-decoration: none; }
.title { margin: 0; font-size: 18px; line-height: 1.5; font-weight: 650; }
.title a { color: var(--vp-c-text-1); text-decoration: none; background: linear-gradient(var(--vp-c-brand-1), var(--vp-c-brand-1)) 0 100% / 0 2px no-repeat; transition: background-size .3s; }
.post-card:hover .title a { background-size: 100% 2px; }
.desc { margin: 0; font-size: 14.5px; line-height: 1.75; color: var(--vp-c-text-2); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; padding-top: 4px; }
</style>
