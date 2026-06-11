// 經典足球 (Telstar 黑白拼接) 繪製 + 擠壓變形。
// 球體用 Canvas 即時繪製，因此會自轉、會 squash，且任何尺寸都銳利。
//
// 為了「不假」，分五層疊出球體量感：
//   1) 球面漸層底 (光源左上 → 邊緣壓暗)
//   2) 隨自轉的黑色拼接圖案 + 接縫線
//   3) 邊緣暗角 vignette (固定不轉，強化球面弧度)
//   4) 左上高光 (固定光源，不隨自轉)
//   5) 輪廓描邊

// 真實足球照片（有就用，圓形裁切 → 免去背）；載入失敗退回程序繪製。
const ballImg = new Image()
let ballImgReady = false
ballImg.onload = () => {
  ballImgReady = true
}
ballImg.src = 'assets/ball.png'

// 在指定 ctx 上畫一顆足球。
//  cx, cy: 球心；r: 半徑；rotation: 自轉角(弧度)
//  sx, sy: 變形量 (1 = 不變形)；squashAngle: 變形主軸方向(弧度)
export function drawBall(ctx, opts) {
  if (ballImgReady) drawBallPhoto(ctx, opts)
  else drawBallVector(ctx, opts)
}

// 照片版：圓形裁切（球是圓的、免去背）+ 旋轉 + 擠壓 + 固定光源高光/暗角
function drawBallPhoto(ctx, { cx, cy, r, rotation = 0, sx = 1, sy = 1, squashAngle = 0 }) {
  ctx.save()
  ctx.translate(cx, cy)
  // 擠壓：在變形後的座標系裡裁圓 → 螢幕上呈橢圓
  ctx.rotate(squashAngle)
  ctx.scale(sx, sy)
  ctx.rotate(-squashAngle)

  ctx.save()
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.clip()
  // 自轉：轉圖案；放大 1.04 確保照片填滿裁切圓、不露邊角背景
  ctx.rotate(rotation)
  const d = r * 2.08
  ctx.drawImage(ballImg, -d / 2, -d / 2, d, d)
  ctx.restore()

  // 固定光源高光（不隨自轉）→ 修正照片自轉時烤進的光影方向
  const hl = ctx.createRadialGradient(-r * 0.4, -r * 0.45, r * 0.05, -r * 0.4, -r * 0.45, r * 1.0)
  hl.addColorStop(0, 'rgba(255,255,255,0.45)')
  hl.addColorStop(0.3, 'rgba(255,255,255,0)')
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fillStyle = hl
  ctx.fill()
  // 邊緣暗角
  const vig = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r)
  vig.addColorStop(0, 'rgba(0,0,0,0)')
  vig.addColorStop(0.88, 'rgba(0,0,0,0)')
  vig.addColorStop(1, 'rgba(0,0,0,0.28)')
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fillStyle = vig
  ctx.fill()

  ctx.restore()
}

function drawBallVector(ctx, { cx, cy, r, rotation = 0, sx = 1, sy = 1, squashAngle = 0 }) {
  ctx.save()
  ctx.translate(cx, cy)

  // 沿撞擊方向施加擠壓 (squash/stretch)
  ctx.rotate(squashAngle)
  ctx.scale(sx, sy)

  // 沿撞擊方向施加擠壓 (squash/stretch)
  ctx.rotate(squashAngle)
  ctx.scale(sx, sy)
  ctx.rotate(-squashAngle)

  // 1) 球面底色：光源左上，邊緣稍暗呈量感
  const base = ctx.createRadialGradient(-r * 0.35, -r * 0.42, r * 0.12, 0, 0, r * 1.08)
  base.addColorStop(0, '#ffffff')
  base.addColorStop(0.55, '#ededeb')
  base.addColorStop(1, '#c4c6ba')
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fillStyle = base
  ctx.fill()

  // 2) 拼接圖案 (隨自轉)，限制在球內
  ctx.save()
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.clip()
  ctx.rotate(rotation)
  drawPattern(ctx, r)
  ctx.restore()

  // 3) 邊緣暗角：模擬球面往兩側彎曲的明暗
  const vig = ctx.createRadialGradient(0, 0, r * 0.55, 0, 0, r)
  vig.addColorStop(0, 'rgba(0,0,0,0)')
  vig.addColorStop(0.82, 'rgba(0,0,0,0)')
  vig.addColorStop(1, 'rgba(0,0,0,0.3)')
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fillStyle = vig
  ctx.fill()

  // 4) 左上高光 (固定光源，不隨自轉)
  const hl = ctx.createRadialGradient(-r * 0.4, -r * 0.46, r * 0.04, -r * 0.4, -r * 0.46, r * 0.95)
  hl.addColorStop(0, 'rgba(255,255,255,0.72)')
  hl.addColorStop(0.22, 'rgba(255,255,255,0.12)')
  hl.addColorStop(0.5, 'rgba(255,255,255,0)')
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fillStyle = hl
  ctx.fill()

  // 5) 輪廓
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.lineWidth = Math.max(1, r * 0.03)
  ctx.strokeStyle = 'rgba(22,22,22,0.55)'
  ctx.stroke()

  ctx.restore()
}

// 黑白足球拼接 (截角二十面體正面投影)：
//   中央 1 黑五邊形 → 5 白六邊形 (各貼中央一條邊) → 球緣 5 黑五邊形 (對齊邊方向、半藏於輪廓)。
// 黑五邊形彼此不相鄰，皆被白六邊形隔開。
function drawPattern(ctx, r) {
  const panel = '#1a1a1a'
  const cR = r * 0.36 // 中央五邊形外接圓半徑
  const cAng = -Math.PI / 2 // 尖端朝上
  const V = pentVerts(0, 0, cR, cAng)
  const s = 2 * cR * Math.sin(Math.PI / 5) // 六邊形邊長 = 中央五邊形邊長

  // 1) 接縫：自中央五邊形每個頂點，沿頂點方向往外畫一段 (相鄰兩白六邊形的共用邊)。
  //    僅此 5 條放射線；外段稍後被黑五邊形蓋住，白色區不會有重疊雜線。
  ctx.strokeStyle = 'rgba(50,50,50,0.4)'
  ctx.lineWidth = Math.max(1, r * 0.02)
  ctx.lineCap = 'round'
  for (let k = 0; k < 5; k++) {
    const th = cAng + (k * 2 * Math.PI) / 5
    ctx.beginPath()
    ctx.moveTo(Math.cos(th) * cR, Math.sin(th) * cR)
    ctx.lineTo(Math.cos(th) * (cR + s), Math.sin(th) * (cR + s))
    ctx.stroke()
  }

  // 2) 球緣 5 片黑五邊形：對齊頂點方向 (相鄰兩六邊形之間)，半藏於輪廓。
  for (let k = 0; k < 5; k++) {
    const th = cAng + (k * 2 * Math.PI) / 5
    const cx = Math.cos(th) * r * 0.86
    const cy = Math.sin(th) * r * 0.86
    fillPoly(ctx, pentVerts(cx, cy, r * 0.34, th + Math.PI), panel) // 頂點朝內
  }

  // 3) 中央黑五邊形
  fillPoly(ctx, V, panel)
}

function pentVerts(x, y, size, rot) {
  const verts = []
  for (let i = 0; i < 5; i++) {
    const a = rot + (i * 2 * Math.PI) / 5
    verts.push([x + Math.cos(a) * size, y + Math.sin(a) * size])
  }
  return verts
}

function fillPoly(ctx, verts, color) {
  ctx.beginPath()
  verts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)))
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}
