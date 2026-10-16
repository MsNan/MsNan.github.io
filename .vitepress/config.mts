import { defineConfig } from 'vitepress'
import { genFeed } from './genFeed'
import fs from 'node:fs'
import path from 'node:path'

const SITE = 'https://msnan.github.io'

function readingTime(src: string) {
  const text = src.replace(/```[\s\S]*?```/g, '').replace(/[#>*`\-|]/g, '')
  const cn = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const en = (text.match(/[a-zA-Z]+/g) || []).length
  const code = (src.match(/```[\s\S]*?```/g) || []).join('').split('\n').length
  return Math.max(1, Math.round(cn / 400 + en / 200 + code / 60))
}

export default defineConfig({
  lang: 'zh-CN',
  title: '程序员项目库',
  titleTemplate: ':title | 涛哥的技术博客',
  description: '前端程序员涛哥的技术博客，分享可运行的实战项目源码与踩坑记录。',
  cleanUrls: true,
  srcExclude: ['README.md'],
  ignoreDeadLinks: [/\/feed\.xml/, /^https?:\/\/localhost/],
  lastUpdated: true,
  sitemap: { hostname: SITE },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#3eaf7c' }],
    ['meta', { name: 'author', content: '涛哥' }],
    ['meta', { name: 'keywords', content: '前端,uni-app,Vue3,Node.js,Python,实战项目,源码' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: '程序员项目库' }],
    ['link', { rel: 'alternate', type: 'application/rss+xml', title: 'RSS', href: '/feed.xml' }]
  ],
  transformPageData(pageData, { siteConfig }) {
    if (pageData.relativePath.startsWith('posts/') && pageData.relativePath !== 'posts/index.md') {
      const src = fs.readFileSync(path.join(siteConfig.srcDir, pageData.relativePath), 'utf-8')
      pageData.frontmatter.readingTime = readingTime(src)
      pageData.frontmatter.head ??= []
      pageData.frontmatter.head.push(
        ['meta', { property: 'og:title', content: pageData.title }],
        ['meta', { property: 'og:description', content: pageData.frontmatter.description || '' }],
        ['meta', { property: 'og:type', content: 'article' }]
      )
    }
  },
  buildEnd: genFeed,
  vite: {
    build: { sourcemap: false, minify: 'esbuild', cssMinify: true }
  },
  themeConfig: {
    logo: '/favicon.svg',
    siteTitle: '程序员项目库',
    nav: [
      { text: '首页', link: '/' },
      { text: '文章', link: '/posts/', activeMatch: '/posts/' },
      { text: '浏览', items: [
        { text: '分类', link: '/categories' },
        { text: '标签', link: '/tags' },
        { text: '归档', link: '/archive' }
      ] },
      { text: '项目', link: '/projects' },
      { text: '关于', link: '/about' },
      { text: '☕ 打赏', link: '/donate' }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/MsNan' },
      { icon: { svg: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M6.18 15.64a2.18 2.18 0 1 1 0 4.36 2.18 2.18 0 0 1 0-4.36zM4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27zm0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93z"/></svg>' }, link: '/rss', ariaLabel: 'RSS 订阅' }
    ],
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索', buttonAriaLabel: '搜索' },
          modal: { noResultsText: '没有找到结果', resetButtonTitle: '清除', footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' } }
        },
        miniSearch: {
          options: {
            tokenize: (text: string) => {
              const words = text.toLowerCase().match(/[a-z0-9_]+|[\u4e00-\u9fa5]/g) || []
              const out: string[] = [...words]
              for (let i = 0; i < words.length - 1; i++)
                if (/[\u4e00-\u9fa5]/.test(words[i]) && /[\u4e00-\u9fa5]/.test(words[i + 1])) out.push(words[i] + words[i + 1])
              return out
            }
          },
          searchOptions: { combineWith: 'AND', fuzzy: false, prefix: true }
        }
      }
    },
    outline: { level: [2, 3], label: '目录' },
    docFooter: { prev: false, next: false },
    darkModeSwitchLabel: '外观',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
    sidebarMenuLabel: '菜单',
    returnToTopLabel: '回到顶部',
    lastUpdated: { text: '最后更新' },
    footer: {
      message: '本站文章与源码仅供学习参考 · <a href="/rss">RSS 订阅</a>',
      copyright: '© 2018-present 涛哥 · 程序员项目库'
    }
  }
})
