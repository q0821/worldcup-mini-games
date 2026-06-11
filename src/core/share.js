// 分享圖卡：把分數畫成 PNG（Canvas），用 Web Share API 帶檔分享 / 不支援則下載。
// 分數是圖片像素的一部分，分享到任何平台都看得到，不需要後端 / OG meta。
// 圖卡含 QR Code（指向遊戲網址），任何人看到圖、掃一下就能回站玩。
import qrcode from 'qrcode-generator'
import { t } from './i18n.js'
import { getBest } from './storage.js'
import { drawBall } from '../ball.js'

const SIZE = 1080
// 正式網址（vite.config.js define 注入的單一來源）
const SITE_URL = typeof __SITE_URL__ !== 'undefined' ? __SITE_URL__ : 'https://worldcup.jackie-yeh.com'
// 遊戲網址：優先用實際部署來源（本機=localhost、上線=部署網域），SSR 無 location 時退回正式網址。
// 帶 mode 時附上 #模式 深連結 → 點連結 / 掃 QR 直接進入該模式（路由見 main.js）
const gameUrl = (mode) => {
  const base = typeof location !== 'undefined' ? location.origin : SITE_URL
  return mode ? `${base}/#${mode}` : base
}

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
  ctx.font = '700 54px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif'
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowOffsetY = 4
  ctx.fillText(t('appTitle'), cx, 108)
  ctx.shadowColor = 'transparent'
  ctx.shadowOffsetY = 0

  // 模式名（accent 色膠囊）
  ctx.font = '700 36px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif'
  const modeText = t(meta.titleKey)
  const mw = ctx.measureText(modeText).width + 52
  roundRect(ctx, cx - mw / 2, 142, mw, 58, 29)
  ctx.fillStyle = accent
  ctx.fill()
  ctx.fillStyle = '#15241a'
  ctx.fillText(modeText, cx, 181)

  // 足球
  drawBall(ctx, { cx, cy: 330, r: 86 })

  // 主數字
  ctx.fillStyle = accent
  ctx.font = '800 200px -apple-system, sans-serif'
  ctx.shadowColor = 'rgba(0,0,0,0.4)'
  ctx.shadowOffsetY = 6
  ctx.fillText(String(score), cx, 560)
  ctx.shadowColor = 'transparent'
  ctx.shadowOffsetY = 0

  // 單位 / 說明
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.font = '600 40px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif'
  ctx.fillText(unitText(mode, score), cx, 626)

  // 最高分
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.font = '500 32px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif'
  ctx.fillText(`${t('bestScore')}: ${best}`, cx, 678)

  // QR Code（白底面板，掃描直接進入該模式）
  const qrSize = 184
  const qx = cx - qrSize / 2
  const qy = 716
  drawQR(ctx, gameUrl(mode), qx, qy, qrSize)

  // QR 下方標語
  ctx.fillStyle = '#fff'
  ctx.font = '700 34px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif'
  ctx.fillText(t('shareScanCta'), cx, qy + qrSize + 48)
}

// 在 (x,y) 畫白底 QR（含 quiet zone），編碼 url
function drawQR(ctx, url, x, y, size) {
  const qr = qrcode(0, 'M')
  qr.addData(url)
  qr.make()
  const n = qr.getModuleCount()
  const quiet = 3
  const total = n + quiet * 2
  const cell = size / total
  ctx.save()
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, x, y, size, size, 14)
  ctx.fill()
  ctx.fillStyle = '#101418'
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect(x + (c + quiet) * cell, y + (r + quiet) * cell, cell + 0.6, cell + 0.6)
      }
    }
  }
  ctx.restore()
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
  const url = gameUrl(mode) // 深連結：點開直接進入該模式
  // 文字附上網址：支援的平台會一併帶出可點連結（不支援時圖上仍有 QR 可掃）
  const text = `${t('shareText').replace('{mode}', modeTitle).replace('{score}', unitText(mode, score))} ${url}`
  const file = new File([blob], 'worldcup-score.png', { type: 'image/png' })

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text, url, title: t('appTitle') })
      return 'shared'
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled'
      // 分享失敗 → 退回下載
    }
  }
  // 下載 PNG
  const dlUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = dlUrl
  a.download = `worldcup-${mode}-${score}.png`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(dlUrl), 1000)
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

// 通用 OG 預覽圖（1200×630 橫式），給社群分享網址時的 og:image。
// 在瀏覽器 render 後輸出存成 public/og.png（一次性資產）。
export function renderOgCanvas(canonicalUrl = SITE_URL) {
  const W = 1200
  const H = 630
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')

  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#0c3b6e')
  bg.addColorStop(0.5, '#1f6fb0')
  bg.addColorStop(0.5, '#2f8b3d')
  bg.addColorStop(1, '#1c5c28')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = 'rgba(255,255,255,0.04)'
  for (let i = 0; i < 6; i += 2) ctx.fillRect(0, H * 0.5 + (i * H * 0.5) / 6, W, (H * 0.5) / 6)

  // 左側文字
  ctx.textAlign = 'left'
  ctx.fillStyle = '#fff'
  ctx.font = '800 92px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif'
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowOffsetY = 5
  ctx.fillText(t('appTitle'), 80, 250)
  ctx.shadowColor = 'transparent'
  ctx.shadowOffsetY = 0
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.font = '600 40px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif'
  ctx.fillText(t('tagline'), 82, 320)
  // 三模式
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.font = '600 34px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif'
  ctx.fillText(`${t('mode1Title')}  ·  ${t('mode2Title')}  ·  ${t('mode3Title')}`, 82, 400)

  // 右側：大足球 + QR
  drawBall(ctx, { cx: 880, cy: 240, r: 150 })
  const qs = 150
  drawQR(ctx, canonicalUrl, 1010, 430, qs)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#fff'
  ctx.font = '700 26px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif'
  ctx.fillText(t('shareScanCta'), 1010 + qs / 2, 430 + qs + 36)

  return cv
}
