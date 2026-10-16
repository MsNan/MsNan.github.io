---
layout: home
title: 首页
hero:
  name: 程序员项目库
  text: 前端程序员涛哥的技术博客
  tagline: 2018 年入行，专注前端与全栈实战，分享可运行的实战项目源码和踩坑记录
  image:
    src: /favicon.svg
    alt: 程序员项目库
  actions:
    - theme: brand
      text: 阅读文章
      link: /posts/
    - theme: alt
      text: 开源项目
      link: /projects
    - theme: alt
      text: GitHub
      link: https://github.com/MsNan
features:
  - icon: 🧩
    title: 可运行的实战源码
    details: 商城、管理系统、数据可视化、自动化工具，每个项目都能直接跑起来。
  - icon: 🛠️
    title: 讲清楚实现与踩坑
    details: 文章围绕真实代码展开，重点写设计取舍和踩过的坑。
  - icon: 📦
    title: 全部开源
    details: 项目源码都放在 GitHub，欢迎 Star、Issue 和交流。
---

<div class="vp-doc" style="max-width:1152px;margin:48px auto 0;padding:0 24px">

## 最新文章

<PostList :limit="5" />

<p style="text-align:center;margin-top:16px"><a href="/posts/">查看全部文章 →</a></p>

</div>
