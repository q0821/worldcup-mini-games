import { t } from '../core/i18n.js'
import { sound } from '../core/sound.js'
import { showScreen } from '../core/screens.js'
import { makeBgLayer } from '../core/bg.js'
import { icons } from '../core/icons.js'
import { getBest, submitScore } from '../core/storage.js'
import { bindShare } from '../core/share.js'
import { drawBall } from '../ball.js'
import { createHomeScreen } from './home.js'

const MODE = 'keepy'

export function createKeepyScreen() {
  const el = document.createElement('div')
  el.className = 'screen'
  el.appendChild(makeBgLayer('pitch'))

  const game = document.createElement('div')
  game.className = 'game'
  const canvas = document.createElement('canvas')
  game.appendChild(canvas)
  el.appendChild(game)

  // 頂列：返回 + 靜音
  const topbar = document.createElement('div')
  topbar.className = 'topbar'
  topbar.innerHTML = `
    <button class="icon-btn" id="back">← ${t('back')}</button>
    <button class="icon-btn icon-only" id="mute" aria-label="${t('mute')}">${
      sound.isMuted() ? icons.soundOff : icons.soundOn
    }</button>
  `
  el.appendChild(topbar)

  // HUD
  const hud = document.createElement('div')
  hud.className = 'hud'
  hud.innerHTML = `
    <div class="hud-best">${t('bestScore')}: <b id="best">${getBest(MODE)}</b></div>
    <div class="hud-combo">
      <div class="num" id="combo">0</div>
      <div class="label">${t('keepyCombo')} ${t('keepyUnit')}</div>
    </div>
  `
  el.appendChild(hud)

  const comboEl = hud.querySelector('#combo')
  const bestEl = hud.querySelector('#best')

  // ---------- 遊戲狀態 ----------
  const ctx = canvas.getContext('2d')
  let W = 0,
    H = 0,
    dpr = 1
  const state = {
    running: false,
    score: 0,
    ball: null,
    raf: 0,
    last: 0,
    windPhase: 0, // 側風相位
  }

  const BASE_GRAVITY = 1500 // px/s^2
  const WALL_BOUNCE = 0.8
  const KICK_VY = 860 // 向上踢力 (基礎)
  const KICK_VX = 380 // 水平最大速度
  const AIR_DRAG = 0.45 // 水平空氣阻力 (1/s)
  const DESCEND_GATE = 40 // 球必須下墜 (vy>此值) 才可再次踢，杜絕「上升中連點」
  const HIT_RADIUS = 1.5 // 命中圈 = 球半徑倍數 (寬鬆但仍需點到球)
  const SQ_K = 900 // 擠壓彈簧剛性
  const SQ_C = 18 // 擠壓彈簧阻尼
  // 難度 (隨顛球次數 score 累積)
  const SPRAY = 26 // 偏心噴射係數：點越歪、分數越高，球越往側邊噴
  const MISHIT_JOLT = 340 // 失誤暴衝：高分偶發，球突然橫向噴走
  const WIND_MAX = 620 // 側風加速度上限

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    W = game.clientWidth
    H = game.clientHeight
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  function newBall() {
    const r = Math.max(28, Math.min(W, H) * 0.11)
    return {
      x: W / 2,
      y: r + 20,
      vx: (Math.random() - 0.5) * 120,
      vy: 0,
      r,
      r0: r, // 原始半徑 (球會隨分數略縮小)
      rot: 0,
      vrot: 0,
      sx: 1,
      sy: 1,
      squashAngle: 0,
      sq: 0, // 擠壓位移 (阻尼彈簧，正=壓扁)
      sqv: 0, // 擠壓速度
    }
  }

  function difficulty() {
    // 隨分數提高重力 (越來越快)，上限避免失控
    return BASE_GRAVITY * Math.min(1.8, 1 + state.score * 0.02)
  }

  function start() {
    sound.unlock()
    state.score = 0
    state.windPhase = 0
    state.ball = newBall()
    state.running = true
    state.last = performance.now()
    updateCombo(false)
    hideOverlay()
  }

  function gameOver() {
    state.running = false
    sound.fail()
    const isRecord = submitScore(MODE, state.score)
    bestEl.textContent = getBest(MODE)
    showOverlay(endOverlay(state.score, isRecord))
  }

  // ---------- 點擊回彈 ----------
  function onPointer(e) {
    if (!state.running) return
    const b = state.ball

    // 規則一：球必須在下墜階段才踢得到 → 杜絕「球還在上升就連點兩下」。
    if (b.vy < DESCEND_GATE) return

    const rect = canvas.getBoundingClientRect()
    const px = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left
    const py = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top

    // 規則二：必須點到球 (留 1.5r 寬鬆命中圈，好點但仍需瞄準)，點空不計、保留挑戰性。
    if (Math.hypot(px - b.x, py - b.y) > b.r * HIT_RADIUS) return

    const lvl = state.score // 目前連續顛球數 = 難度

    // 向上踢：力道固定 + 微擾
    b.vy = -(KICK_VY + Math.random() * 60)
    // 方向：點球右側 → 往左上飛；越靠球邊角度越大
    const offset = clamp((b.x - px) / b.r, -1, 1)
    // 偏心噴射：offset² × 分數 → 點正中心永遠穩，點越歪、分數越高噴越遠
    b.vx = offset * KICK_VX + Math.sign(offset) * offset * offset * lvl * SPRAY
    // 失誤暴衝：高分時偶發 (機率隨分數上升)，球突然橫向噴走
    if (Math.random() < Math.min(0.4, lvl * 0.015)) {
      b.vx += (Math.random() < 0.5 ? -1 : 1) * MISHIT_JOLT * (0.5 + Math.random() * 0.5)
    }
    b.vx = clamp(b.vx, -1400, 1400)
    // 自轉方向與踢擊側一致 (側踢帶旋轉)，噴得越猛轉越快
    b.vrot = -(b.vx / b.r) * 0.6

    // 擠壓：沿飛行方向壓扁，交給彈簧回彈
    b.squashAngle = Math.atan2(b.vy, b.vx)
    b.sqv += 5.5 // 撞擊脈衝 → 峰值約 18%

    state.score += 1
    updateCombo(true)
    sound.bounce()
    sound.point()
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v
  }

  function updateCombo(pop) {
    comboEl.textContent = state.score
    if (pop) {
      comboEl.classList.remove('pop')
      void comboEl.offsetWidth // reflow 重觸發動畫
      comboEl.classList.add('pop')
    }
  }

  // ---------- 主迴圈 ----------
  function frame(now) {
    state.raf = requestAnimationFrame(frame)
    let dt = (now - state.last) / 1000
    state.last = now
    if (dt > 0.05) dt = 0.05 // 視窗切換防爆衝

    if (state.running) update(dt)
    render()
  }

  function update(dt) {
    const b = state.ball
    b.vy += difficulty() * dt
    b.vx -= b.vx * AIR_DRAG * dt // 水平空氣阻力，側飛不會無限滑

    // 側風漂移：隨分數變強變快，逼玩家不斷重新移位
    const windAmp = Math.min(WIND_MAX, state.score * 16)
    state.windPhase += dt * (1.0 + state.score * 0.025)
    b.vx += Math.sin(state.windPhase) * windAmp * dt

    // 球隨分數略縮小 → 命中圈變小，更難點中 (平滑過渡)
    const targetR = b.r0 * Math.max(0.74, 1 - state.score * 0.01)
    b.r += (targetR - b.r) * Math.min(1, dt * 3)

    b.x += b.vx * dt
    b.y += b.vy * dt
    b.rot += b.vrot * dt
    b.vrot *= 0.99

    // 左右牆反彈
    if (b.x - b.r < 0) {
      b.x = b.r
      b.vx = Math.abs(b.vx) * WALL_BOUNCE
    } else if (b.x + b.r > W) {
      b.x = W - b.r
      b.vx = -Math.abs(b.vx) * WALL_BOUNCE
    }

    // 擠壓變形：阻尼彈簧 (壓扁 → 略過衝拉長 → 收斂)，比線性衰減更像受力
    const acc = -SQ_K * b.sq - SQ_C * b.sqv
    b.sqv += acc * dt
    b.sq += b.sqv * dt
    b.sq = clamp(b.sq, -0.2, 0.2)
    b.sx = 1 - b.sq // 沿飛行方向壓扁
    b.sy = 1 + b.sq * 0.5 // 垂直方向略鼓 (近似體積守恆)

    // 落地判定 (球心越過底線)
    if (b.y - b.r > H) {
      gameOver()
    }
  }

  const TEST = location.search.includes('fgtest')

  function render() {
    ctx.clearRect(0, 0, W, H)
    if (TEST && state.ball) {
      window.__fgBall = { x: state.ball.x, y: state.ball.y, r: state.ball.r, running: state.running }
    }
    if (state.ball) {
      drawShadow(state.ball)
      drawBall(ctx, {
        cx: state.ball.x,
        cy: state.ball.y,
        r: state.ball.r,
        rotation: state.ball.rot,
        sx: state.ball.sx,
        sy: state.ball.sy,
        squashAngle: state.ball.squashAngle,
      })
    }
  }

  function drawShadow(b) {
    const groundY = H - 8
    const closeness = Math.min(1, Math.max(0, (b.y + b.r) / H))
    const w = b.r * (0.7 + closeness * 0.7)
    ctx.save()
    ctx.globalAlpha = 0.18 * closeness
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.ellipse(b.x, groundY, w, w * 0.22, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // ---------- 覆蓋層 ----------
  let overlayEl = null
  function showOverlay(node) {
    hideOverlay()
    overlayEl = node
    el.appendChild(node)
  }
  function hideOverlay() {
    if (overlayEl) overlayEl.remove()
    overlayEl = null
  }

  function startOverlay() {
    const o = document.createElement('div')
    o.className = 'overlay'
    o.innerHTML = `
      <h2>${t('mode1Title')}</h2>
      <button class="btn" id="go">${t('tapToStart')}</button>
    `
    o.querySelector('#go').addEventListener('click', start)
    return o
  }

  function endOverlay(score, isRecord) {
    const o = document.createElement('div')
    o.className = 'overlay'
    o.innerHTML = `
      <h2>${t('gameOver')}</h2>
      <p class="big">${score}</p>
      ${isRecord ? `<p class="record">★ ${t('newRecord')}</p>` : ''}
      <button class="btn" id="retry">${t('retry')}</button>
      <button class="btn share" id="share">${t('share')}</button>
      <button class="btn ghost" id="home">${t('back')}</button>
    `
    o.querySelector('#retry').addEventListener('click', start)
    o.querySelector('#home').addEventListener('click', () => showScreen(createHomeScreen))
    bindShare(o.querySelector('#share'), MODE, score)
    return o
  }

  // ---------- 綁定 ----------
  canvas.addEventListener('pointerdown', onPointer)
  topbar.querySelector('#back').addEventListener('click', () => showScreen(createHomeScreen))
  const muteBtn = topbar.querySelector('#mute')
  muteBtn.addEventListener('click', () => {
    const m = sound.toggleMute()
    muteBtn.innerHTML = m ? icons.soundOff : icons.soundOn
  })

  const ro = new ResizeObserver(resize)
  ro.observe(game)

  // 初始化 (需等 DOM 進場才有尺寸)
  requestAnimationFrame(() => {
    resize()
    state.ball = newBall()
    showOverlay(startOverlay())
    state.last = performance.now()
    state.raf = requestAnimationFrame(frame)
  })

  return {
    el,
    destroy() {
      cancelAnimationFrame(state.raf)
      ro.disconnect()
    },
  }
}
