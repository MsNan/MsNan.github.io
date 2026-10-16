<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { data as posts } from '../posts.data'
import PostCard from './PostCard.vue'
const props = withDefaults(defineProps<{ pageSize?: number; limit?: number }>(), { pageSize: 10, limit: 0 })
const page = ref(1)
const list = computed(() => (props.limit ? posts.slice(0, props.limit) : posts))
const total = computed(() => Math.max(1, Math.ceil(list.value.length / props.pageSize)))
const shown = computed(() => props.limit ? list.value : list.value.slice((page.value - 1) * props.pageSize, page.value * props.pageSize))
onMounted(() => { const p = Number(new URLSearchParams(location.search).get('page')); if (p >= 1 && p <= total.value) page.value = p })
function go(p: number) { page.value = p; history.replaceState(null, '', p > 1 ? `?page=${p}` : location.pathname); window.scrollTo({ top: 0 }) }
</script>
<template>
  <div class="post-list">
    <PostCard v-for="p in shown" :key="p.url" :post="p" />
    <div v-if="!limit && total > 1" class="pager">
      <button :disabled="page === 1" @click="go(page - 1)">上一页</button>
      <span>{{ page }} / {{ total }}</span>
      <button :disabled="page === total" @click="go(page + 1)">下一页</button>
    </div>
    <p v-if="!limit" class="count">共 {{ posts.length }} 篇文章</p>
  </div>
</template>
<style scoped>
.pager { display: flex; justify-content: center; align-items: center; gap: 16px; margin: 24px 0; }
.pager button { padding: 6px 14px; border: 1px solid var(--vp-c-divider); border-radius: 6px; }
.pager button:disabled { opacity: .4; cursor: not-allowed; }
.count { text-align: center; color: var(--vp-c-text-3); font-size: 13px; }
</style>
