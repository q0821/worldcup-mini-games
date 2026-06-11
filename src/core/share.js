// 分享圖卡：把分數畫成 PNG（Canvas），用 Web Share API 帶檔分享 / 不支援則下載。
// 分數是圖片像素的一部分，分享到任何平台都看得到，不需要後端 / OG meta。
import { t } from './i18n.js'
import { getBest } from './storage.js'
import { drawBall } from '../ball.js'

const SIZE = 1080

// 各模式：標題、主數字標籤格式、主色
const MODE_META = {
  keepy: { titleKey: 'mode1Title', unitKey: 'keepy', accent: '#ffd33d' },
  header: { titleKey: 'mode2Title', unitKey: 'header', accent: '#5ad1ff' },
  pk: { titleKey: 'mode3Title', unitKey: 'pk', accent: '#ff8d3a' },
}

function unitText(mode, n) {
  const tpl = t('shareUnit')
  const s = (tpl && tpl[MODE_META[mode].unitKey]) || '{n}'
  return s.replace('{n}', n)
}

// 在 1080×1080 的 ctx 上繪製成績圖卡
function drawCard(ctx, { mode, score, best }) {
  const meta = MODE_META[mode] || MODE_META.keepy
  const accent = meta.accent
  const cx = SIZE / 2

  // 背景：天空 → 草皮
  const bg = ctx.createLinearGradient(0, 0, 0, SIZE)
  bg.addColorStop(0, '#0c3b6e')
  bg.addColorStop(0.42, '#1f6fb0')
  bg.addColorStop(0.42, '#2f8b3d')
  bg.addColorStop(1, '#1c5c28')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, SIZE, SIZE)

  // 草皮割草條紋
  ctx.fillStyle = 'rgba(255,255,255,0.045)'
  for (let i = 0; i < 7; i += 2) ctx.fillRect(0, SIZE * 0.42 + (i * SIZE * 0.58) / 7, SIZE, (SIZE * 0.58) / 7)

  // 邊角暗角
  const vig = ctx.createRadialGradient(cx, SIZE * 0.5, SIZE * 0.35, cx, SIZE * 0.5, SIZE * 0.75)
  vig.addColorStop(0, 'rgba(0,0,0,0)')
  vig.addColorStop(1, 'rgba(0,0,0,0.35)')
  ctx.fillStyle = vig
  ctx.fillRect(0, 0, SIZE, SIZE)

  ctx.textAlign = 'center'

  // App 標題
  ctx.fillStyle = '#fff'
  ctx.font = '700 60px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif'
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowOffsetY = 4
  ctx.shadowBlur = 0
  ctx.fillText(t('appTitle'), cx, 150)
  ctx.shadowColor = 'transparent'
  ctx.shadowOffsetY = 0

  // 模式名（accent 色膠囊）
  ctx.font = '700 38px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif'
  const modeText = t(meta.titleKey)
  const mw = ctx.measureText(modeText).width + 56
  roundRect(ctx, cx - mw / 2, 192, mw, 64, 32)
  ctx.fillStyle = accent
  ctx.fill()
  ctx.fillStyle = '#15241a'
  ctx.fillText(modeText, cx, 235)

  // 足球
  drawBall(ctx, { cx, cy: 400, r: 110 })

  // 主數字
  ctx.fillStyle = accent
  ctx.font = '800 240px -apple-system, sans-serif'
  ctx.shadowColor = 'rgba(0,0,0,0.4)'
  ctx.shadowOffsetY = 6
  ctx.fillText(String(score), cx, 720)
  ctx.shadowColor = 'transparent'
  ctx.shadowOffsetY = 0

  // 單位 / 說明
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.font = '600 46px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif'
  ctx.fillText(unitText(mode, score), cx, 800)

  // 最高分
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.font = '500 36px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif'
  ctx.fillText(`${t('bestScore')}: ${best}`, cx, 880)

  // CTA 膠囊
  ctx.font = '700 40px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif'
  const cta = t('shareCardCta')
  const cw = ctx.measureText(cta).width + 80
  roundRect(ctx, cx - cw / 2, 955, cw, 78, 39)
  ctx.fillStyle = 'rgba(255,255,255,0.16)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = '#fff'
  ctx.fillText(cta, cx, 1008)
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r)
  else {
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }
}

export function renderShareCanvas({ mode, score, best }) {
  const cv = document.createElement('canvas')
  cv.width = SIZE
  cv.height = SIZE
  const ctx = cv.getContext('2d')
  drawCard(ctx, { mode, score, best })
  return cv
}

// 觸發分享：手機走 Web Share（帶 PNG 檔），桌機 / 不支援則下載。
// 回傳 'shared' | 'downloaded' | 'cancelled'
export async function shareScore({ mode, score, best }) {
  const cv = renderShareCanvas({ mode, score, best })
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'))
  if (!blob) return 'cancelled'

  const modeTitle = t(MODE_META[mode] ? MODE_META[mode].titleKey : 'appTitle')
  const text = t('shareText').replace('{mode}', modeTitle).replace('{score}', unitText(mode, score))
  const file = new File([blob], 'worldcup-score.png', { type: 'image/png' })

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text, title: t('appTitle') })
      return 'shared'
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled'
      // 分享失敗 → 退回下載
    }
  }
  // 下載 PNG
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `worldcup-${mode}-${score}.png`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return 'downloaded'
}

// 把結算畫面的「分享成績」按鈕接上分享流程（最高分自 storage 取）。
export function bindShare(btn, mode, score) {
  if (!btn) return
  btn.addEventListener('click', async () => {
    if (btn.dataset.busy) return
    btn.dataset.busy = '1'
    const orig = btn.textContent
    try {
      const r = await shareScore({ mode, score, best: getBest(mode) })
      if (r === 'downloaded') btn.textContent = t('shareSaved')
    } catch (e) {
      console.error('[分享] 失敗', e)
    } finally {
      setTimeout(() => {
        btn.textContent = orig
        delete btn.dataset.busy
      }, 1600)
    }
  })
}
