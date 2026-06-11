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

// 圖卡底圖：夜間世界盃球場（與遊戲同一座場館）；載入失敗退回漸層
const cardBg = new Image()
let cardBgReady = false
cardBg.onload = () => {
  cardBgReady = true
}
cardBg.src = 'assets/bg/pk-night.webp'
const CARD_BG_CUT = 0.495 // 圖中草地分界線比例（與 pk.js 同一實測值）

function unitText(mode, n) {
  const tpl = t('shareUnit')
  const s = (tpl && tpl[MODE_META[mode].unitKey]) || '{n}'
  return s.replace('{n}', n)
}

// 在 1080×1080 的 ctx 上繪製成績圖卡（夜間世界盃轉播風）
function drawCard(ctx, { mode, score, best }) {
  const meta = MODE_META[mode] || MODE_META.keepy
  const accent = meta.accent
  const cx = SIZE / 2

  // 背景：夜景球場照片（草地分界線對齊約 52% 高度），未載入時退回漸層
  if (cardBgReady) {
    const sw = cardBg.width
    const boundary = cardBg.height * CARD_BG_CUT
    const sy = Math.max(0, Math.min(cardBg.height - sw, boundary - sw * 0.52))
    ctx.drawImage(cardBg, 0, sy, sw, sw, 0, 0, SIZE, SIZE)
  } else {
    const bg = ctx.createLinearGradient(0, 0, 0, SIZE)
    bg.addColorStop(0, '#060b18')
    bg.addColorStop(0.52, '#16233f')
    bg.addColorStop(0.52, '#2c6e38')
    bg.addColorStop(1, '#1d5228')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, SIZE, SIZE)
  }

  // 可讀性疊層：上下壓深、中段留亮，加深色 vignette
  const ov = ctx.createLinearGradient(0, 0, 0, SIZE)
  ov.addColorStop(0, 'rgba(5,9,20,0.78)')
  ov.addColorStop(0.3, 'rgba(5,9,20,0.4)')
  ov.addColorStop(0.55, 'rgba(5,9,20,0.42)')
  ov.addColorStop(1, 'rgba(5,9,20,0.82)')
  ctx.fillStyle = ov
  ctx.fillRect(0, 0, SIZE, SIZE)
  const vig = ctx.createRadialGradient(cx, SIZE * 0.46, SIZE * 0.3, cx, SIZE * 0.46, SIZE * 0.8)
  vig.addColorStop(0, 'rgba(0,0,0,0)')
  vig.addColorStop(1, 'rgba(2,6,14,0.45)')
  ctx.fillStyle = vig
  ctx.fillRect(0, 0, SIZE, SIZE)

  ctx.textAlign = 'center'

  // App 標題
  ctx.fillStyle = '#fff'
  ctx.font = '800 58px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif'
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowOffsetY = 4
  ctx.shadowBlur = 12
  ctx.fillText(t('appTitle'), cx, 116)
  ctx.shadowColor = 'transparent'
  ctx.shadowOffsetY = 0
  ctx.shadowBlur = 0

  // 模式章（轉播風斜切色塊）
  ctx.font = '800 38px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif'
  const modeText = t(meta.titleKey)
  const mw = ctx.measureText(modeText).width + 64
  const chipY = 152
  const chipH = 62
  ctx.save()
  ctx.beginPath()
  const skew = 14
  ctx.moveTo(cx - mw / 2 + skew, chipY)
  ctx.lineTo(cx + mw / 2 + skew, chipY)
  ctx.lineTo(cx + mw / 2 - skew, chipY + chipH)
  ctx.lineTo(cx - mw / 2 - skew, chipY + chipH)
  ctx.closePath()
  const chipGrad = ctx.createLinearGradient(0, chipY, 0, chipY + chipH)
  chipGrad.addColorStop(0, accent)
  chipGrad.addColorStop(1, shade(accent, -28))
  ctx.fillStyle = chipGrad
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowOffsetY = 5
  ctx.shadowBlur = 14
  ctx.fill()
  ctx.restore()
  ctx.fillStyle = '#101418'
  ctx.fillText(modeText, cx, chipY + 44)

  // 足球（光暈墊底，融入夜景）
  ctx.save()
  ctx.shadowColor = 'rgba(255,255,255,0.35)'
  ctx.shadowBlur = 46
  drawBall(ctx, { cx, cy: 332, r: 84 })
  ctx.restore()

  // 主數字（斜體轉播風 + 模式色光暈）
  ctx.save()
  ctx.transform(1, 0, -0.12, 1, 0, 0) // skewX(-7°)
  ctx.fillStyle = accent
  ctx.font = '900 212px -apple-system, sans-serif'
  ctx.shadowColor = 'rgba(0,0,0,0.6)'
  ctx.shadowOffsetY = 8
  ctx.shadowBlur = 4
  const skx = cx + 0.12 * 560 // 補償 skew 位移，視覺置中
  ctx.fillText(String(score), skx, 560)
  ctx.restore()

  // 單位 / 說明
  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.font = '700 42px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif'
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowOffsetY = 3
  ctx.fillText(unitText(mode, score), cx, 632)
  ctx.shadowColor = 'transparent'
  ctx.shadowOffsetY = 0

  // 最高分（金色細字）
  ctx.fillStyle = 'rgba(255,211,61,0.92)'
  ctx.font = '600 33px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif'
  ctx.fillText(`${t('bestScore')}: ${best}`, cx, 690)

  // QR Code（白底面板，掃描直接進入該模式）
  const qrSize = 188
  const qx = cx - qrSize / 2
  const qy = 736
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowOffsetY = 6
  ctx.shadowBlur = 18
  drawQR(ctx, gameUrl(mode), qx, qy, qrSize)
  ctx.restore()

  // QR 下方標語
  ctx.fillStyle = '#fff'
  ctx.font = '700 34px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif'
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowOffsetY = 3
  ctx.fillText(t('shareScanCta'), cx, qy + qrSize + 52)
  ctx.shadowColor = 'transparent'
  ctx.shadowOffsetY = 0
}

// 簡易色彩加深（hex → 加 delta 後 clamp）
function shade(hex, delta) {
  const n = parseInt(hex.slice(1), 16)
  const ch = (v) => Math.max(0, Math.min(255, v + delta))
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`
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
