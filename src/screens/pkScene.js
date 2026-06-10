// PK 場景：透視投影 + 球場 / 球門 / 網子 / 門將繪製（寫實風、純 Canvas 程序繪製）。
// 世界座標（公尺）：x 向右、y 向上、z 自罰球點 (0) 朝球門 (GOAL.z)。
// 尺寸採真實規格：球門 7.32 × 2.44 m、罰球距離 11 m、足球半徑 0.11 m。

export const GOAL = { halfW: 3.66, height: 2.44, z: 11, postR: 0.06 }
export const BALL_R = 0.11

export function makeCamera(W, H) {
  const K = Math.min(W * 0.8, H * 0.52) // 球門投影寬約 = K px
  const c = 1.75 // 透視強度（越小越誇張）
  const horizonY = H * 0.3
  const baseY = H * 0.875 // 罰球點的螢幕高度
  const scale = (z) => c / (c + z)
  const groundY = (z) => horizonY + (baseY - horizonY) * scale(z)
  return {
    W,
    H,
    K,
    horizonY,
    baseY,
    scale,
    groundY,
    project(x, y, z) {
      const s = scale(z)
      return { x: W / 2 + x * K * s, y: groundY(z) - y * K * s, s }
    },
    // 螢幕點 → 球門平面 (z = GOAL.z) 世界座標
    unprojectGoal(sx, sy) {
      const s = scale(GOAL.z)
      return { x: (sx - W / 2) / (K * s), y: (groundY(GOAL.z) - sy) / (K * s) }
    },
  }
}

// ---------- 背景（看台 / 草皮 / 白線），resize 時預渲染一次 ----------
// 若提供 standsImg（AI 生成看台圖），取代程序繪製的天空 + 看台區。
export function renderBackground(cam, dpr, standsImg = null) {
  const { W, H, horizonY, groundY } = cam
  const cv = document.createElement('canvas')
  cv.width = Math.round(W * dpr)
  cv.height = Math.round(H * dpr)
  const g = cv.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, 0, 0)

  if (standsImg) {
    // AI 看台圖：cover 進地平線以上區域
    const region = horizonY + 2
    const ir = standsImg.width / standsImg.height
    let dw = W
    let dh = dw / ir
    if (dh < region) {
      dh = region
      dw = dh * ir
    }
    g.drawImage(standsImg, (W - dw) / 2, region - dh, dw, dh)
  } else {
    drawStands(g, W, horizonY)
  }

  // 草皮：橫向割草條紋，由遠到近。z 不可逼近相機平面 (z = -c)，否則 scale 變負。
  const Z_MIN = -1.2
  for (let i = 0; ; i++) {
    const zFar = 16 - i * 1.4
    if (zFar <= Z_MIN) break
    const zNear = Math.max(zFar - 1.4, Z_MIN)
    const yTop = i === 0 ? horizonY : groundY(zFar)
    const yBot = Math.min(H + 2, groundY(zNear))
    g.fillStyle = i % 2 === 0 ? '#3f9b4b' : '#379145'
    g.fillRect(0, yTop - 0.5, W, yBot - yTop + 1)
  }
  // 草皮縱深明暗（遠處偏冷灰、近處飽和）
  const tint = g.createLinearGradient(0, horizonY, 0, H)
  tint.addColorStop(0, 'rgba(190,215,235,0.22)')
  tint.addColorStop(0.35, 'rgba(190,215,235,0)')
  tint.addColorStop(1, 'rgba(0,30,0,0.12)')
  g.fillStyle = tint
  g.fillRect(0, horizonY, W, H - horizonY)

  // 廣告看板（球門後方，需畫在草皮之後才不被蓋掉）
  drawHoardings(g, cam)

  // 白線：球門線 + 小禁區 + 罰球點
  const line = (x1, z1, x2, z2) => {
    const a = cam.project(x1, 0, z1)
    const b = cam.project(x2, 0, z2)
    g.strokeStyle = 'rgba(250,250,248,0.92)'
    g.lineWidth = Math.max(1.5, 0.07 * cam.K * ((a.s + b.s) / 2))
    g.beginPath()
    g.moveTo(a.x, a.y)
    g.lineTo(b.x, b.y)
    g.stroke()
  }
  line(-11, GOAL.z, 11, GOAL.z) // 球門線
  line(-9.16, GOAL.z, -9.16, GOAL.z - 5.5) // 小禁區左
  line(9.16, GOAL.z, 9.16, GOAL.z - 5.5) // 小禁區右
  line(-9.16, GOAL.z - 5.5, 9.16, GOAL.z - 5.5) // 小禁區前緣
  const spot = cam.project(0, 0, 0)
  g.fillStyle = 'rgba(250,250,248,0.95)'
  g.beginPath()
  g.ellipse(spot.x, spot.y, 0.16 * cam.K, 0.05 * cam.K, 0, 0, Math.PI * 2)
  g.fill()

  // 角落 vignette
  const vig = g.createRadialGradient(W / 2, H * 0.55, H * 0.45, W / 2, H * 0.55, H * 0.95)
  vig.addColorStop(0, 'rgba(0,0,0,0)')
  vig.addColorStop(1, 'rgba(0,10,0,0.22)')
  g.fillStyle = vig
  g.fillRect(0, 0, W, H)

  return cv
}

