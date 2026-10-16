// 社交账号统一配置：导航、页脚、关于页、首页订阅区都从这里读
export const ICONS = {
  github: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8.1 3.2.8.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1.1.9 2.2v3.3c0 .3.1.7.8.6A12 12 0 0 0 12 .3"/></svg>',
  juejin: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M12 3.2 9.9 4.9 12 6.6l2.1-1.7zm0 6.1-5.6-4.4L4.3 6.5 12 12.6l7.7-6.1-2.1-1.6zM12 15.7 2.7 8.4.6 10.1 12 19.1l11.4-9-2.1-1.7z"/></svg>',
  csdn: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><path fill="currentColor" d="M15.9 9.6a4.1 4.1 0 1 0 0 4.8l1.9 1.1a6.3 6.3 0 1 1 0-7z"/></svg>',
  wechat: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M9 3.5C4.9 3.5 1.6 6.3 1.6 9.8c0 2 1.1 3.7 2.8 4.9l-.7 2.1 2.5-1.3c.9.3 1.8.4 2.8.4h.6a5.6 5.6 0 0 1-.2-1.5c0-3.4 3.2-6.1 7.2-6.1h.5C16.4 5.7 13 3.5 9 3.5zM6.6 7.3a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8zm4.8 0a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8zm5.9 2.8c-3.4 0-6.1 2.3-6.1 5.1s2.7 5.1 6.1 5.1c.7 0 1.4-.1 2.1-.3l2 1.1-.5-1.8c1.5-.9 2.5-2.4 2.5-4.1 0-2.8-2.7-5.1-6.1-5.1zm-2 2.8a.8.8 0 1 1 0 1.5.8.8 0 0 1 0-1.5zm4 0a.8.8 0 1 1 0 1.5.8.8 0 0 1 0-1.5z"/></svg>',
  rss: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M6.18 15.64a2.18 2.18 0 1 1 0 4.36 2.18 2.18 0 0 1 0-4.36zM4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27zm0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93z"/></svg>'
}

export interface Social { key: keyof typeof ICONS; name: string; link: string; handle: string; hint?: string; color: string }

export const SOCIALS: Social[] = [
  { key: 'github', name: 'GitHub', link: 'https://github.com/MsNan', handle: '@MsNan', hint: '开源项目源码', color: '#24292f' },
  { key: 'juejin', name: '掘金', link: 'https://juejin.cn/user/3579665589741709', handle: '掘金主页', hint: '技术文章同步', color: '#1e80ff' },
  { key: 'csdn', name: 'CSDN', link: 'https://blog.csdn.net/Guo_Tao', handle: 'Guo_Tao', hint: '技术文章同步', color: '#fc5531' },
  { key: 'wechat', name: '公众号', link: 'https://mp.weixin.qq.com/s/-Z7GPfCS8SmFdUmN8RLwrA', handle: '程序员项目库', hint: '微信搜索关注', color: '#07c160' }
]
