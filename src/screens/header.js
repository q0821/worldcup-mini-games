// 模式二：頭鎚射門（攝影機 AR）。
// 球從左 / 右側橫向傳中飛入，你用頭左右移動把「頂球點」對到球，
// 在交會瞬間往上一頂，把球頂向上方球門得分。頭在球的左/右側決定頂出方向。
// 攝影機只當控制器（抽出頭的左右位置 + 撞擊點），不鋪滿畫面；角落放小自拍框回饋。
// 攝影機不可用 / 拒絕授權 → 自動降級為手指 / 滑鼠控制頂球點。

import { t } from '../core/i18n.js'
import { sound } from '../core/sound.js'
import { showScreen } from '../core/screens.js'
import { icons } from '../core/icons.js'
import { getBest, submitScore } from '../core/storage.js'
import { bindShare } from '../core/share.js'
import { drawBall } from '../ball.js'
import { createHomeScreen } from './home.js'
import { CameraTracker, PointerTracker } from './headerTracker.js'

// 球場背景圖（降級 / 指標模式用；載入失敗退回漸層）
const pitchBg = new Image()
let pitchBgReady = false
pitchBg.onload = () => {
  pitchBgReady = true
}
pitchBg.src = 'assets/bg/header.webp'

const MODE = 'header'
const GAME_SEC = 60
const HEAD_SWING_THRESH = 230 // 頭擺動速度門檻 (px/s，任意方向)，超過才算有效頂球
const HEAD_X_GAIN = 1.7 // 頭左右移動 → 頂球點的放大（小幅擺頭即可涵蓋全寬）
const HEAD_Y_GAIN = 1.5
const GRAVITY = 1000 // 傳中拋物線重力（較強 → 弧線明顯、落得快）
const T_OUT = 0.55 // 頂出後飛向球門的時間（快、俐落）
const FAR_SCALE = 0.4 // 飛抵球門時的縮放（往前飛去的深度感）
// 頂出方向 = 頭擺動向量 + 撞擊點，再混入朝球門偏置（維持可玩）
const SWING_AIM = 0.22 // 頭水平擺動速度 → 球橫向落點
const OFFSET_AIM = 1.4 // 撞擊點（頭在球左/右側）→ 橫向落點
const GOAL_BIAS = 0.42 // 朝球門中心的偏置 (0=純動量, 1=一律正中)

