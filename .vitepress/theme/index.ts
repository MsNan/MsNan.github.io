import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import { h } from 'vue'
import PostMeta from './components/PostMeta.vue'
import PostFooter from './components/PostFooter.vue'
import PostList from './components/PostList.vue'
import Categories from './components/Categories.vue'
import Tags from './components/Tags.vue'
import Archive from './components/Archive.vue'
import NotFound from './components/NotFound.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'doc-before': () => h(PostMeta),
      'doc-after': () => h(PostFooter),
      'not-found': () => h(NotFound)
    })
  },
  enhanceApp({ app }) {
    app.component('PostList', PostList)
    app.component('Categories', Categories)
    app.component('Tags', Tags)
    app.component('Archive', Archive)
  }
} satisfies Theme
