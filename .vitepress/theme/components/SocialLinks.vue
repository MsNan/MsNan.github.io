<script setup lang="ts">
import { SOCIALS, ICONS } from '../../socials'
withDefaults(defineProps<{ variant?: 'cards' | 'pills' }>(), { variant: 'cards' })
</script>
<template>
  <div :class="['socials', variant]">
    <a v-for="s in SOCIALS" :key="s.key" class="soc" :href="s.link" target="_blank" rel="noopener" :style="{ '--sc': s.color }" :aria-label="`${s.name}：${s.handle}`">
      <span class="ic" aria-hidden="true" v-html="ICONS[s.key]" />
      <span class="txt"><b>{{ s.name }}</b><small>{{ s.handle }}<template v-if="s.hint && variant === 'cards'"> · {{ s.hint }}</template></small></span>
    </a>
  </div>
</template>
<style scoped>
.socials { display: grid; gap: 12px; }
.cards { grid-template-columns: repeat(2, 1fr); margin: 16px 0; }
@media (max-width: 480px) { .cards { grid-template-columns: 1fr; } }
.pills { display: flex; flex-wrap: wrap; gap: 10px; }
.soc { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: 14px; background: var(--surface); border: 1px solid var(--vp-c-divider); text-decoration: none !important; color: var(--vp-c-text-1) !important; transition: transform .2s, border-color .2s, box-shadow .2s; }
.soc:hover { transform: translateY(-2px); border-color: var(--sc); box-shadow: var(--shadow); }
.pills .soc { padding: 8px 14px 8px 10px; border-radius: 999px; }
.ic { width: 38px; height: 38px; flex: none; display: grid; place-items: center; border-radius: 10px; color: var(--sc); background: color-mix(in srgb, var(--sc) 12%, transparent); }
.dark .ic { color: color-mix(in srgb, var(--sc) 60%, #fff); }
.pills .ic { width: 28px; height: 28px; border-radius: 50%; }
.ic :deep(svg) { width: 20px; height: 20px; }
.pills .ic :deep(svg) { width: 16px; height: 16px; }
.txt { display: flex; flex-direction: column; line-height: 1.35; }
.txt b { font-size: 14.5px; }
.txt small { font-size: 12.5px; color: var(--vp-c-text-2); }
.pills .txt small { display: none; }
</style>
