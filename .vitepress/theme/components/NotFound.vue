<script setup lang="ts">
import { withBase } from 'vitepress'
</script>
<template>
  <div class="nf">
    <p class="code">404</p>
    <h1>页面走丢了</h1>
    <p>你访问的页面不存在，可能已被移动或删除。</p>
    <div class="links">
      <a :href="withBase('/')">回到首页</a>
      <a :href="withBase('/posts/')">看看文章</a>
      <a :href="withBase('/archive')">文章归档</a>
    </div>
  </div>
</template>
<style scoped>
.nf { text-align: center; padding: 96px 24px; }
.code { font-size: 72px; font-weight: 700; color: var(--vp-c-brand-1); margin: 0; }
h1 { font-size: 24px; margin: 8px 0 12px; }
.links { display: flex; gap: 16px; justify-content: center; margin-top: 24px; flex-wrap: wrap; }
.links a { padding: 8px 18px; border: 1px solid var(--vp-c-brand-1); border-radius: 20px; text-decoration: none; }
</style>
