<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { data as posts } from '../posts.data'
import PostCard from './PostCard.vue'
const props = withDefaults(defineProps<{ pageSize?: number; limit?: number }>(), { pageSize: 9, limit: 0 })
const page = ref(1)
const list = computed(() => (props.limit ? posts.slice(0, props.limit) : posts))
const total = computed(() => Math.max(1, Math.ceil(list.value.length / props.pageSize)))
const shown = computed(() => props.limit ? list.value : list.value.slice((page.value - 1) * props.pageSize, page.value * props.pageSize))
onMounted(() => { const p = Number(new URLSearchParams(location.search).get('page')); if (p >= 1 && p <= total.value) page.value = p })
function go(p: number) { page.value = p; history.replaceState(null, '', p > 1 ? `?page=${p}` : location.pathname); window.scrollTo({ top: 0, behavior: 'smooth' }) }
</script>
<template>
  <div>
    <div class="card-grid"><PostCard v-for="p in shown" :key="p.url" :post="p" /></div>
    <nav v-if="!limit && total > 1" class="pager" aria-label="分页">
      <button :disabled="page === 1" @click="go(page - 1)">← 上一页</button>
      <button v-for="n in total" :key="n" :class="{ on: n === page }" :aria-current="n === page ? 'page' : undefined" @click="go(n)">{{ n }}</button>
      <button :disabled="page === total" @click="go(page + 1)">下一页 →</button>
    </nav>
  </div>
</template>
<style scoped>
.pager { display: flex; justify-content: center; flex-wrap: wrap; gap: 8px; margin: 40px 0 8px; }
.pager button { min-width: 40px; height: 40px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--vp-c-divider); background: var(--surface); color: var(--vp-c-text-1); font-size: 14px; transition: all .2s; }
.pager button:hover:not(:disabled) { border-color: var(--vp-c-brand-1); color: var(--vp-c-brand-1); }
.pager button.on { background: var(--vp-c-brand-1); border-color: var(--vp-c-brand-1); color: #fff; }
.pager button:disabled { opacity: .4; cursor: not-allowed; }
</style>
