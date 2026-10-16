<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ category: string; title: string; src?: string }>()
const THEMES: Record<string, [string, string, string]> = {
  '前端': ['#6366f1', '#22d3ee', '◆'],
  '后端': ['#0f766e', '#34d399', '▲'],
  'Python': ['#2563eb', '#facc15', '●'],
}
const t = computed(() => THEMES[props.category] || ['#7c3aed', '#f472b6', '■'])
</script>
<template>
  <div class="cover" :style="{ '--c1': t[0], '--c2': t[1] }">
    <img v-if="src" :src="src" alt="" loading="lazy" />
    <template v-else>
      <span class="pattern" aria-hidden="true" />
      <span class="badge">{{ category }}</span>
      <span class="glyph" aria-hidden="true">{{ t[2] }}</span>
    </template>
  </div>
</template>
<style scoped>
.cover { position: relative; aspect-ratio: 16/9; overflow: hidden; background: linear-gradient(135deg, var(--c1), var(--c2)); }
.cover img { width: 100%; height: 100%; object-fit: cover; }
.pattern { position: absolute; inset: 0; background-image: radial-gradient(rgba(255,255,255,.22) 1px, transparent 1px); background-size: 14px 14px; mask-image: linear-gradient(120deg, #000 10%, transparent 75%); }
.badge { position: absolute; left: 14px; bottom: 12px; color: #fff; font-weight: 600; font-size: 13px; letter-spacing: .04em; padding: 3px 10px; border-radius: 999px; background: rgba(0,0,0,.22); backdrop-filter: blur(4px); }
.glyph { position: absolute; right: -6px; top: -18px; font-size: 120px; line-height: 1; color: rgba(255,255,255,.18); transition: transform .5s ease; }
:global(.post-card:hover) .glyph { transform: rotate(-12deg) scale(1.08); }
</style>
