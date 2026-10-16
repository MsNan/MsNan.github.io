import { createContentLoader } from 'vitepress'

export interface Post {
  title: string; url: string; date: string; category: string
  tags: string[]; description: string; readingTime: number; cover?: string
}
declare const data: Post[]
export { data }

function readingTime(src: string) {
  const text = src.replace(/```[\s\S]*?```/g, '')
  const cn = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const en = (text.match(/[a-zA-Z]+/g) || []).length
  const code = (src.match(/```[\s\S]*?```/g) || []).join('').split('\n').length
  return Math.max(1, Math.round(cn / 400 + en / 200 + code / 60))
}

export default createContentLoader('posts/*.md', {
  includeSrc: true,
  transform(raw): Post[] {
    return raw
      .filter((p) => p.frontmatter.date && !p.url.endsWith('/posts/'))
      .map(({ url, frontmatter, src }) => ({
        title: frontmatter.title,
        url,
        date: new Date(frontmatter.date).toISOString().slice(0, 10),
        category: frontmatter.category || '未分类',
        tags: frontmatter.tags || [],
        description: frontmatter.description || '',
        readingTime: readingTime(src || ''),
        cover: frontmatter.cover
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
  }
})