function drawStands(g, W, horizonY) {
  // 天空
  const sky = g.createLinearGradient(0, 0, 0, horizonY)
  sky.addColorStop(0, '#9ecdec')
  sky.addColorStop(1, '#d6ecf8')
  g.fillStyle = sky
  g.fillRect(0, 0, W, horizonY)

  // 頂棚
  g.fillStyle = '#27303f'
  g.fillRect(0, 0, W, horizonY * 0.16)
  g.fillStyle = 'rgba(255,255,255,0.12)'
  g.fillRect(0, horizonY * 0.15, W, 2)

  // 看台兩層
  const tierTop = horizonY * 0.16
  const mid = horizonY * 0.6
  g.fillStyle = '#37425a'
  g.fillRect(0, tierTop, W, mid - tierTop)
  g.fillStyle = '#43506b'
  g.fillRect(0, mid, W, horizonY - mid)
  g.fillStyle = 'rgba(255,255,255,0.18)'
  g.fillRect(0, mid - 1, W, 2)

  // 群眾（隨機色點，下層較大較密）
  const palette = ['#d9c8b1', '#c75d4f', '#5d7fb3', '#dadada', '#caa64f', '#6da06b', '#8d6fae', '#3f3f3f']
  const n = Math.min(2600, W * 4)
  for (let i = 0; i < n; i++) {
    const lower = Math.random() < 0.55
    const y = lower ? mid + Math.random() * (horizonY - mid) : tierTop + Math.random() * (mid - tierTop)
    const size = (lower ? 1.6 : 1.1) + Math.random() * 1.2
    g.fillStyle = palette[(Math.random() * palette.length) | 0]
    g.globalAlpha = 0.75 + Math.random() * 0.25
    g.fillRect(Math.random() * W, y, size, size * 1.25)
  }
  g.globalAlpha = 1
  // 看台前緣牆
  g.fillStyle = '#2f3a50'
  g.fillRect(0, horizonY - 4, W, 4)
}

function drawHoardings(g, cam) {
  const zB = 13.4
  const a = cam.project(-10.5, 0, zB)
  const b = cam.project(10.5, 0, zB)
  const top = cam.project(-10.5, 0.95, zB)
  g.fillStyle = '#e8edf2'
  g.fillRect(a.x, top.y, b.x - a.x, a.y - top.y)
  // 簡化廣告色塊
  const seg = (b.x - a.x) / 8
  const cols = ['#3a6fb0', '#c0392b', '#2e8b57', '#444c5c']
  for (let i = 0; i < 8; i++) {
    g.fillStyle = cols[i % cols.length]
    g.globalAlpha = 0.8
    g.fillRect(a.x + i * seg + seg * 0.18, top.y + (a.y - top.y) * 0.3, seg * 0.62, (a.y - top.y) * 0.42)
  }
  g.globalAlpha = 1
  g.fillStyle = 'rgba(0,0,0,0.18)'
  g.fillRect(a.x, a.y - 2, b.x - a.x, 2)
}

