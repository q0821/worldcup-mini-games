// 最高分本地儲存 (無後端、無排行榜)
const PREFIX = 'fg_best_'

export function getBest(mode) {
  const v = Number(localStorage.getItem(PREFIX + mode))
  return Number.isFinite(v) ? v : 0
}

// 回傳 true 代表破紀錄
export function submitScore(mode, score) {
  const best = getBest(mode)
  if (score > best) {
    localStorage.setItem(PREFIX + mode, String(score))
    return true
  }
  return false
}
