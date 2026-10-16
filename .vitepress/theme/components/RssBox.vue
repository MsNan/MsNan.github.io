<script setup lang="ts">
import { ref } from 'vue'
const url = 'https://msnan.github.io/feed.xml'
const copied = ref(false)
async function copy() {
  try { await navigator.clipboard.writeText(url) } catch { const i = document.getElementById('rss-url') as HTMLInputElement; i.select(); document.execCommand('copy') }
  copied.value = true; setTimeout(() => (copied.value = false), 1800)
}
</script>
<template>
  <div class="rss-box">
    <input id="rss-url" :value="url" readonly aria-label="RSS 订阅地址" />
    <button type="button" @click="copy">{{ copied ? '已复制 ✓' : '复制链接' }}</button>
  </div>
  <div class="rss-how">
    <div><b>什么是 RSS？</b>一种订阅网站更新的标准格式，阅读器会定期检查并汇总新文章。</div>
    <div><b>用什么阅读器？</b>Feedly、Inoreader、NetNewsWire、Folo 等都可以，粘贴上面的链接即可。</div>
    <div><b>不想装软件？</b>也可以在 <a href="https://github.com/MsNan" target="_blank" rel="noopener">GitHub</a> 关注我，或收藏博客首页。</div>
  </div>
</template>
<style scoped>
.rss-box { display: flex; gap: 10px; flex-wrap: wrap; padding: 22px; border-radius: 20px; border: 1px solid var(--vp-c-divider); background: linear-gradient(135deg, var(--brand-soft), color-mix(in srgb, var(--accent) 12%, transparent)); }
input { flex: 1; min-width: 0; height: 46px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--vp-c-divider); background: var(--surface); color: var(--vp-c-text-1); font: 14px var(--vp-font-family-mono); }
button { height: 46px; padding: 0 22px; border-radius: 12px; background: var(--vp-c-brand-1); color: #fff; font-weight: 650; transition: transform .2s; }
.dark button { color: #04241a; }
button:hover { transform: translateY(-2px); }
.rss-how { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; margin: 20px 0 8px; }
.rss-how div { padding: 16px 18px; border-radius: 14px; background: var(--surface); border: 1px solid var(--vp-c-divider); font-size: 14px; color: var(--vp-c-text-2); line-height: 1.65; }
.rss-how b { display: block; color: var(--vp-c-text-1); margin-bottom: 4px; }
@media (max-width: 640px) { button { flex: 1; } }
</style>
