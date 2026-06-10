// 背景圖層：嘗試載入 AI 生成圖，失敗則用 CSS 漸層保底。
// 把圖片放到 /public/assets/bg/<name>.webp 即自動生效。
export function makeBgLayer(name) {
  const el = document.createElement('div')
  el.className = 'bg-layer bg-fallback'
  if (name) {
    const url = `assets/bg/${name}.webp`
    const img = new Image()
    img.onload = () => {
      el.style.backgroundImage = `url(${url})`
      el.classList.remove('bg-fallback')
    }
    img.src = url
  }
  return el
}
