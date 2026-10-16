import path from 'node:path'
import { writeFileSync } from 'node:fs'
import { Feed } from 'feed'
import { createContentLoader, type SiteConfig } from 'vitepress'

const SITE = 'https://msnan.github.io'

export async function genFeed(config: SiteConfig) {
  const feed = new Feed({
    title: '程序员项目库 · 涛哥的技术博客',
    description: '分享可运行的实战项目源码与踩坑记录',
    id: SITE, link: SITE, language: 'zh-CN',
    favicon: `${SITE}/favicon.svg`,
    copyright: '© 2018-present 涛哥'
  })
  const posts = await createContentLoader('posts/*.md', { excerpt: true, render: true }).load()
  posts
    .filter((p) => p.frontmatter.date)
    .sort((a, b) => +new Date(b.frontmatter.date) - +new Date(a.frontmatter.date))
    .forEach(({ url, frontmatter, html }) => {
      feed.addItem({
        title: frontmatter.title,
        id: `${SITE}${url}`, link: `${SITE}${url}`,
        description: frontmatter.description,
        content: html?.replaceAll('&ZeroWidthSpace;', ''),
        author: [{ name: '涛哥', link: 'https://github.com/MsNan' }],
        date: new Date(frontmatter.date)
      })
    })
  writeFileSync(path.join(config.outDir, 'feed.xml'), feed.rss2())
}
