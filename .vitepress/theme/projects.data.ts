export interface Project {
  repo: string; name: string; icon: string; desc: string
  tags: string[]; post?: string; stars: number; forks: number; lang: string
}
declare const data: Project[]
export { data }

const LIST = [
  { repo: 'MsNan/md-multi-format', name: '多平台 Markdown 排版', icon: '🪄',
    desc: '写一次 Markdown，一键复制到公众号（内联样式、外链转脚注）、知乎、掘金/CSDN（规范 Markdown），还能自动生成小红书 3:4 图文卡片并导出 PNG。纯本地，不自动发布。在线地址：msnan.github.io/md-multi-format',
    tags: ['Markdown', '公众号', '小红书', 'Vue3'] },
  { repo: 'MsNan/prompt-hub-cn', name: '提示词百宝箱', icon: '🧰',
    desc: '66 条原创中文 Prompt 与 AI Agent 模板，覆盖编程、代码审查、产品、运营、求职、Cursor rules、Claude skills。在线搜索、填变量、一键复制、本地收藏。在线地址：msnan.github.io/prompt-hub-cn',
    tags: ['Prompt', 'AI Agent', 'Vue3'] },
  { repo: 'MsNan/bishe-kit', name: '毕设/接单全栈脚手架', icon: '🎓',
    desc: 'Vue3 + Element Plus 后台、uni-app 用户端（H5/小程序）、Express + SQLite 零配置。JWT 双端登录、RBAC、一条命令生成 CRUD 模块，附 AI 提示词包。只提供源码，不代写论文。',
    tags: ['Vue3', 'uni-app', 'Express'] },
  { repo: 'MsNan/cn-dev-mcp', name: '中国开发者 MCP 工具集', icon: '🧰',
    desc: '13 个离线 MCP 工具：节假日调休、工作日计算、身份证/信用代码/手机号格式校验、拼音、农历、行政区划、uni-app/小程序/Element Plus/Vant 文档速查。npx 一行接入 Cursor / Claude / Trae。',
    tags: ['MCP', 'AI', 'Node.js'] },
  { repo: 'MsNan/vue-uniapp-skills', name: 'Vue3 + uni-app AI 技能包', icon: '🧠',
    desc: '12 个中文 AI 编程技能：跨端条件编译、分包、登录、支付、401 请求封装、Pinia、发版审核清单。一行 npx 装进 Cursor / Claude Code / Trae / Codex。',
    tags: ['AI Skills', 'uni-app', 'Cursor'] },
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
