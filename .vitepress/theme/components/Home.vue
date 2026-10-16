<script setup lang="ts">
import { withBase } from 'vitepress'
import PostList from './PostList.vue'
import ProjectCards from './ProjectCards.vue'
import SocialLinks from './SocialLinks.vue'
import { data as posts } from '../posts.data'
</script>
<template>
  <div class="home">
    <section class="hero">
      <div class="hero-bg" aria-hidden="true"><span class="blob b1" /><span class="blob b2" /><span class="grid" /></div>
      <div class="hero-inner">
        <div class="text">
          <p class="hello"><span class="wave" aria-hidden="true">👋</span> 你好，我是涛哥</p>
          <h1>把<span class="hl">能跑起来</span>的实战项目<br />和踩过的坑，都写下来</h1>
          <p class="tagline">前端程序员，2018 年入行。「程序员项目库」分享可运行的实战项目源码：商城、管理系统、数据可视化、自动化工具。</p>
          <div class="cta">
            <a class="btn primary" :href="withBase('/posts/')">阅读文章 →</a>
            <a class="btn ghost" :href="withBase('/projects')">开源项目</a>
          </div>
          <ul class="stats">
            <li><b>{{ posts.length }}</b><span>篇文章</span></li>
            <li><b>3</b><span>个开源项目</span></li>
            <li><b>2018</b><span>年入行</span></li>
          </ul>
        </div>
        <div class="avatar-wrap" aria-hidden="true">
          <div class="avatar"><img :src="withBase('/favicon.svg')" alt="" /></div>
          <span class="float f1">Vue 3</span><span class="float f2">uni-app</span><span class="float f3">Node.js</span><span class="float f4">Python</span>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="sec-head"><h2>最新文章</h2><a :href="withBase('/posts/')">全部文章 →</a></div>
      <PostList :limit="6" />
    </section>

    <section class="section">
      <div class="sec-head"><h2>开源项目</h2><a :href="withBase('/projects')">全部项目 →</a></div>
      <ProjectCards />
    </section>

    <section class="section">
      <div class="subscribe">
        <div class="sub-text"><h2>订阅更新</h2><p>用 RSS 订阅，或在下面任一平台关注我；公众号请在微信搜索「程序员项目库」。</p><SocialLinks variant="pills" class="sub-soc" /></div>
        <div class="cta"><a class="btn primary" :href="withBase('/rss')">RSS 订阅</a><a class="btn ghost" :href="withBase('/about#找到我')">更多联系方式</a></div>
      </div>
    </section>
  </div>