export function createHeaderScreen() {
  const el = document.createElement('div')
  el.className = 'screen'

  const video = document.createElement('video')
  video.setAttribute('playsinline', '')
  video.muted = true
  video.style.cssText = 'position:absolute;width:2px;height:2px;opacity:0;pointer-events:none;top:0;left:0;z-index:-1'
  el.appendChild(video)

  const game = document.createElement('div')
  game.className = 'game'
  const canvas = document.createElement('canvas')
  game.appendChild(canvas)
  el.appendChild(game)

  const topbar = document.createElement('div')
  topbar.className = 'topbar'
  topbar.innerHTML = `
    <button class="icon-btn" id="back">← ${t('back')}</button>
    <button class="icon-btn icon-only" id="mute" aria-label="${t('mute')}">${
      sound.isMuted() ? icons.soundOff : icons.soundOn
    }</button>
  `
  el.appendChild(topbar)

  const hud = document.createElement('div')
  hud.className = 'hud'
  hud.innerHTML = `
    <div class="hd-hud">
      <div class="hd-score"><span>${t('score')}</span><b id="hscore">0</b></div>
      <div class="hd-timewrap"><i id="htime"></i></div>
    </div>
    <div class="pk-msg" id="msg"></div>
    <div class="hd-cue" id="cue"></div>
  `
  el.appendChild(hud)

  const $ = (id) => hud.querySelector('#' + id)
  const scoreEl = $('hscore')
  const timeEl = $('htime')
  const msgEl = $('msg')
  const cueEl = $('cue')

  // ---------- 狀態 ----------
  const ctx = canvas.getContext('2d')
  let W = 0
  let H = 0
  let dpr = 1
  let tracker = null
  let usingCamera = false

  const goal = { cx: 0, halfW: 0, baseY: 0, h: 0, shake: 0 } // baseY = 門柱站在草地上的基準線
  const head = { x: 0, y: 0, vx: 0, vy: 0, r: 56, active: false } // 場上「頂球點」
  const state = {
    raf: 0,
    last: 0,
    running: false,
    score: 0,
    timeLeft: GAME_SEC,
    ball: null,
    msgT: 0,
    flash: 0,
    contactCd: 0,
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    W = game.clientWidth
    H = game.clientHeight
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    goal.cx = W / 2
    goal.halfW = clamp(W * 0.26, 104, 200)
    goal.h = goal.halfW * 0.62
    goal.baseY = H * 0.36 // 站在遠方草地上
  }

  const HORIZON = () => H * 0.2 // 天空 / 草皮分界
  const headLineY = () => H * 0.62

  // 球從左 / 右側拋物線傳中飛入
  function newBall() {
    const r = Math.max(26, Math.min(W, H) * 0.07)
    const fromLeft = Math.random() < 0.5
    const speed = W * (0.62 + Math.random() * 0.22) // 較快
    return {
      phase: 'cross', // cross（傳中飛入）| out（頂出飛向球門）
      t: 0,
      x: fromLeft ? -r : W + r,
      y: H * 0.2 + Math.random() * H * 0.06, // 從高處進場
      vx: fromLeft ? speed : -speed,
      vy: -40, // 微上拋後重力拉下 → 明顯拋物線
      r,
      baseR: r,
      scale: 1,
      rot: 0,
      vrot: (fromLeft ? 1 : -1) * 5,
      sq: 0,
      sqv: 0,
      squashAngle: 0,
      headed: false,
      scored: false,
      willScore: false,
      outDur: T_OUT,
      x0: 0,
      y0: 0,
      x1: 0,
      y1: 0,
    }
  }

  // 動量轉移：頂出方向由頭擺動向量 + 撞擊點決定，再混入朝球門偏置。
  function headerBall(b) {
    b.phase = 'out'
    b.t = 0
    b.x0 = b.x
    b.y0 = b.y
    // 純動量落點：頭往哪掃球往哪去（同向）+ 頭在球哪一側（撞擊點）
    const rawX = b.x + head.vx * SWING_AIM + (b.x - head.x) * OFFSET_AIM
    // 混入朝球門中心的偏置，避免狂掃把球甩到莫名其妙的地方
    const goalX = rawX + (goal.cx - rawX) * GOAL_BIAS
    b.x1 = clamp(goalX, goal.cx - goal.halfW * 2.4, goal.cx + goal.halfW * 2.4)
    b.willScore = Math.abs(b.x1 - goal.cx) < goal.halfW - b.baseR * FAR_SCALE * 0.5
    b.y1 = goal.baseY - goal.h * 0.55 // 飛進球門內（門口中段）
    // 頂出速度越快（擺得越猛）飛得越俐落
    const swing = Math.hypot(head.vx, head.vy)
    b.outDur = clamp(T_OUT * (1 - (swing - HEAD_SWING_THRESH) / 2600), 0.4, T_OUT)
    b.headed = true
    b.sqv += 6
    b.squashAngle = Math.atan2(b.y1 - b.y0, b.x1 - b.x0)
    state.flash = 0.12
    sound.kick()
  }

  // ---------- 頂球點（頭 / 指標）映射 ----------
  function updateHead() {
    if (!tracker || !tracker.active) {
      head.active = false
      return
    }
    head.active = true
    if (usingCamera) {
      // 以畫面中心為基準放大左右 / 上下擺動，小幅動作即可涵蓋全寬
      head.x = clamp(W / 2 + (tracker.x - W / 2) * HEAD_X_GAIN, 0, W)
      head.y = clamp(headLineY() + (tracker.y - H / 2) * HEAD_Y_GAIN, H * 0.32, H * 0.92)
      head.vx = tracker.vx * HEAD_X_GAIN
      head.vy = tracker.vy * HEAD_Y_GAIN
      head.r = clamp((tracker.headR || 56) * 0.55, 28, 46) // 控制圈縮小
    } else {
      head.x = tracker.x
      head.y = tracker.y
      head.vx = tracker.vx
      head.vy = tracker.vy
      head.r = 38
    }
  }

  // ---------- 訊息 ----------
  function showMsg(text, tone = '') {
    msgEl.textContent = text
    msgEl.className = 'pk-msg show ' + tone
    state.msgT = 1.1
  }

  // ---------- 流程 ----------
  function beginGame() {
    state.running = true
    state.score = 0
    state.timeLeft = GAME_SEC
    state.ball = newBall()
    scoreEl.textContent = '0'
    hideOverlay()
    cueEl.textContent = usingCamera ? t('hdHeadHint') : t('hdCalibPointer')
    sound.whistle(1)
  }

  function endGame() {
    state.running = false
    sound.whistle(2)
    const isRecord = submitScore(MODE, state.score)
    if (state.score > 0) sound.crowd(1.8, 0.35)
    showOverlay(endOverlay(state.score, isRecord))
  }

  // ---------- 更新 ----------
  function update(dt) {
    if (state.msgT > 0) {
      state.msgT -= dt
      if (state.msgT <= 0) msgEl.classList.remove('show')
    }
    if (goal.shake > 0) goal.shake = Math.max(0, goal.shake - dt * 2.4)
    if (state.flash > 0) state.flash -= dt
    if (state.contactCd > 0) state.contactCd -= dt

    if (tracker) tracker.update(dt, W, H)
    updateHead()

    if (!state.running) return

    state.timeLeft -= dt
    timeEl.style.width = `${clamp(state.timeLeft / GAME_SEC, 0, 1) * 100}%`
    if (state.timeLeft <= 0) {
      endGame()
      return
    }

    const b = state.ball
    b.t += dt
    b.rot += b.vrot * dt
    b.sqv += (-900 * b.sq - 18 * b.sqv) * dt
    b.sq += b.sqv * dt
    b.sq = clamp(b.sq, -0.18, 0.18)

    if (b.phase === 'cross') {
      // 拋物線飛入（滿尺寸）
      b.vy += GRAVITY * dt
      b.vrot *= 0.99
      b.x += b.vx * dt
      b.y += b.vy * dt

      // 頂球判定：頭往任意方向擺動夠快 → 動量轉移頂球；太慢 → 只輕彈
      if (head.active && state.contactCd <= 0) {
        const d = Math.hypot(b.x - head.x, b.y - head.y)
        if (d < b.r + head.r) {
          const swing = Math.hypot(head.vx, head.vy)
          if (swing > HEAD_SWING_THRESH) {
            headerBall(b)
          } else {
            // 碰到但頭幾乎沒動 → 輕彈，無力道
            b.vy = -240
            b.vx += (b.x - head.x) * 1.0
            b.sqv += 3
            b.squashAngle = Math.PI / 2
            state.contactCd = 0.2
            sound.bounce()
          }
        }
      }
      // 飛出畫面 → 沒接到
      if (b.x + b.r < -30 || b.x - b.r > W + 30 || b.y - b.r > H + 30) {
        if (!b.headed) showMsg(t('hdMiss'), 'bad')
        state.ball = newBall()
      }
    } else if (b.phase === 'out') {
      // 頂出 → 縮小飛向遠方球門
      const p = clamp(b.t / (b.outDur || T_OUT), 0, 1)
      b.scale = 1 + (FAR_SCALE - 1) * p
      b.x = b.x0 + (b.x1 - b.x0) * p
      b.y = b.y0 + (b.y1 - b.y0) * p - Math.sin(Math.PI * p) * H * 0.05
      if (p >= 1) {
        if (b.willScore) {
          state.score += 1
          scoreEl.textContent = state.score
          scoreEl.classList.remove('pop')
          void scoreEl.offsetWidth
          scoreEl.classList.add('pop')
          goal.shake = 0.6
          showMsg(t('hdGoal'), 'good')
          sound.swish()
          sound.point()
          sound.crowd(1.0, 0.25)
        } else {
          showMsg(t('hdMiss'), 'bad')
        }
        state.ball = newBall()
      }
    }
  }

  // ---------- 繪製 ----------
  function render() {
    ctx.clearRect(0, 0, W, H)

    // 球場背景：AI 球場圖（cover），載入失敗退回漸層 + 條紋
    if (pitchBgReady) {
      const scale = Math.max(W / pitchBg.width, H / pitchBg.height)
      const dw = pitchBg.width * scale
      const dh = pitchBg.height * scale
      ctx.drawImage(pitchBg, (W - dw) / 2, (H - dh) / 2, dw, dh)
    } else {
      const hz = HORIZON()
      const sky = ctx.createLinearGradient(0, 0, 0, hz)
      sky.addColorStop(0, '#7ec0e8')
      sky.addColorStop(1, '#cfeeff')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, W, hz)
      const grass = ctx.createLinearGradient(0, hz, 0, H)
      grass.addColorStop(0, '#3f9b4b')
      grass.addColorStop(1, '#256a2f')
      ctx.fillStyle = grass
      ctx.fillRect(0, hz, W, H - hz)
      ctx.fillStyle = 'rgba(255,255,255,0.045)'
      for (let i = 0; i < 7; i++) {
        const y = hz + ((H - hz) * i * i) / 49
        const y2 = hz + ((H - hz) * (i + 1) * (i + 1)) / 49
        if (i % 2 === 0) ctx.fillRect(0, y, W, y2 - y)
      }
    }

    drawGoal()

    // 頂球線
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.lineWidth = 2
    ctx.setLineDash([8, 10])
    ctx.beginPath()
    ctx.moveTo(0, headLineY())
    ctx.lineTo(W, headLineY())
    ctx.stroke()
    ctx.setLineDash([])

    // 頂球點標記
    if (head.active) drawHeadMarker()

    const b = state.ball
    if (b) {
      const r = b.baseR * b.scale
      // 球影（傳中階段落在頂球線上）
      if (b.phase === 'cross') {
        ctx.fillStyle = 'rgba(0,0,0,0.16)'
        ctx.beginPath()
        ctx.ellipse(b.x, headLineY() + 6, r * 0.9, r * 0.28, 0, 0, Math.PI * 2)
        ctx.fill()
      }
      drawBall(ctx, {
        cx: b.x,
        cy: b.y,
        r,
        rotation: b.rot,
        sx: 1 - b.sq,
        sy: 1 + b.sq * 0.5,
        squashAngle: b.squashAngle,
      })
    }

    if (state.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${(state.flash / 0.12) * 0.18})`
      ctx.fillRect(0, 0, W, H)
    }

    // 角落自拍小框（攝影機模式）
    if (usingCamera && tracker && tracker.video) drawSelfie()
  }

  function drawGoal() {
    const sx = goal.shake > 0 ? (Math.random() - 0.5) * goal.shake * 7 : 0
    const cx = goal.cx + sx
    const x0 = cx - goal.halfW
    const x1 = cx + goal.halfW
    const topY = goal.baseY - goal.h
    const botY = goal.baseY

    // 門柱落地陰影（讓球門站在草地上、不漂浮）
    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.18)'
    ctx.beginPath()
    ctx.ellipse(cx, botY + 4, goal.halfW * 1.12, goal.halfW * 0.12, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    ctx.strokeStyle = 'rgba(255,255,255,0.4)'
    ctx.lineWidth = 1
    const cols = 9
    const rows = 5
    for (let i = 0; i <= cols; i++) {
      const x = x0 + ((x1 - x0) * i) / cols
      ctx.beginPath()
      ctx.moveTo(x, topY)
      ctx.lineTo(x, botY)
      ctx.stroke()
    }
    for (let j = 0; j <= rows; j++) {
      const y = topY + ((botY - topY) * j) / rows
      ctx.beginPath()
      ctx.moveTo(x0, y)
      ctx.lineTo(x1, y)
      ctx.stroke()
    }
    ctx.strokeStyle = '#f4f6f7'
    ctx.lineWidth = Math.max(5, goal.halfW * 0.055)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x0, botY)
    ctx.lineTo(x0, topY)
    ctx.lineTo(x1, topY)
    ctx.lineTo(x1, botY)
    ctx.stroke()
    // 門口提示
    ctx.strokeStyle = 'rgba(255,211,61,0.55)'
    ctx.lineWidth = 2
    ctx.setLineDash([10, 8])
    ctx.beginPath()
    ctx.moveTo(x0, botY)
    ctx.lineTo(x1, botY)
    ctx.stroke()
    ctx.setLineDash([])
  }

  function drawHeadMarker() {
    const b = state.ball
    const near = b && b.phase === 'cross' && Math.hypot(b.x - head.x, b.y - head.y) < b.r + head.r + 36
    ctx.save()
    ctx.strokeStyle = near ? 'rgba(255,80,60,0.95)' : 'rgba(255,211,61,0.9)'
    ctx.lineWidth = near ? 4 : 3
    ctx.beginPath()
    ctx.arc(head.x, head.y, head.r, 0, Math.PI * 2)
    ctx.stroke()
    // 可頂擊：外圈脈動提示「擺頭撞球」（任意方向）
    if (near) {
      const pulse = head.r + 8 + Math.sin(state.last / 90) * 4
      ctx.strokeStyle = 'rgba(255,80,60,0.5)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(head.x, head.y, pulse, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }

  function drawSelfie() {
    const v = tracker.video
    if (!v || v.readyState < 2) return
    const pw = Math.min(120, W * 0.28)
    const ph = pw * 0.75
    const px = 12
    const py = H - ph - 12 - parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom') || 0)
    const rrect = (x, y, w, h, r) => {
      ctx.beginPath()
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, r)
      else ctx.rect(x, y, w, h) // 舊瀏覽器 fallback：直角
    }
    ctx.save()
    rrect(px, py, pw, ph, 10)
    ctx.clip()
    // cover + 鏡像
    const scale = Math.max(pw / v.videoWidth, ph / v.videoHeight)
    const dw = v.videoWidth * scale
    const dh = v.videoHeight * scale
    ctx.translate(px + pw, py)
    ctx.scale(-1, 1)
    ctx.drawImage(v, (pw - dw) / 2, (ph - dh) / 2, dw, dh)
    ctx.restore()
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'
    ctx.lineWidth = 2
    rrect(px, py, pw, ph, 10)
    ctx.stroke()
  }

  // ---------- 主迴圈 ----------
  function frame(now) {
    state.raf = requestAnimationFrame(frame)
    let dt = (now - state.last) / 1000
    state.last = now
    if (dt > 0.05) dt = 0.05
    update(dt)
    render()
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

  function introOverlay() {
    const o = document.createElement('div')
    o.className = 'overlay'
    o.innerHTML = `
      <h2>${t('mode2Title')}</h2>
      <p class="hd-howto">${t('hdHowto')}</p>
      <p class="hd-note">${t('hdCamNote')}</p>
      <button class="btn" id="cam">${t('hdUseCam')}</button>
      <button class="btn ghost" id="ptr">${t('hdUsePointer')}</button>
    `
    o.querySelector('#cam').addEventListener('click', () => {
      sound.unlock()
      startCamera()
    })
    o.querySelector('#ptr').addEventListener('click', () => {
      sound.unlock()
      startPointer()
    })
    return o
  }

  function loadingOverlay(text) {
    const o = document.createElement('div')
    o.className = 'overlay'
    o.innerHTML = `<div class="spinner"></div><p>${text}</p>`
    return o
  }

  function endOverlay(score, isRecord) {
    const o = document.createElement('div')
    o.className = 'overlay'
    o.innerHTML = `
      <h2>${t('gameOver')}</h2>
      <p class="big">${score}</p>
      ${isRecord ? `<p class="record">★ ${t('newRecord')}</p>` : ''}
      <p class="hd-best">${t('bestScore')}: ${getBest(MODE)}</p>
      <button class="btn" id="retry">${t('retry')}</button>
      <button class="btn share" id="share">${t('share')}</button>
      <button class="btn ghost" id="home">${t('back')}</button>
    `
    o.querySelector('#retry').addEventListener('click', () => {
      hideOverlay()
      showOverlay(introOverlay())
    })
    o.querySelector('#home').addEventListener('click', () => showScreen(createHomeScreen))
    bindShare(o.querySelector('#share'), MODE, score)
    return o
  }

  // ---------- 啟動：攝影機 / 降級 ----------
  async function startCamera() {
    if (tracker) tracker.stop()
    tracker = null
    showOverlay(loadingOverlay(t('hdLoading')))
    const cam = new CameraTracker(video)
    try {
      await cam.start()
      tracker = cam
      usingCamera = true
      beginGame()
    } catch (err) {
      console.error('[頭鎚射門] 攝影機/模型啟動失敗', err && err.stage, err)
      cam.stop()
      const reason = err && err.stage === 'model' ? '頭部追蹤模型載入失敗' : '無法取得攝影機'
      showMsg(`${reason}，改用手指 / 滑鼠玩`, 'bad')
      startPointer()
    }
  }

  function startPointer() {
    if (tracker) tracker.stop()
    tracker = new PointerTracker(game)
    tracker.start()
    usingCamera = false
    beginGame()
  }

  // ---------- 綁定 ----------
  topbar.querySelector('#back').addEventListener('click', () => showScreen(createHomeScreen))
  const muteBtn = topbar.querySelector('#mute')
  muteBtn.addEventListener('click', () => {
    const m = sound.toggleMute()
    muteBtn.innerHTML = m ? icons.soundOff : icons.soundOn
  })

  const ro = new ResizeObserver(resize)
  ro.observe(game)

  if (location.search.includes('fgtest')) {
    window.__hd = {
      state,
      goal,
      head,
      get tracker() {
        return tracker
      },
      startPointer,
    }
  }

  requestAnimationFrame(() => {
    resize()
    state.ball = newBall()
    showOverlay(introOverlay())
    state.last = performance.now()
    state.raf = requestAnimationFrame(frame)
  })

  return {
    el,
    destroy() {
      cancelAnimationFrame(state.raf)
      ro.disconnect()
      if (tracker) tracker.stop()
      tracker = null
      if (video.srcObject) {
        video.srcObject.getTracks?.().forEach((tk) => tk.stop())
        video.srcObject = null
      }
      if (window.__hd) delete window.__hd
    },
  }
}
