import { createContentLoader } from 'vitepress'

export interface Post {
  title: string; url: string; date: string; category: string
  tags: string[]; description: string
}
declare const data: Post[]
export { data }

export default createContentLoader('posts/*.md', {
  transform(raw): Post[] {
    return raw
      .filter((p) => p.frontmatter.date && !p.url.endsWith('/posts/'))
      .map(({ url, frontmatter }) => ({
        title: frontmatter.title,
        url,
        date: new Date(frontmatter.date).toISOString().slice(0, 10),
        category: frontmatter.category || '未分类',
        tags: frontmatter.tags || [],
        description: frontmatter.description || ''
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
  }
})