</template>
<style scoped>
.home { padding-bottom: 64px; }
.hero { position: relative; overflow: hidden; padding: 72px 24px 64px; border-bottom: 1px solid var(--vp-c-divider); }
.hero-bg { position: absolute; inset: 0; pointer-events: none; }
.blob { position: absolute; border-radius: 50%; filter: blur(70px); opacity: .45; }
.b1 { width: 460px; height: 460px; background: var(--vp-c-brand-2); top: -160px; right: 8%; }
.b2 { width: 380px; height: 380px; background: var(--accent); bottom: -200px; left: -60px; opacity: .3; }
.grid { position: absolute; inset: 0; background-image: linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px); background-size: 44px 44px; mask-image: radial-gradient(ellipse at 60% 30%, #000 20%, transparent 70%); }
.hero-inner { position: relative; max-width: 1152px; margin: 0 auto; display: grid; grid-template-columns: 1.35fr 1fr; gap: 48px; align-items: center; }
.hello { margin: 0 0 14px; font-size: 15px; font-weight: 600; color: var(--vp-c-brand-1); }
.wave { display: inline-block; animation: wave 2.4s ease-in-out infinite; transform-origin: 70% 70%; }
@keyframes wave { 0%,60%,100% { transform: rotate(0) } 10%,30% { transform: rotate(14deg) } 20% { transform: rotate(-8deg) } }
h1 { margin: 0; font-size: clamp(30px, 5vw, 52px); line-height: 1.22; font-weight: 800; letter-spacing: -.02em; color: var(--vp-c-text-1); }
.hl { background: linear-gradient(120deg, var(--vp-c-brand-1), var(--accent)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.tagline { margin: 20px 0 0; font-size: 17px; line-height: 1.85; color: var(--vp-c-text-2); max-width: 560px; }
.cta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
.btn { display: inline-flex; align-items: center; height: 46px; padding: 0 24px; border-radius: 12px; font-weight: 600; font-size: 15px; text-decoration: none; transition: transform .2s, box-shadow .2s, background .2s; }
.btn.primary { background: var(--vp-c-brand-1); color: #fff; box-shadow: 0 6px 20px -6px color-mix(in srgb, var(--vp-c-brand-1) 70%, transparent); }
.btn.primary:hover { transform: translateY(-2px); background: var(--vp-c-brand-2); }
.btn.ghost { border: 1px solid var(--vp-c-divider); color: var(--vp-c-text-1); background: var(--surface); }
.btn.ghost:hover { border-color: var(--vp-c-brand-1); color: var(--vp-c-brand-1); transform: translateY(-2px); }
.stats { display: flex; gap: 36px; list-style: none; padding: 0; margin: 36px 0 0; }
.stats li { display: flex; flex-direction: column; }
.stats b { font-size: 26px; font-weight: 750; color: var(--vp-c-text-1); font-variant-numeric: tabular-nums; }
.stats span { font-size: 13px; color: var(--vp-c-text-2); }
.avatar-wrap { position: relative; justify-self: center; width: 300px; height: 300px; }
.avatar { position: absolute; inset: 30px; border-radius: 36%; padding: 10px; background: linear-gradient(135deg, var(--vp-c-brand-2), var(--accent)); box-shadow: var(--shadow-lg); animation: floaty 6s ease-in-out infinite; }
.avatar img { width: 100%; height: 100%; border-radius: 32%; }
.float { position: absolute; padding: 6px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; background: var(--surface); border: 1px solid var(--vp-c-divider); box-shadow: var(--shadow); color: var(--vp-c-text-1); animation: floaty 5s ease-in-out infinite; }
.f1 { top: 6px; left: -10px; } .f2 { top: 40px; right: -24px; animation-delay: -1.5s; } .f3 { bottom: 30px; left: -30px; animation-delay: -3s; } .f4 { bottom: 0; right: 10px; animation-delay: -2s; }
@keyframes floaty { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-8px) } }
.section { max-width: 1152px; margin: 0 auto; padding: 56px 24px 0; }
.sec-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 22px; }
.sec-head h2 { margin: 0; font-size: 24px; font-weight: 750; }
.sec-head a { font-size: 14px; font-weight: 600; color: var(--vp-c-brand-1); text-decoration: none; }
.subscribe { display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap; padding: 32px; border-radius: var(--radius-lg); background: linear-gradient(135deg, var(--brand-soft), color-mix(in srgb, var(--accent) 12%, transparent)); border: 1px solid var(--vp-c-divider); }
.subscribe h2 { margin: 0 0 6px; font-size: 22px; }
.subscribe p { margin: 0; color: var(--vp-c-text-2); }
.subscribe .cta { margin-top: 0; }
.sub-text { flex: 1; min-width: 260px; }
.sub-soc { margin-top: 16px; }
@media (max-width: 960px) { .hero-inner { grid-template-columns: 1fr; } .avatar-wrap { width: 240px; height: 240px; order: -1; } }
@media (max-width: 640px) {
  .hero { padding: 40px 20px 44px; } .section { padding: 44px 20px 0; }
  .avatar-wrap { display: none; } .tagline { font-size: 15.5px; } .stats { gap: 24px; } .stats b { font-size: 22px; }
  .btn { flex: 1; justify-content: center; } .subscribe { padding: 24px; }
}
@media (prefers-reduced-motion: reduce) { .wave, .avatar, .float { animation: none; } }
</style>
