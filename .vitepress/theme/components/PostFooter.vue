<script setup lang="ts">
import { useData, withBase } from 'vitepress'
import { computed } from 'vue'
import Giscus from '@giscus/vue'
import { data as posts } from '../posts.data'

const { page, frontmatter, isDark } = useData()
const isPost = computed(() => page.value.relativePath.startsWith('posts/') && frontmatter.value.date)
const idx = computed(() => posts.findIndex((p) => withBase(p.url).replace(/\.html$/, '') === withBase('/' + page.value.relativePath.replace(/\.md$/, ''))))
const newer = computed(() => (idx.value > 0 ? posts[idx.value - 1] : null))
const older = computed(() => (idx.value >= 0 && idx.value < posts.length - 1 ? posts[idx.value + 1] : null))
</script>

<template>
  <div v-if="isPost" class="post-footer">
    <div class="donate-tip">觉得有帮助？<a :href="withBase('/donate')">☕ 请作者喝杯咖啡</a></div>
    <nav class="prev-next">
      <a v-if="older" class="pn" :href="withBase(older.url)"><span class="lbl">← 上一篇</span><span class="t">{{ older.title }}</span></a>
      <span v-else />
      <a v-if="newer" class="pn next" :href="withBase(newer.url)"><span class="lbl">下一篇 →</span><span class="t">{{ newer.title }}</span></a>
    </nav>
    <div class="comments">
      <!-- giscus：需在 https://github.com/apps/giscus 为 MsNan/MsNan.github.io 安装 giscus App 后评论区才会生效 -->
      <Giscus
        :key="page.relativePath"
        repo="MsNan/MsNan.github.io"
        repo-id="MDEwOlJlcG9zaXRvcnkxMTMzODk1ODg="
        category="General"
        category-id="DIC_kwDOBsIwFM4DImB1"
        mapping="pathname"
        strict="0"
        reactions-enabled="1"
        emit-metadata="0"
        input-position="top"
        :theme="isDark ? 'dark' : 'light'"
        lang="zh-CN"
        loading="lazy"
      />
    </div>
  </div>
</template>

<style scoped>
.post-footer { margin-top: 48px; }
.donate-tip { text-align: center; padding: 16px; border-radius: 8px; background: var(--vp-c-bg-soft); margin-bottom: 24px; }
.prev-next { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 40px; }
.pn { display: flex; flex-direction: column; padding: 12px 16px; border: 1px solid var(--vp-c-divider); border-radius: 8px; text-decoration: none !important; }
.pn:hover { border-color: var(--vp-c-brand-1); }
.pn.next { text-align: right; }
.lbl { font-size: 12px; color: var(--vp-c-text-2); }
.t { font-weight: 500; color: var(--vp-c-brand-1); }
@media (max-width: 640px) { .prev-next { grid-template-columns: 1fr; } .pn.next { text-align: left; } }
</style>
