# 程序员项目库 · 涛哥的技术博客

网址：https://msnan.github.io

用 [VitePress](https://vitepress.dev) 搭建，推送到 `main` 后由 GitHub Actions 自动构建并部署到 GitHub Pages。旧版静态页面备份在 `legacy-backup` 分支（`master` 分支也原样保留）。

## 写一篇新文章

1. 在 `posts/` 目录新建一个 Markdown 文件，文件名就是网址，用英文和短横线，例如 `posts/vue3-pinia-tips.md` → `https://msnan.github.io/posts/vue3-pinia-tips`
2. 文件开头写上 frontmatter：

   ```md
   ---
   title: "文章标题"
   date: 2026-10-20
   category: 前端
   tags: [Vue3, Pinia]
   description: "一两句话的摘要，会显示在文章列表、搜索和 RSS 里。"
   ---

   正文从这里开始，不用再写一级标题（# 标题），标题会自动显示。用 ## 写小节。
   ```

3. 图片放到 `public/images/`，正文里写 `![说明](/images/xxx.png)`
4. 提交并推送：

   ```bash
   git add posts public/images
   git commit -m "post: 文章标题"
   git push
   ```

推送后 1～2 分钟网站自动更新。文章列表、分类、标签、归档、RSS、sitemap、搜索索引都会自动生成，不用手动改。

## 本地预览

```bash
npm install
npm run dev      # 本地开发预览，http://localhost:5173
npm run build    # 构建，和线上一致
```

## 目录

| 路径 | 内容 |
|---|---|
| `posts/` | 文章 |
| `index.md` / `about.md` / `projects.md` / `donate.md` | 首页、关于、项目、打赏 |
| `categories.md` / `tags.md` / `archive.md` | 分类、标签、归档（自动生成） |
| `public/` | 图片、打赏二维码、favicon |
| `.vitepress/config.mts` | 站点配置（导航、搜索、SEO） |
| `.vitepress/theme/` | 主题定制（文章信息、上下篇、评论、分页） |

## 评论（giscus）

评论区用 giscus，基于本仓库的 Discussions（已开启）。需要在 https://github.com/apps/giscus 为 `MsNan/MsNan.github.io` 安装 giscus App 后评论才会生效。配置在 `.vitepress/theme/components/PostFooter.vue`。