// ---------- 網子（背網節點 + 阻尼彈簧，進球時凸起晃動） ----------
export function makeNet() {
  const NX = 13
  const NY = 7
  const d = new Float32Array(NX * NY) // 沿 +z 位移
  const dv = new Float32Array(NX * NY)
  const zBack = (y) => GOAL.z + 1.5 - (y / GOAL.height) * 0.95 // 底部外斜、頂部近橫楣

  return {
    NX,
    NY,
    zBack,
    node(i, j) {
      const x = -GOAL.halfW + (2 * GOAL.halfW * i) / (NX - 1)
      const y = (GOAL.height * j) / (NY - 1)
      return [x, y, zBack(y) + d[j * NX + i]]
    },
    impact(ix, iy, f) {
      for (let j = 0; j < NY; j++) {
        for (let i = 0; i < NX; i++) {
          const x = -GOAL.halfW + (2 * GOAL.halfW * i) / (NX - 1)
          const y = (GOAL.height * j) / (NY - 1)
          const dx = x - ix
          const dy = y - iy
          d[j * NX + i] += f * Math.exp(-(dx * dx + dy * dy) / 0.3)
        }
      }
    },
    update(dt) {
      for (let n = 0; n < d.length; n++) {
        dv[n] += (-70 * d[n] - 7 * dv[n]) * dt
        d[n] += dv[n] * dt
      }
    },
  }
}

