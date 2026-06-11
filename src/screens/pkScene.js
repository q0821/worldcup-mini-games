// PK 場景：透視投影 + 球場 / 球門 / 網子 / 門將繪製（寫實風、純 Canvas 程序繪製）。
// 世界座標（公尺）：x 向右、y 向上、z 自罰球點 (0) 朝球門 (GOAL.z)。
// 尺寸採真實規格：球門 7.32 × 2.44 m、罰球距離 11 m、足球半徑 0.11 m。

export const GOAL = { halfW: 3.66, height: 2.44, z: 11, postR: 0.06 }
export const BALL_R = 0.11

// 接觸影（人物 / 球共用準則，見 docs/ball-realism.md）：
// 越高 → 越大、越模糊、越淡；貼地 → 小而銳利深色。
// (x, y) 影子中心（目前變換座標系）、r 貼地時的半徑、hN 高度因子 0~1。
function drawContactShadow(ctx, x, y, r, hN, aspect = 0.26) {
  ctx.save()
  if (ctx.filter !== undefined) ctx.filter = `blur(${(1 + hN * 8).toFixed(1)}px)`
  ctx.globalAlpha *= 0.34 * (1 - hN * 0.7) // 乘上目前 alpha（保留呼叫端的淡出）
  ctx.fillStyle = '#000'
  ctx.beginPath()
  const rr = r * (0.95 + hN * 0.95)
  ctx.ellipse(x, y, rr, rr * aspect, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

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
function drawStadium(g, img, W, H, horizonY, cutRatio = 0.53) {
  const cut = img.height * cutRatio
  g.drawImage(img, 0, 0, img.width, cut, 0, 0, W, Math.max(1, horizonY)) // 看台段
  g.drawImage(img, 0, cut, img.width, img.height - cut, 0, horizonY, W, Math.max(1, H - horizonY)) // 草地段
}

export function renderBackground(cam, dpr, stadiumImg = null, stadiumCut = 0.495) {
  const { W, H, horizonY, groundY } = cam
  const cv = document.createElement('canvas')
  cv.width = Math.round(W * dpr)
  cv.height = Math.round(H * dpr)
  const g = cv.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, 0, 0)

  if (stadiumImg) {
    drawStadium(g, stadiumImg, W, H, horizonY, stadiumCut)
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
      g.fillStyle = i % 2 === 0 ? '#2c6e38' : '#256231'
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
    line(-9.16, GOAL.z, -9.16, GOAL.z - 5.5)
    line(9.16, GOAL.z, 9.16, GOAL.z - 5.5)
    line(-9.16, GOAL.z - 5.5, 9.16, GOAL.z - 5.5)
  }

  // 球門線：不論有無背景圖都畫，定錨球門位置（淡、窄，融入草地）
  {
    const a = cam.project(-7.5, 0, GOAL.z)
    const b = cam.project(7.5, 0, GOAL.z)
    g.strokeStyle = 'rgba(250,250,248,0.5)'
    g.lineWidth = Math.max(1.5, 0.055 * cam.K * a.s)
    g.beginPath()
    g.moveTo(a.x, a.y)
    g.lineTo(b.x, b.y)
    g.stroke()
  }

  // 罰球點（小而淡，避免搶過足球本體）
  {
    const p = cam.project(0, 0, 0)
    g.fillStyle = 'rgba(250,250,248,0.4)'
    g.beginPath()
    g.ellipse(p.x, p.y, Math.max(3, 0.06 * cam.K * p.s), Math.max(1.5, 0.022 * cam.K * p.s), 0, 0, Math.PI * 2)
    g.fill()
  }

  // 角落 vignette（夜間更深）
  const vig = g.createRadialGradient(W / 2, H * 0.55, H * 0.45, W / 2, H * 0.55, H * 0.95)
  vig.addColorStop(0, 'rgba(0,0,0,0)')
  vig.addColorStop(1, 'rgba(2,8,4,0.3)')
  g.fillStyle = vig
  g.fillRect(0, 0, W, H)

  return cv
}

function drawStands(g, W, horizonY) {
  // 夜空
  const sky = g.createLinearGradient(0, 0, 0, horizonY)
  sky.addColorStop(0, '#060b18')
  sky.addColorStop(1, '#101b30')
  g.fillStyle = sky
  g.fillRect(0, 0, W, horizonY)

  // 頂棚
  g.fillStyle = '#0c1422'
  g.fillRect(0, 0, W, horizonY * 0.16)

  // 泛光燈帶（頂棚下緣一排光暈）
  const lampY = horizonY * 0.155
  for (let i = 0; i < 7; i++) {
    const lx = W * (0.08 + (i * 0.84) / 6)
    const glow = g.createRadialGradient(lx, lampY, 0, lx, lampY, W * 0.09)
    glow.addColorStop(0, 'rgba(235,245,255,0.9)')
    glow.addColorStop(0.25, 'rgba(190,215,245,0.35)')
    glow.addColorStop(1, 'rgba(160,190,230,0)')
    g.fillStyle = glow
    g.fillRect(lx - W * 0.09, lampY - W * 0.09, W * 0.18, W * 0.18)
  }

  // 看台兩層（夜間深藍）
  const tierTop = horizonY * 0.16
  const mid = horizonY * 0.6
  g.fillStyle = '#1a2740'
  g.fillRect(0, tierTop, W, mid - tierTop)
  g.fillStyle = '#22314e'
  g.fillRect(0, mid, W, horizonY - mid)
  g.fillStyle = 'rgba(180,200,235,0.16)'
  g.fillRect(0, mid - 1, W, 2)

  // 觀眾雜訊點（夜間人海）
  for (let i = 0; i < W * 1.6; i++) {
    const x = Math.random() * W
    const y = tierTop + Math.random() * (horizonY - tierTop)
    g.fillStyle = `rgba(${180 + Math.random() * 70}, ${180 + Math.random() * 60}, ${190 + Math.random() * 60}, ${
      0.12 + Math.random() * 0.3
    })`
    g.fillRect(x, y, 1.4, 1.8)
  }

  // 看台前緣牆
  g.fillStyle = '#13203a'
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
  // 夜間 LED 看板：深底 + 發光色塊
  g.fillStyle = '#0c1626'
  g.fillRect(a.x, top.y, b.x - a.x, a.y - top.y)
  const seg = (b.x - a.x) / 8
  const cols = ['#3f8ef0', '#f0533f', '#2ecc71', '#f4c20d']
  for (let i = 0; i < 8; i++) {
    g.fillStyle = cols[i % cols.length]
    g.globalAlpha = 0.9
    g.fillRect(a.x + i * seg + seg * 0.14, top.y + (a.y - top.y) * 0.22, seg * 0.7, (a.y - top.y) * 0.56)
  }
  g.globalAlpha = 1
  g.fillStyle = 'rgba(0,0,0,0.3)'
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
  // 視覺垂墜：與門後視角同一公式（頂緣繃緊、底部中央最鬆）
  const sag = (i, j) => {
    const span = Math.sin(Math.PI * (i / (net.NX - 1)))
    const loose = 1 - j / (net.NY - 1)
    return span * (0.03 + 0.13 * loose)
  }
  const NP = (i, j) => {
    const [x, y, z] = net.node(i, j)
    return P(x, Math.max(0, y - sag(i, j)), z)
  }

  // ----- 背網網格 -----
  // 透明度壓低：球門頂端落在深色看台前時，密集網線才不會混成一塊灰面板
  ctx.strokeStyle = 'rgba(248,250,252,0.3)'
  ctx.lineWidth = 1
  for (let j = 0; j < net.NY; j++) {
    ctx.beginPath()
    for (let i = 0; i < net.NX; i++) {
      const p = NP(i, j)
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
    }
    ctx.stroke()
  }
  for (let i = 0; i < net.NX; i++) {
    ctx.beginPath()
    for (let j = 0; j < net.NY; j++) {
      const p = NP(i, j)
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

  // ----- 門柱 / 橫楣（最後畫，蓋在網子之上；圓柱漸層 + 落地陰影） -----
  const s11 = cam.scale(GOAL.z)
  const lw = Math.max(3.5, GOAL.postR * 2.3 * cam.K * s11)

  // 門柱落地陰影
  ctx.fillStyle = 'rgba(0,0,0,0.32)'
  for (const gx of [-GOAL.halfW, GOAL.halfW]) {
    const p = P(gx, 0, GOAL.z)
    ctx.beginPath()
    ctx.ellipse(p.x, p.y + 1, lw * 1.2, lw * 0.34, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.lineCap = 'round'
  // 直柱：橫向漸層（左亮右暗 → 圓柱）
  for (const gx of [-GOAL.halfW, GOAL.halfW]) {
    const a = P(gx, 0, GOAL.z)
    const b = P(gx, GOAL.height, GOAL.z)
    const gr = ctx.createLinearGradient(a.x - lw / 2, 0, a.x + lw / 2, 0)
    gr.addColorStop(0, '#9aa3ad')
    gr.addColorStop(0.3, '#fdfdfe')
    gr.addColorStop(0.6, '#edf0f3')
    gr.addColorStop(1, '#828a94')
    ctx.strokeStyle = gr
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  // 橫楣：縱向漸層（上亮下暗）
  {
    const a = P(-GOAL.halfW, GOAL.height, GOAL.z)
    const b = P(GOAL.halfW, GOAL.height, GOAL.z)
    const gr = ctx.createLinearGradient(0, a.y - lw / 2, 0, a.y + lw / 2)
    gr.addColorStop(0, '#fdfdfe')
    gr.addColorStop(0.55, '#e9ecef')
    gr.addColorStop(1, '#7e858f')
    ctx.strokeStyle = gr
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
}

// ---------- 門將視角（球門正後方轉播鏡頭） ----------
// 攝影機架在球門後 D 公尺、高 eye 公尺（略高於 2.44m 橫楣），看向罰球點——
// 世界盃 PK 轉播的經典機位：隔著背網看射手，門框有厚度、門將背影在畫面中央。
// z 自球門線 (0) 朝罰球點 (11)；門後為負 z。世界 +x 在畫面左側（鏡像，與門將同向）。
export function makeRevView(W, H) {
  const D = 4.0 // 攝影機在門後距離 (m)
  const eye = 2.9 // 攝影機高度 (m)，略高於橫楣 → 能越過門頂看到射手
  // 球門（z=0 平面）的螢幕寬度：幾乎滿版，紅圈好點
  const goalW = Math.min(W * 0.94, H * 0.62)
  const Kx = goalW / (GOAL.halfW * 2) // 球門平面 px/m（橫向）
  const Ky = Kx * 1.5 // 縱向略拉伸：紅圈區更高、好點（真實比例太寬扁）
  const s = (z) => D / (D + z) // 透視縮放，s(0)=1
  const baseY = H * 0.66 // 球門線地面的螢幕高度
  const horizonY = baseY - eye * Ky
  const goalTop = horizonY + (eye - GOAL.height) * Ky // 橫楣頂（z=0）
  const groundY = (z) => horizonY + eye * Ky * s(z)
  return {
    W,
    H,
    D,
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

export function renderBackgroundRev(view, dpr, stadiumImg = null, stadiumCut = 0.486) {
  const { W, H, horizonY, baseY, groundY } = view
  const cv = document.createElement('canvas')
  cv.width = Math.round(W * dpr)
  cv.height = Math.round(H * dpr)
  const g = cv.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, 0, 0)

  // 整座球場一張圖（看台 / 草地分段填），否則退回程序看台 + 條紋 + 白線
  if (stadiumImg) {
    drawStadium(g, stadiumImg, W, H, horizonY, stadiumCut)
  } else {
    drawStands(g, W, horizonY)
    const Z_MIN = -2.2
    for (let i = 0; ; i++) {
      const zFar = 30 - i * 2.4
      if (zFar <= Z_MIN) break
      const zNear = Math.max(zFar - 2.4, Z_MIN)
      const yTop = i === 0 ? horizonY : groundY(zFar)
      const yBot = Math.min(H + 2, groundY(zNear))
      g.fillStyle = i % 2 === 0 ? '#2c6e38' : '#256231'
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
    line(-9.16, 0.02, -9.16, 5.5)
    line(9.16, 0.02, 9.16, 5.5)
    line(-9.16, 5.5, 9.16, 5.5)
  }

  // 球門線：不論有無背景圖都畫，定錨球門位置（淡、窄）
  {
    const lw = Math.max(2, 0.07 * view.Kx)
    g.strokeStyle = 'rgba(250,250,248,0.55)'
    g.lineWidth = lw
    g.beginPath()
    g.moveTo(0, baseY)
    g.lineTo(W, baseY)
    g.stroke()
  }

  // 門內地面（球門線之後到畫面底＝門裡）壓暗，做出網內陰影空間
  const inner = g.createLinearGradient(0, baseY, 0, H)
  inner.addColorStop(0, 'rgba(0,14,4,0.2)')
  inner.addColorStop(1, 'rgba(0,10,2,0.45)')
  g.fillStyle = inner
  g.fillRect(0, baseY, W, H - baseY)

  // vignette（夜間更深）
  const vig = g.createRadialGradient(W / 2, H * 0.48, H * 0.38, W / 2, H * 0.48, H * 0.95)
  vig.addColorStop(0, 'rgba(0,0,0,0)')
  vig.addColorStop(1, 'rgba(2,6,14,0.35)')
  g.fillStyle = vig
  g.fillRect(0, 0, W, H)

  return cv
}

// 門框（門後視角）：有厚度的圓柱門柱 + 橫楣，含立體漸層與門線陰影
export function drawGoalFrameRev(ctx, view) {
  const xL = view.project(GOAL.halfW, 0, 0).x // 世界 +x → 畫面左
  const xR = view.project(-GOAL.halfW, 0, 0).x
  const yT = view.goalTop
  const yB = view.baseY
  const lw = Math.max(7, GOAL.postR * 2.6 * view.Kx)

  // 門柱落地陰影
  ctx.fillStyle = 'rgba(0,0,0,0.3)'
  for (const x of [xL, xR]) {
    ctx.beginPath()
    ctx.ellipse(x, yB + 2, lw * 1.1, lw * 0.32, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  const postGrad = (x) => {
    const gr = ctx.createLinearGradient(x - lw / 2, 0, x + lw / 2, 0)
    gr.addColorStop(0, '#9aa3ad')
    gr.addColorStop(0.28, '#fdfdfe')
    gr.addColorStop(0.55, '#eef1f4')
    gr.addColorStop(1, '#878f99')
    return gr
  }
  ctx.lineCap = 'round'
  // 左右門柱（圓柱漸層）
  for (const x of [xL, xR]) {
    ctx.strokeStyle = postGrad(x)
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.moveTo(x, yB + 1)
    ctx.lineTo(x, yT)
    ctx.stroke()
  }
  // 橫楣（上亮下暗）
  const barGrad = ctx.createLinearGradient(0, yT - lw / 2, 0, yT + lw / 2)
  barGrad.addColorStop(0, '#fdfdfe')
  barGrad.addColorStop(0.6, '#e8ebee')
  barGrad.addColorStop(1, '#848c96')
  ctx.strokeStyle = barGrad
  ctx.lineWidth = lw
  ctx.beginPath()
  ctx.moveTo(xL, yT)
  ctx.lineTo(xR, yT)
  ctx.stroke()
}

// 背網（門後視角前景）：攝影機隔著網看球場。網節點沿用 makeNet 的彈簧位移，
// 進球時網面朝鏡頭凸起。座標轉換：rev z = GOAL.z - shooterZ。
// 視覺垂墜（sag）：網布頂緣繃緊、越往下越鬆、中央下垂最多 → 不再是直挺挺的柵欄；
// 側網把「背網投影比門框寬」交代成 3D 籠子。
export function drawNetRev(ctx, view, net) {
  const sag = (i, j) => {
    const span = Math.sin(Math.PI * (i / (net.NX - 1))) // 中央最鬆
    const loose = 1 - j / (net.NY - 1) // 底部最鬆、頂緣繃緊
    return span * (0.03 + 0.13 * loose) // 公尺
  }
  const NP = (i, j) => {
    const [x, y, zs] = net.node(i, j)
    return view.project(x, Math.max(0, y - sag(i, j)), GOAL.z - zs)
  }
  ctx.save()
  ctx.lineWidth = 1.4

  // 側網：門柱（z=0）→ 背網側緣，收住左右兩側
  ctx.strokeStyle = 'rgba(240,246,250,0.24)'
  for (const iEdge of [0, net.NX - 1]) {
    const wx = -GOAL.halfW + (2 * GOAL.halfW * iEdge) / (net.NX - 1)
    for (let j = 0; j < net.NY; j++) {
      const y = (GOAL.height * j) / (net.NY - 1)
      const a = view.project(wx, y, 0)
      const b = NP(iEdge, j)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
  }

  // 橫線（含垂墜）：底部線條較淡（門內陰影），頂緣較亮
  for (let j = 0; j < net.NY; j++) {
    const tone = 0.2 + 0.16 * (j / (net.NY - 1))
    ctx.strokeStyle = `rgba(240,246,250,${tone.toFixed(2)})`
    ctx.beginPath()
    for (let i = 0; i < net.NX; i++) {
      const p = NP(i, j)
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
    }
    ctx.stroke()
  }
  // 直線（隨橫線的垂墜自然彎曲）
  ctx.strokeStyle = 'rgba(240,246,250,0.26)'
  for (let i = 0; i < net.NX; i++) {
    ctx.beginPath()
    for (let j = 0; j < net.NY; j++) {
      const p = NP(i, j)
      j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
    }
    ctx.stroke()
  }
  // 網頂（背網上緣 → 橫楣）的斜拉線，交代「這是門後」的空間關係
  ctx.strokeStyle = 'rgba(240,246,250,0.22)'
  for (let i = 0; i < net.NX; i += 2) {
    const x = -GOAL.halfW + (2 * GOAL.halfW * i) / (net.NX - 1)
    const a = view.project(x, GOAL.height, 0)
    const b = NP(i, net.NY - 1)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
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

  // 影子（貼地 → 小而銳利）
  drawContactShadow(ctx, 0, 0, 0.5 * u, 0, 0.24)

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
  // 軀幹（有肩有腰的球衣）
  {
    const [slx, sly] = M(-0.24, 1.36)
    const [srx, sry] = M(0.24, 1.36)
    const [wrx, wry] = M(0.18, 0.92)
    const [wlx, wly] = M(-0.18, 0.92)
    ctx.fillStyle = jersey
    ctx.beginPath()
    ctx.moveTo(slx, sly)
    ctx.quadraticCurveTo((slx + srx) / 2, sly - 0.05 * u, srx, sry)
    ctx.lineTo(wrx, wry)
    ctx.lineTo(wlx, wly)
    ctx.closePath()
    ctx.fill()
    // 背號
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.font = `700 ${Math.max(6, 0.2 * u)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const [nx, ny] = M(0, 1.14)
    ctx.fillText('10', nx, ny)
  }
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

// 玩家門將（門後視角的背影化身）。
// idle：低重心預備姿勢微晃；dive: { t, sx, sy, hit } → 自門中央朝點擊處整個人撲出，
// 命中紅圈時加拍擊衝擊波；點空則只有小波紋。
export function drawKeeperBack(ctx, view, dive, time) {
  const root = view.project(0, 0, 0.15)
  const u = view.Ky * root.s // 縱向 px/m

  // 撲救進度（easeOutCubic，0.35t 內到位）
  let px = root.x
  let py = root.y
  let ang = 0
  let stretch = 0
  let fade = 1
  if (dive) {
    const fly = Math.min(1, dive.t / 0.35)
    const e = 1 - Math.pow(1 - fly, 3)
    fade = dive.t > 1 ? Math.max(0, 1 - (dive.t - 1) / 0.5) : 1
    // 撲向點擊處：腳留在起點附近、身體朝目標伸展
    px = root.x + (dive.sx - root.x) * e * 0.68
    py = root.y + (dive.sy - root.y) * e * 0.66
    ang = Math.atan2(dive.sy - root.y, dive.sx - root.x)
    stretch = e
  }
  if (fade <= 0) return

  const jersey = '#cdea1f' // 螢光黃門將衣
  const jerseyDark = '#9db514'
  const shorts = '#15181d'
  const skin = '#caa176'
  const glove = '#f4f5f6'

  ctx.save()
  ctx.globalAlpha = fade

  // 影子（撲救飛身時跟著水平位置、隨升高變大變淡變模糊）
  const lift = Math.max(0, (root.y - py) / u) // 垂直升高（公尺）
  drawContactShadow(ctx, px, root.y + u * 0.04, u * 0.46, Math.min(1, lift / 1.0), 0.22)

  const limb = (x1, y1, x2, y2, w, color) => {
    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(2, w * u)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(px + x1 * u, py - y1 * u)
    ctx.lineTo(px + x2 * u, py - y2 * u)
    ctx.stroke()
  }

  if (!dive) {
    // ---- 預備姿勢（背影、低重心、微晃） ----
    const sway = Math.sin(time * 2.4) * 0.025
    const bob = Math.sin(time * 2.4 + 1.3) * 0.015
    // 小腿 / 大腿（張開蹲低）
    limb(-0.3, 0, -0.26, 0.36, 0.13, skin)
    limb(0.3, 0, 0.26, 0.36, 0.13, skin)
    limb(-0.26, 0.36, -0.14, 0.62 + bob, 0.16, shorts)
    limb(0.26, 0.36, 0.14, 0.62 + bob, 0.16, shorts)
    // 軀幹（前傾 → 背影較矮壯）
    ctx.fillStyle = jersey
    ctx.beginPath()
    ctx.moveTo(px - 0.26 * u, py - (0.6 + bob) * u)
    ctx.quadraticCurveTo(px - 0.3 * u, py - (1.06 + bob) * u, px + sway * u - 0.17 * u, py - (1.18 + bob) * u)
    ctx.lineTo(px + sway * u + 0.17 * u, py - (1.18 + bob) * u)
    ctx.quadraticCurveTo(px + 0.3 * u, py - (1.06 + bob) * u, px + 0.26 * u, py - (0.6 + bob) * u)
    ctx.closePath()
    ctx.fill()
    // 背部陰影 + 背號
    ctx.fillStyle = jerseyDark
    ctx.fillRect(px - 0.26 * u, py - (0.72 + bob) * u, 0.52 * u, 0.05 * u)
    ctx.fillStyle = 'rgba(20,24,12,0.85)'
    ctx.font = `700 ${Math.max(8, 0.24 * u)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('1', px + sway * u * 0.5, py - (0.92 + bob) * u)
    // 手臂（張開準備）
    limb(-0.24, 1.05 + bob, -0.46 + sway, 0.78 + bob, 0.11, jersey)
    limb(0.24, 1.05 + bob, 0.46 + sway, 0.78 + bob, 0.11, jersey)
    // 手套
    ctx.fillStyle = glove
    for (const sd of [-1, 1]) {
      ctx.beginPath()
      ctx.arc(px + (sd * 0.46 + sway) * u, py - (0.74 + bob) * u, 0.085 * u, 0, Math.PI * 2)
      ctx.fill()
    }
    // 頭（背影 → 整顆後腦勺都是頭髮，僅露頸部膚色）
    const hy = py - (1.34 + bob) * u
    ctx.fillStyle = skin
    ctx.beginPath()
    ctx.arc(px + sway * u, hy + 0.02 * u, 0.12 * u, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#241a12'
    ctx.beginPath()
    ctx.arc(px + sway * u, hy, 0.13 * u, Math.PI * 0.72, Math.PI * 2.28)
    ctx.fill()
  } else {
    // ---- 撲救（整個人朝點擊處伸展，背影斜飛） ----
    ctx.translate(px, py)
    ctx.rotate(ang + Math.PI / 2) // 身體軸轉向撲救方向
    const L = (x1, y1, x2, y2, w, color) => {
      ctx.strokeStyle = color
      ctx.lineWidth = Math.max(2, w * u)
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(x1 * u, y1 * u)
      ctx.lineTo(x2 * u, y2 * u)
      ctx.stroke()
    }
    const ext = 0.48 + stretch * 0.32 // 伸展比例（上限 0.8，避免橡皮人）
    // 後曳雙腿
    L(-0.1, 0.55 * ext, -0.32, 1.0 * ext, 0.15, shorts)
    L(0.12, 0.55 * ext, 0.28, 1.05 * ext, 0.15, shorts)
    L(-0.32, 1.0 * ext, -0.4, 1.3 * ext, 0.12, skin)
    L(0.28, 1.05 * ext, 0.38, 1.35 * ext, 0.12, skin)
    // 軀幹
    L(0, 0.55 * ext, 0, -0.45 * ext, 0.32, jersey)
    // 雙臂全伸向目標
    L(-0.12, -0.4 * ext, -0.16, -1.0 * ext, 0.11, jersey)
    L(0.12, -0.4 * ext, 0.16, -1.0 * ext, 0.11, jersey)
    // 手套
    ctx.fillStyle = glove
    for (const sd of [-1, 1]) {
      ctx.beginPath()
      ctx.arc(sd * 0.16 * u, -1.06 * ext * u, 0.1 * u, 0, Math.PI * 2)
      ctx.fill()
    }
    // 頭（側傾、背影 → 後腦勺）
    ctx.fillStyle = skin
    ctx.beginPath()
    ctx.arc(0.16 * u, -0.32 * ext * u, 0.12 * u, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#241a12'
    ctx.beginPath()
    ctx.arc(0.16 * u, -0.33 * ext * u, 0.13 * u, Math.PI * 0.72, Math.PI * 2.28)
    ctx.fill()
  }

  ctx.restore()

  // 拍擊回饋：到位後（t > 0.3）自點擊處擴散（以公尺投影，跨裝置比例一致）
  if (dive) {
    const r0 = 0.4 * view.Kx
    const tw = Math.max(0, dive.t - 0.3)
    if (tw > 0) {
      ctx.save()
      if (dive.hit) {
        for (const [mul, lw, a0] of [
          [4.2, 4, 0.85],
          [2.6, 2, 0.55],
        ]) {
          const alpha = a0 * Math.max(0, 1 - tw / 0.8) * fade
          if (alpha <= 0) continue
          ctx.strokeStyle = `rgba(255,255,255,${alpha})`
          ctx.lineWidth = lw
          ctx.beginPath()
          ctx.arc(dive.sx, dive.sy, r0 * (0.7 + tw * mul), 0, Math.PI * 2)
          ctx.stroke()
        }
      } else {
        const alpha = 0.4 * Math.max(0, 1 - tw / 0.6) * fade
        if (alpha > 0) {
          ctx.strokeStyle = `rgba(220,220,220,${alpha})`
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(dive.sx, dive.sy, r0 * (0.5 + tw * 2.2), 0, Math.PI * 2)
          ctx.stroke()
        }
      }
      ctx.restore()
    }
  }
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

  // 影子（撲救躍起時變大變淡變模糊）
  drawContactShadow(ctx, dx * u, -2, 0.55 * u, Math.min(1, dy / 1.0), 0.24)

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

  // 軀幹（有肩有腰的球衣 + 立體陰影），取代單條粗線
  {
    const [slx, sly] = M(-0.26, 1.38)
    const [srx, sry] = M(0.26, 1.38)
    const [wrx, wry] = M(0.2, 0.94)
    const [wlx, wly] = M(-0.2, 0.94)
    ctx.fillStyle = kp.color
    ctx.beginPath()
    ctx.moveTo(slx, sly)
    ctx.quadraticCurveTo((slx + srx) / 2, sly - 0.06 * u, srx, sry)
    ctx.lineTo(wrx, wry)
    ctx.lineTo(wlx, wly)
    ctx.closePath()
    ctx.fill()
    // 側身陰影
    ctx.fillStyle = 'rgba(0,0,0,0.18)'
    ctx.beginPath()
    ctx.moveTo(srx, sry)
    ctx.lineTo(wrx, wry)
    ctx.lineTo(wrx - 0.07 * u, wry)
    ctx.lineTo(srx - 0.07 * u, sry)
    ctx.closePath()
    ctx.fill()
    // 胸前號碼
    ctx.fillStyle = 'rgba(15,18,10,0.8)'
    ctx.font = `700 ${Math.max(7, 0.2 * u)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const [nx, ny] = M(0, 1.16)
    ctx.fillText('1', nx, ny)
  }
  // 短褲
  {
    const [ax, ay] = M(-0.21, 0.97)
    const [bx2] = M(0.21, 0.97)
    const [, cy2] = M(0, 0.76)
    ctx.fillStyle = shorts
    ctx.fillRect(ax, ay, bx2 - ax, cy2 - ay)
  }

  limb(...leg2[0], 0.15, shorts)
  limb(...leg2[1], 0.12, sock)
  limb(...arm2[0], 0.12, kp.color)
  limb(...arm2[1], 0.1, skin)

  // 手套
  ctx.fillStyle = '#f2f2f2'
  for (const arm of [arm1, arm2]) {
    const [gx, gy] = M(arm[1][2], arm[1][3])
    ctx.beginPath()
    ctx.arc(gx, gy, 0.095 * u, 0, Math.PI * 2)
    ctx.fill()
  }

  // 頭 + 髮 + 頸
  const [hx, hy] = M(0, 1.62)
  ctx.strokeStyle = skin
  ctx.lineWidth = 0.1 * u
  ctx.beginPath()
  const [n1x, n1y] = M(0, 1.36)
  ctx.moveTo(n1x, n1y)
  ctx.lineTo(hx, hy + 0.1 * u)
  ctx.stroke()
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
