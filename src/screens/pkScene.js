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
// 整座球場一張圖：在圖的草地線切兩段，看台段拉進地平線以上、草地段拉進以下。
// 接縫落在圖自己的草地線上 → 無縫，且草地線對齊 horizonY 讓 3D 球門站在草地上。
const STADIUM_CUT = 0.42 // 圖中「看台 / 草地」分界的高度比例
function drawStadium(g, img, W, H, horizonY) {
  const cut = img.height * STADIUM_CUT
  g.drawImage(img, 0, 0, img.width, cut, 0, 0, W, Math.max(1, horizonY)) // 看台段
  g.drawImage(img, 0, cut, img.width, img.height - cut, 0, horizonY, W, Math.max(1, H - horizonY)) // 草地段
}

export function renderBackground(cam, dpr, stadiumImg = null) {
  const { W, H, horizonY, groundY } = cam
  const cv = document.createElement('canvas')
  cv.width = Math.round(W * dpr)
  cv.height = Math.round(H * dpr)
  const g = cv.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, 0, 0)

  if (stadiumImg) {
    drawStadium(g, stadiumImg, W, H, horizonY)
  } else {
    // 退回程序繪製：看台 + 割草條紋 + 廣告看板 + 白線
    drawStands(g, W, horizonY)
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
    drawHoardings(g, cam)
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
    line(-11, GOAL.z, 11, GOAL.z)
    line(-9.16, GOAL.z, -9.16, GOAL.z - 5.5)
    line(9.16, GOAL.z, 9.16, GOAL.z - 5.5)
    line(-9.16, GOAL.z - 5.5, 9.16, GOAL.z - 5.5)
  }

  // 角落 vignette
  const vig = g.createRadialGradient(W / 2, H * 0.55, H * 0.45, W / 2, H * 0.55, H * 0.95)
  vig.addColorStop(0, 'rgba(0,0,0,0)')
  vig.addColorStop(1, 'rgba(0,10,0,0.2)')
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

  // 觀眾不在此烤入；改由 makeCrowd / drawCrowd 動態繪製（可歡呼跳動 / 坐下）
  // 看台前緣牆
  g.fillStyle = '#2f3a50'
  g.fillRect(0, horizonY - 4, W, 4)
}

// ---------- 動態觀眾（模糊小色點，進球歡呼跳動、沒進往下坐） ----------
const CROWD_PALETTE = ['#d9c8b1', '#c75d4f', '#5d7fb3', '#dadada', '#caa64f', '#6da06b', '#8d6fae', '#cfcfcf']

// 依看台兩層幾何（與 drawStands 一致）產生觀眾座標。
export function makeCrowd(W, horizonY) {
  const tierTop = horizonY * 0.16
  const mid = horizonY * 0.6
  const list = []
  const n = Math.min(1400, Math.floor(W * 2.2))
  for (let i = 0; i < n; i++) {
    const lower = Math.random() < 0.55
    const y = lower ? mid + Math.random() * (horizonY - mid) : tierTop + Math.random() * (mid - tierTop)
    list.push({
      x: Math.random() * W,
      y,
      size: (lower ? 1.8 : 1.2) + Math.random() * 1.3,
      lower,
      ph: Math.random() * Math.PI * 2,
      col: CROWD_PALETTE[(Math.random() * CROWD_PALETTE.length) | 0],
      a: 0.7 + Math.random() * 0.3,
    })
  }
  return list
}