export function drawGoalAndNet(ctx, cam, net) {
  const P = (x, y, z) => cam.project(x, y, z)

  // ----- 背網網格 -----
  ctx.strokeStyle = 'rgba(246,249,251,0.55)'
  ctx.lineWidth = 1
  for (let j = 0; j < net.NY; j++) {
    ctx.beginPath()
    for (let i = 0; i < net.NX; i++) {
      const [x, y, z] = net.node(i, j)
      const p = P(x, y, z)
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
    }
    ctx.stroke()
  }
  for (let i = 0; i < net.NX; i++) {
    ctx.beginPath()
    for (let j = 0; j < net.NY; j++) {
      const [x, y, z] = net.node(i, j)
      const p = P(x, y, z)
      j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
    }
    ctx.stroke()
  }

  // ----- 側網 / 頂網（簡化線） -----
  ctx.strokeStyle = 'rgba(246,249,251,0.4)'
  for (const sx of [-GOAL.halfW, GOAL.halfW]) {
    const i = sx < 0 ? 0 : net.NX - 1
    for (let j = 0; j < net.NY; j++) {
      const y = (GOAL.height * j) / (net.NY - 1)
      const a = P(sx, y, GOAL.z)
      const [bx, by, bz] = net.node(i, j)
      const b = P(bx, by, bz)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
  }
  for (let i = 0; i < net.NX; i += 2) {
    const x = -GOAL.halfW + (2 * GOAL.halfW * i) / (net.NX - 1)
    const a = P(x, GOAL.height, GOAL.z)
    const [bx, by, bz] = net.node(i, net.NY - 1)
    const b = P(bx, by, bz)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }

  // ----- 門柱 / 橫楣（最後畫，蓋在網子之上） -----
  const s11 = cam.scale(GOAL.z)
  const lw = Math.max(3, GOAL.postR * 2 * cam.K * s11)
  const post = (x1, y1, x2, y2) => {
    const a = P(x1, y1, GOAL.z)
    const b = P(x2, y2, GOAL.z)
    // 主體
    ctx.strokeStyle = '#f4f6f7'
    ctx.lineWidth = lw
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    // 右側陰影邊，做出圓柱感
    ctx.strokeStyle = 'rgba(120,130,140,0.55)'
    ctx.lineWidth = Math.max(1, lw * 0.28)
    ctx.beginPath()
    ctx.moveTo(a.x + lw * 0.28, a.y)
    ctx.lineTo(b.x + lw * 0.28, b.y)
    ctx.stroke()
  }
  post(-GOAL.halfW, 0, -GOAL.halfW, GOAL.height)
  post(GOAL.halfW, 0, GOAL.halfW, GOAL.height)
  post(-GOAL.halfW, GOAL.height, GOAL.halfW, GOAL.height)
}

// ---------- 九宮格 ----------
// 格子編號：0..8，左上為 0、右下為 8（世界座標：col0 = 射手視角左側）。
const COLS = [-GOAL.halfW, -1.22, 1.22, GOAL.halfW]
const ROWS = [GOAL.height, 1.627, 0.813, 0] // row0 = 上排

export function zoneCenter(i) {
  const col = i % 3
  const row = (i / 3) | 0
  return { x: (COLS[col] + COLS[col + 1]) / 2, y: (ROWS[row] + ROWS[row + 1]) / 2 }
}

export function zoneOf(x, y) {
  if (Math.abs(x) > GOAL.halfW || y < 0 || y > GOAL.height) return -1
  const col = x < -1.22 ? 0 : x > 1.22 ? 2 : 1
  const row = y > 1.627 ? 0 : y > 0.813 ? 1 : 2
  return row * 3 + col
}

// 射手視角的九宮格（畫在球門平面 z = GOAL.z）
export function drawGridFwd(ctx, cam, selected, alpha = 0.5) {
  const P = (x, y) => cam.project(x, y, GOAL.z)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'
  ctx.lineWidth = 1.5
  for (const x of [-1.22, 1.22]) {
    const a = P(x, 0)
    const b = P(x, GOAL.height)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  for (const y of [0.813, 1.627]) {
    const a = P(-GOAL.halfW, y)
    const b = P(GOAL.halfW, y)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  if (selected >= 0) {
    const col = selected % 3
    const row = (selected / 3) | 0
    const corners = [
      P(COLS[col], ROWS[row]),
      P(COLS[col + 1], ROWS[row]),
      P(COLS[col + 1], ROWS[row + 1]),
      P(COLS[col], ROWS[row + 1]),
    ]
    ctx.fillStyle = 'rgba(255,211,61,0.32)'
    ctx.strokeStyle = 'rgba(255,211,61,0.95)'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

// ---------- 門將視角（反向：站在門裡看射手） ----------
// 眼高模型：視線高度 eye（站姿門將），與眼同高的點落在地平線，
// 近物向下散開、來球「迎面放大」才符合第一人稱直覺。
// 橫向 / 縱向各自縮放（球門 3:1 太扁，縱向放大才好點選）。
// z 自球門線 (0) 朝罰球點 (11)。世界 +x 在畫面左側（鏡像）。
export function makeRevView(W, H) {
  const c = 2.5
  const eye = 1.65 // 門將視線高度 (m)
  const Kx = (W * 0.88) / (GOAL.halfW * 2)
  const Ky = (H * 0.36) / GOAL.height // 球門佔畫面高 36%
  const baseY = H * 0.64 // 球門線地面
  const horizonY = baseY - eye * Ky
  const goalTop = horizonY - (GOAL.height - eye) * Ky
  const s = (z) => c / (c + z)
  const groundY = (z) => horizonY + eye * Ky * s(z)
  return {
    W,
    H,
    horizonY,
    goalTop,
    baseY,
    Kx,
    Ky,
    eye,
    s,
    groundY,
    project(x, y, z) {
      const k = s(z)
      return { x: W / 2 - x * Kx * k, y: horizonY + (eye - y) * Ky * k, s: k }
    },
    unprojectGoal(sx, sy) {
      return { x: (W / 2 - sx) / Kx, y: eye - (sy - horizonY) / Ky }
    },
  }
}

export function renderBackgroundRev(view, dpr) {
  const { W, H, horizonY, baseY, groundY } = view
  const cv = document.createElement('canvas')
  cv.width = Math.round(W * dpr)
  cv.height = Math.round(H * dpr)
  const g = cv.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, 0, 0)

  // 遠端看台（罰球點後方）
  drawStands(g, W, horizonY)

  // 草皮條紋（由遠到近：z 大 → 小）
  const Z_MIN = -2.2
  for (let i = 0; ; i++) {
    const zFar = 30 - i * 2.4
    if (zFar <= Z_MIN) break
    const zNear = Math.max(zFar - 2.4, Z_MIN)
    const yTop = i === 0 ? horizonY : groundY(zFar)
    const yBot = Math.min(H + 2, groundY(zNear))
    g.fillStyle = i % 2 === 0 ? '#3f9b4b' : '#379145'
    g.fillRect(0, yTop - 0.5, W, yBot - yTop + 1)
  }

  // 白線：球門線（腳下）、小禁區、罰球點
  const line = (x1, z1, x2, z2) => {
    const a = view.project(x1, 0, z1)
    const b = view.project(x2, 0, z2)
    g.strokeStyle = 'rgba(250,250,248,0.9)'
    g.lineWidth = Math.max(1.5, 0.09 * view.Kx * ((a.s + b.s) / 2))
    g.beginPath()
    g.moveTo(a.x, a.y)
    g.lineTo(b.x, b.y)
    g.stroke()
  }
  line(-11, 0, 11, 0)
  line(-9.16, 0, -9.16, 5.5)
  line(9.16, 0, 9.16, 5.5)
  line(-9.16, 5.5, 9.16, 5.5)
  const spot = view.project(0, 0, 11)
  g.fillStyle = 'rgba(250,250,248,0.95)'
  g.beginPath()
  g.ellipse(spot.x, spot.y, 0.16 * view.Kx * spot.s * 2.2, 0.05 * view.Ky * spot.s * 2.2, 0, 0, Math.PI * 2)
  g.fill()

  // 門內地面（球門線之後到畫面底）壓暗一點
  const inner = g.createLinearGradient(0, baseY, 0, H)
  inner.addColorStop(0, 'rgba(0,20,0,0.18)')
  inner.addColorStop(1, 'rgba(0,20,0,0.32)')
  g.fillStyle = inner
  g.fillRect(0, baseY, W, H - baseY)

  // vignette
  const vig = g.createRadialGradient(W / 2, H * 0.5, H * 0.4, W / 2, H * 0.5, H * 0.95)
  vig.addColorStop(0, 'rgba(0,0,0,0)')
  vig.addColorStop(1, 'rgba(0,10,0,0.25)')
  g.fillStyle = vig
  g.fillRect(0, 0, W, H)

  return cv
}

export function drawGoalFrameRev(ctx, view) {
  const { W } = view
  const xL = view.project(GOAL.halfW, 0, 0).x // 世界 +x → 畫面左
  const xR = view.project(-GOAL.halfW, 0, 0).x
  const yT = view.goalTop
  const yB = view.baseY
  const lw = Math.max(6, W * 0.022)
  ctx.lineCap = 'round'
  // 主體
  ctx.strokeStyle = '#f4f6f7'
  ctx.lineWidth = lw
  ctx.beginPath()
  ctx.moveTo(xL, yB + lw)
  ctx.lineTo(xL, yT)
  ctx.lineTo(xR, yT)
  ctx.lineTo(xR, yB + lw)
  ctx.stroke()
  // 內側陰影做圓柱感
  ctx.strokeStyle = 'rgba(120,130,140,0.5)'
  ctx.lineWidth = lw * 0.3
  ctx.beginPath()
  ctx.moveTo(xL + lw * 0.3, yB + lw)
  ctx.lineTo(xL + lw * 0.3, yT + lw * 0.3)
  ctx.lineTo(xR - lw * 0.3, yT + lw * 0.3)
  ctx.lineTo(xR - lw * 0.3, yB + lw)
  ctx.stroke()
}

export function drawGridRev(ctx, view, selected, alpha = 0.55) {
  const P = (x, y) => view.project(x, y, 0)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'
  ctx.lineWidth = 2
  for (const x of [-1.22, 1.22]) {
    const a = P(x, 0)
    const b = P(x, GOAL.height)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  for (const y of [0.813, 1.627]) {
    const a = P(-GOAL.halfW, y)
    const b = P(GOAL.halfW, y)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  if (selected >= 0) {
    const col = selected % 3
    const row = (selected / 3) | 0
    const a = P(COLS[col], ROWS[row])
    const b = P(COLS[col + 1], ROWS[row + 1])
    ctx.fillStyle = 'rgba(255,211,61,0.3)'
    ctx.strokeStyle = 'rgba(255,211,61,0.95)'
    ctx.lineWidth = 3
    const x0 = Math.min(a.x, b.x)
    const y0 = Math.min(a.y, b.y)
    ctx.fillRect(x0, y0, Math.abs(b.x - a.x), Math.abs(b.y - a.y))
    ctx.strokeRect(x0, y0, Math.abs(b.x - a.x), Math.abs(b.y - a.y))
  }
  ctx.restore()
}

// 射手（門將視角，站在罰球點後）。st: { phase: 'wait'|'run'|'kick', t }
export function drawStriker(ctx, view, st, time) {
  // 助跑路徑：右腳射手自畫面側邊斜進
  let wx = -1.0
  let wz = 13.0
  if (st.phase === 'run') {
    const tt = st.t
    wx = -1.0 + 0.85 * tt
    wz = 13.0 - 1.75 * tt
  } else if (st.phase === 'kick') {
    wx = -0.15
    wz = 11.25
  }
  const p = view.project(wx, 0, wz)
  const u = view.Ky * p.s * 1.45 // 縱向尺度 + 體型補正
  ctx.save()
  ctx.translate(p.x, p.y)

  // 影子
  ctx.fillStyle = 'rgba(0,0,0,0.28)'
  ctx.beginPath()
  ctx.ellipse(0, 0, 0.5 * u, 0.12 * u, 0, 0, Math.PI * 2)
  ctx.fill()

  const M = (mx, my) => [mx * u, -my * u]
  const limb = (x1, y1, x2, y2, w, color) => {
    const [ax, ay] = M(x1, y1)
    const [bx, by] = M(x2, y2)
    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(1.5, w * u)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.stroke()
  }
  const jersey = '#c0392b'
  const shorts = '#fff'
  const skin = '#e3b98e'

  let lean = 0
  let legSwing = 0
  if (st.phase === 'wait') lean = Math.sin(time * 1.8) * 0.04
  else if (st.phase === 'run') legSwing = Math.sin(st.t * 22) * 0.4
  else if (st.phase === 'kick') {
    lean = -0.25
    legSwing = -0.9 + Math.min(1, st.t * 6) * 1.8 // 後擺 → 前掃
  }
  ctx.rotate(lean)

  // 腿
  limb(-0.1, 0.92, -0.16 + legSwing * 0.25, 0.45, 0.15, shorts)
  limb(-0.16 + legSwing * 0.25, 0.45, -0.2 + legSwing * 0.55, 0.06, 0.12, skin)
  limb(0.1, 0.92, 0.16 - legSwing * 0.25, 0.45, 0.15, shorts)
  limb(0.16 - legSwing * 0.25, 0.45, 0.2 - legSwing * 0.55, 0.06, 0.12, skin)
  // 軀幹
  limb(0, 1.0, 0, 1.38, 0.42, jersey)
  // 手臂
  limb(-0.22, 1.32, -0.4 - legSwing * 0.15, 1.05, 0.11, skin)
  limb(0.22, 1.32, 0.4 + legSwing * 0.15, 1.05, 0.11, skin)
  // 頭
  const [hx, hy] = M(0, 1.6)
  ctx.fillStyle = skin
  ctx.beginPath()
  ctx.arc(hx, hy, 0.14 * u, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#2c2118'
  ctx.beginPath()
  ctx.arc(hx, hy - 0.03 * u, 0.14 * u, Math.PI * 1.05, Math.PI * 1.95)
  ctx.fill()

  ctx.restore()
}

// 玩家撲救手套（門將視角，從畫面下方撲向選定格子）。dive: { t, zone }
export function drawGloves(ctx, view, dive) {
  const tt = 1 - Math.pow(1 - Math.min(1, dive.t), 2.2)
  const zc = zoneCenter(dive.zone)
  const target = view.project(zc.x, zc.y, 0)
  const sx = view.W / 2
  const sy = view.H * 1.08
  const gx = sx + (target.x - sx) * tt
  const gy = sy + (target.y - sy) * tt
  const r = view.W * 0.055
  const spread = r * 1.5
  const ang = Math.atan2(target.y - sy, target.x - sx)

  ctx.save()
  // 前臂
  ctx.strokeStyle = '#1f8a8a'
  ctx.lineWidth = r * 0.95
  ctx.lineCap = 'round'
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(sx + side * spread * 1.4, view.H + r)
    ctx.lineTo(gx + side * spread * Math.abs(Math.sin(ang)), gy + side * spread * 0.4 * Math.cos(ang))
    ctx.stroke()
  }
  // 手套
  for (const side of [-1, 1]) {
    const hx = gx + side * spread * Math.abs(Math.sin(ang))
    const hy = gy + side * spread * 0.4 * Math.cos(ang)
    ctx.fillStyle = '#f4f4f4'
    ctx.beginPath()
    ctx.arc(hx, hy, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'
    ctx.lineWidth = 2
    ctx.stroke()
  }
  ctx.restore()
}

// ---------- 門將 ----------
// kp: { x, z, color, pose: 'idle' | 'dive', t, targetX, targetY }
export function drawKeeper(ctx, cam, kp, time) {
  const root = cam.project(kp.x, 0, kp.z)
  const u = cam.K * root.s // px / m
  ctx.save()
  ctx.translate(root.x, root.y)

  let lean = 0
  let dx = 0
  let dy = 0
  const dive = kp.pose === 'dive'
  const dir = dive ? Math.sign(kp.targetX - kp.x || 0.001) : 0
  if (dive) {
    const tt = 1 - Math.pow(1 - Math.min(1, kp.t), 2) // easeOut
    dx = (kp.targetX - kp.x) * 0.72 * tt
    dy = Math.sin(Math.min(1, kp.t) * Math.PI) * Math.max(0.12, Math.min(1, kp.targetY * 0.5))
    lean = dir * 1.15 * tt
  } else {
    lean = Math.sin(time * 2.2) * 0.045 // 待機微晃
  }

  // 影子
  ctx.fillStyle = 'rgba(0,0,0,0.28)'
  ctx.beginPath()
  ctx.ellipse(dx * u, -2, 0.55 * u, 0.13 * u, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.translate(dx * u, -dy * u)
  ctx.rotate(lean)

  const M = (mx, my) => [mx * u, -my * u]
  const limb = (x1, y1, x2, y2, w, color) => {
    const [ax, ay] = M(x1, y1)
    const [bx, by] = M(x2, y2)
    ctx.strokeStyle = color
    ctx.lineWidth = w * u
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.stroke()
  }
  const skin = '#e3b98e'
  const shorts = '#20242b'
  const sock = '#1f1f1f'

  // 站姿 / 撲救姿勢端點
  let leg1, leg2, arm1, arm2
  if (!dive) {
    const k = Math.sin(time * 2.2) * 0.02
    leg1 = [
      [-0.12, 0.92, -0.18, 0.46],
      [-0.18, 0.46, -0.22, 0.05],
    ]
    leg2 = [
      [0.12, 0.92, 0.18, 0.46],
      [0.18, 0.46, 0.22, 0.05],
    ]
    arm1 = [
      [-0.24, 1.34, -0.44, 1.12 + k],
      [-0.44, 1.12 + k, -0.52, 0.94 + k],
    ]
    arm2 = [
      [0.24, 1.34, 0.44, 1.12 - k],
      [0.44, 1.12 - k, 0.52, 0.94 - k],
    ]
  } else {
    // 雙手伸向撲救方向、雙腿後曳
    leg1 = [
      [-0.05, 0.92, -dir * 0.3, 0.5],
      [-dir * 0.3, 0.5, -dir * 0.55, 0.18],
    ]
    leg2 = [
      [0.08, 0.92, -dir * 0.12, 0.42],
      [-dir * 0.12, 0.42, -dir * 0.38, 0.08],
    ]
    arm1 = [
      [dir * 0.18, 1.36, dir * 0.55, 1.62],
      [dir * 0.55, 1.62, dir * 0.88, 1.82],
    ]
    arm2 = [
      [dir * 0.22, 1.28, dir * 0.5, 1.45],
      [dir * 0.5, 1.45, dir * 0.78, 1.58],
    ]
  }

  // 遠側手腳 → 軀幹 → 近側手腳 → 頭（畫家順序）
  limb(...leg1[0], 0.15, shorts)
  limb(...leg1[1], 0.12, sock)
  limb(...arm1[0], 0.12, kp.color)
  limb(...arm1[1], 0.1, skin)

  // 軀幹（球衣）
  limb(0, 1.0, 0, 1.38, 0.42, kp.color)
  // 短褲
  limb(0, 0.88, 0, 1.02, 0.4, shorts)

  limb(...leg2[0], 0.15, shorts)
  limb(...leg2[1], 0.12, sock)
  limb(...arm2[0], 0.12, kp.color)
  limb(...arm2[1], 0.1, skin)

  // 手套
  ctx.fillStyle = '#f2f2f2'
  for (const arm of [arm1, arm2]) {
    const [gx, gy] = M(arm[1][2], arm[1][3])
    ctx.beginPath()
    ctx.arc(gx, gy, 0.085 * u, 0, Math.PI * 2)
    ctx.fill()
  }

  // 頭 + 髮
  const [hx, hy] = M(0, 1.62)
  ctx.fillStyle = skin
  ctx.beginPath()
  ctx.arc(hx, hy, 0.14 * u, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#2c2118'
  ctx.beginPath()
  ctx.arc(hx, hy - 0.03 * u, 0.14 * u, Math.PI * 1.05, Math.PI * 1.95)
  ctx.fill()

  ctx.restore()
}
