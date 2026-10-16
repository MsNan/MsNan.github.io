<script setup lang="ts">
import { computed } from 'vue'
import { data as posts } from '../posts.data'
import PostCard from './PostCard.vue'
const groups = computed(() => {
  const m: Record<string, typeof posts> = {}
  posts.forEach((p) => p.tags.forEach((t) => (m[t] ||= []).push(p)))
  return Object.entries(m).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
})
</script>
<template>
  <div class="chips" aria-label="筛选"><a v-for="[t, ps] in groups" :key="t" class="chip" :href="'#' + encodeURIComponent(t)"># {{ t }} <sup>{{ ps.length }}</sup></a></div>
  <section class="group" v-for="[t, ps] in groups" :key="t">
    <h2 :id="t"># {{ t }}</h2>
    <div class="card-grid"><PostCard v-for="p in ps" :key="p.url" :post="p" /></div>
  </section>
</template>
<style scoped>
.group { margin-top: 44px; }
.group h2 { font-size: 22px; font-weight: 750; margin: 0 0 18px; border: 0; padding: 0; scroll-margin-top: 90px; }
</style>