// 把觀眾畫到指定 ctx（原始小色點；模糊由呼叫端對整批一次套用以省效能）。
// anim: { cheer (0..1 歡呼跳動), sink (0..1 往下坐＝沮喪), time }
export function drawCrowd(ctx, crowd, anim) {
  const dim = 1 - 0.55 * anim.sink // 沮喪時變暗變安靜（露出後方深色看台）
  for (const s of crowd) {
    // 沒進 → 明顯往下癱坐（每個人略不同，更像洩氣）
    let dy = anim.sink * (s.lower ? 15 : 11) * (0.7 + 0.6 * ((s.ph * 13) % 1))
    if (anim.cheer > 0) dy -= Math.abs(Math.sin(anim.time * 9 + s.ph)) * (s.lower ? 8 : 6) * anim.cheer // 歡呼跳動
    ctx.globalAlpha = s.a * dim
    ctx.fillStyle = s.col
    ctx.fillRect(s.x, s.y + dy, s.size, s.size * 1.3)
  }
  ctx.globalAlpha = 1
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
  // 透明度壓低：球門頂端落在深色看台前時，密集網線才不會混成一塊灰面板
  ctx.strokeStyle = 'rgba(248,250,252,0.3)'
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
  ctx.strokeStyle = 'rgba(248,250,252,0.26)'
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

// ---------- 門將視角（反向：站在門裡看射手） ----------
// 眼高模型：視線高度 eye（站姿門將），與眼同高的點落在地平線，
// 近物向下散開、來球「迎面放大」才符合第一人稱直覺。
// 橫向 / 縱向縮放：Ky 只比 Kx 略大，讓球門維持接近真實的寬扁比例（約 2.2:1），
// 不再縱向硬撐成方籠子（先前佔高 44% → 看起來又高又方）。
// z 自球門線 (0) 朝罰球點 (11)。世界 +x 在畫面左側（鏡像）。
export function makeRevView(W, H) {
  const c = 2.5
  const eye = 1.65 // 門將視線高度 (m)
  // 球門螢幕寬度設上限，避免寬螢幕下撐到滿版（像站在門裡）；兩側露出草地
  const goalW = Math.min(W * 0.86, H * 1.15)
  const Kx = goalW / (GOAL.halfW * 2)
  const Ky = Kx * 1.35 // 球門螢幕比例約 2.2:1（寬扁、像真球門）
  const baseY = H * 0.6 // 球門線(近) 的螢幕高度
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

export function renderBackgroundRev(view, dpr, stadiumImg = null) {
  const { W, H, horizonY, baseY, groundY } = view
  const cv = document.createElement('canvas')
  cv.width = Math.round(W * dpr)
  cv.height = Math.round(H * dpr)
  const g = cv.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, 0, 0)

  // 整座球場一張圖（看台 / 草地分段填），否則退回程序看台 + 條紋 + 白線
  if (stadiumImg) {
    drawStadium(g, stadiumImg, W, H, horizonY)
  } else {
    drawStands(g, W, horizonY)
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
  }

  // 門內地面（球門線之後到畫面底）壓暗一點，墊出門前空間
  const inner = g.createLinearGradient(0, baseY, 0, H)
  inner.addColorStop(0, 'rgba(0,20,0,0.14)')
  inner.addColorStop(1, 'rgba(0,20,0,0.28)')
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

// 玩家撲救（門將視角）：不畫手臂——兩隻手套自畫面左右下角快速飛入點擊處，
// 命中紅圈時加拍擊衝擊波；點空則只有小波紋。dive: { t, sx, sy, hit }
export function drawGloves(ctx, view, dive) {
  const { W, H } = view
  const r = W * 0.052
  // 飛入：前 0.35 個 t（約 0.1 秒）完成，easeOutCubic
  const fly = Math.min(1, dive.t / 0.35)
  const e = 1 - Math.pow(1 - fly, 3)
  // 收尾淡出
  const fade = dive.t > 1 ? Math.max(0, 1 - (dive.t - 1) / 0.4) : 1
  if (fade <= 0) return

  ctx.save()
  ctx.globalAlpha = fade

  // 兩隻手套：左手自左下角、右手自右下角入鏡，併攏在點擊處兩側
  for (const side of [-1, 1]) {
    const fromX = side < 0 ? -r : W + r
    const fromY = H + r * 1.5
    const toX = dive.sx + side * r * 0.95
    const toY = dive.sy + (side < 0 ? -r * 0.18 : r * 0.18) // 微錯位更自然
    const hx = fromX + (toX - fromX) * e
    const hy = fromY + (toY - fromY) * e
    const rot = side * (0.5 - 0.5 * e) // 飛行中略斜，到位時擺正

    ctx.save()
    ctx.translate(hx, hy)
    ctx.rotate(rot)
    // 掌
    ctx.fillStyle = '#f4f4f4'
    ctx.beginPath()
    ctx.ellipse(0, 0, r * 0.78, r, side * 0.25, 0, Math.PI * 2)
    ctx.fill()
    // 拇指
    ctx.beginPath()
    ctx.ellipse(side * r * 0.62, r * 0.3, r * 0.3, r * 0.42, side * 0.7, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.22)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.ellipse(0, 0, r * 0.78, r, side * 0.25, 0, Math.PI * 2)
    ctx.stroke()
    // 掌心縫線
    ctx.strokeStyle = 'rgba(0,0,0,0.15)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(-r * 0.3, -r * 0.45)
    ctx.lineTo(-r * 0.3, r * 0.45)
    ctx.stroke()
    ctx.restore()
  }

  // 拍擊回饋：手套到位後（t > 0.3）從點擊處擴散
  const tw = Math.max(0, dive.t - 0.3)
  if (tw > 0) {
    if (dive.hit) {
      // 命中：雙層白色衝擊波
      for (const [mul, lw, a0] of [
        [4.2, 4, 0.85],
        [2.6, 2, 0.55],
      ]) {
        const alpha = a0 * Math.max(0, 1 - tw / 0.8) * fade
        if (alpha <= 0) continue
        ctx.strokeStyle = `rgba(255,255,255,${alpha})`
        ctx.lineWidth = lw
        ctx.beginPath()
        ctx.arc(dive.sx, dive.sy, r * (0.7 + tw * mul), 0, Math.PI * 2)
        ctx.stroke()
      }
    } else {
      // 拍空：單層灰白小波紋
      const alpha = 0.4 * Math.max(0, 1 - tw / 0.6) * fade
      if (alpha > 0) {
        ctx.strokeStyle = `rgba(220,220,220,${alpha})`
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(dive.sx, dive.sy, r * (0.5 + tw * 2.2), 0, Math.PI * 2)
        ctx.stroke()
      }
    }
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
