export interface Project {
  repo: string; name: string; icon: string; desc: string
  tags: string[]; post?: string; stars: number; forks: number; lang: string
}
declare const data: Project[]
export { data }

const LIST = [
  { repo: 'MsNan/taohaowu-shop', name: '淘好物商城', icon: '🛒', post: '/posts/uni-app-mall-from-0-to-1',
    desc: 'uni-app（Vue 3 + Pinia）+ Express 全栈商城，一套代码跑 H5 / 小程序 / App，自带 /admin 管理后台与 JWT 双角色鉴权。',
    tags: ['uni-app', 'Vue3', 'Express'] },
  { repo: 'MsNan/dev-learning-projects', name: '软件开发学习项目', icon: '📚',
    desc: '图书管理系统、移动端座位预约、电影推荐与数据可视化，三个可直接运行的练手项目。',
    tags: ['Vue', 'Node.js', '可视化'] },
  { repo: 'MsNan/wechat-group-bot', name: '微信群消息自动回复', icon: '💬', post: '/posts/wechat-group-bot-ui-automation',
    desc: 'Python + Windows UI Automation 读取微信 PC 版群消息，业务指令 → 关键词 → AI 兜底三层决策，多模型降级与限流。仅供学习，建议用小号。',
    tags: ['Python', 'UI Automation', 'AI'] }
]

export default {
  async load(): Promise<Project[]> {
    return Promise.all(LIST.map(async (p) => {
      let stars = 0, forks = 0, lang = ''
      try {
        const headers: Record<string, string> = { 'User-Agent': 'msnan-blog' }
        if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
        const r = await fetch(`https://api.github.com/repos/${p.repo}`, { headers })
        if (r.ok) { const j: any = await r.json(); stars = j.stargazers_count; forks = j.forks_count; lang = j.language || '' }
      } catch {}
      return { ...p, stars, forks, lang }
    }))
  }
}
