// 極簡畫面路由：每個畫面是一個 factory，回傳 { el, destroy }。
const root = () => document.getElementById('app')
let current = null

export function showScreen(factory, props = {}) {
  if (current && current.destroy) current.destroy()
  root().innerHTML = ''
  current = factory(props) || {}
  if (current.el) root().appendChild(current.el)
}
