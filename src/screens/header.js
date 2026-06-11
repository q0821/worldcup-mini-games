// 模式二：頭鎚射門（攝影機 AR）。
// 球從上方落下，玩家用頭（攝影機追蹤額頭位置）往上頂，把球頂進上方球門。
// 「往上頂」要頭真的往上移動才有力道（站著不動撞到沒用）。
// 攝影機不可用 / 拒絕授權 → 自動降級為手指 / 滑鼠控制頂球點，同一套遊戲迴圈。

import { t } from '../core/i18n.js'
import { sound } from '../core/sound.js'
import { showScreen } from '../core/screens.js'
import { icons } from '../core/icons.js'
import { getBest, submitScore } from '../core/storage.js'
import { drawBall } from '../ball.js'
import { createHomeScreen } from './home.js'
import { CameraTracker, PointerTracker } from './headerTracker.js'

const MODE = 'header'
const GAME_SEC = 60
const GRAVITY = 1250 // px/s²
const HEAD_UP_THRESH = 220 // 頭向上速度門檻 (px/s)，超過才算有效頂球
const HEADER_BASE = 760 // 頂球基礎力道
const HEADER_MAX = 1500

export function createHeaderScreen() {
  const el = document.createElement('div')
  el.className = 'screen'

  // 隱藏的 video 作為攝影機來源（不直接顯示，改畫進 canvas 以統一座標）
  const video = document.createElement('video')
  video.setAttribute('playsinline', '')
  video.muted = true
  video.style.display = 'none'
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
    <div class="hd-cue" id="cue">${t('hdCalibPointer')}</div>
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

  const goal = { cx: 0, halfW: 0, mouthY: 0, h: 0, shake: 0 }
  const state = {
    raf: 0,
    last: 0,
    running: false,
    score: 0,
    timeLeft: GAME_SEC,
    ball: null,
    msgT: 0,
    contactCd: 0, // 頂球冷卻，避免單次接觸多次觸發
    flash: 0,
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
    goal.halfW = clamp(W * 0.3, 110, 210)
    goal.h = goal.halfW * 0.95
    goal.mouthY = H * 0.24
  }

  function newBall() {
    const r = Math.max(26, Math.min(W, H) * 0.075)
    return {
      x: goal.cx + (Math.random() - 0.5) * W * 0.4,
      y: -r,
      vx: (Math.random() - 0.5) * 120,
      vy: 320,
      r,
      rot: 0,
      vrot: (Math.random() - 0.5) * 6,
      sq: 0,
      sqv: 0,
      squashAngle: 0,
      prevY: -r,
      scored: false,
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
    cueEl.style.opacity = '1'
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

  // ---------- 物理 / 頂球 ----------
  function update(dt) {
    if (state.msgT > 0) {
      state.msgT -= dt
      if (state.msgT <= 0) msgEl.classList.remove('show')
    }
    if (goal.shake > 0) goal.shake = Math.max(0, goal.shake - dt * 2.4)
    if (state.flash > 0) state.flash -= dt
    if (state.contactCd > 0) state.contactCd -= dt

    if (tracker) tracker.update(dt, W, H)

    if (!state.running) return

    state.timeLeft -= dt
    timeEl.style.width = `${clamp(state.timeLeft / GAME_SEC, 0, 1) * 100}%`
    if (state.timeLeft <= 0) {
      endGame()
      return
    }

    const b = state.ball
    b.prevY = b.y
    b.vy += GRAVITY * dt
    b.x += b.vx * dt
    b.y += b.vy * dt
    b.rot += b.vrot * dt
    b.vrot *= 0.99

    // 擠壓彈簧
    b.sqv += (-900 * b.sq - 18 * b.sqv) * dt
    b.sq += b.sqv * dt
    b.sq = clamp(b.sq, -0.18, 0.18)

    // 左右牆反彈
    if (b.x - b.r < 0) {
      b.x = b.r
      b.vx = Math.abs(b.vx) * 0.7
    } else if (b.x + b.r > W) {
      b.x = W - b.r
      b.vx = -Math.abs(b.vx) * 0.7
    }

    // 頂球判定
    if (tracker && tracker.active && state.contactCd <= 0) {
      const hr = tracker.headR || 56
      const d = Math.hypot(b.x - tracker.x, b.y - tracker.y)
      if (d < b.r + hr) {
        const goingUp = tracker.vy < -HEAD_UP_THRESH
        if (goingUp) {
          // 有效頂球：力道隨頭往上速度增加，方向瞄準球門 + 帶頭部水平動量
          const power = clamp(HEADER_BASE + Math.abs(tracker.vy) * 1.4, HEADER_BASE, HEADER_MAX)
          b.vy = -power
          b.vx = (goal.cx - b.x) * 2.4 + tracker.vx * 0.35
          b.vx = clamp(b.vx, -700, 700)
          b.vrot = -b.vx / b.r
          b.sqv += 5.5
          b.squashAngle = Math.atan2(-b.vy, b.vx)
          state.contactCd = 0.25
          state.flash = 0.12
          sound.kick()
        } else {
          // 站著被撞到：只輕輕彈開，沒有上頂力道
          b.vy = -260
          b.vx += (b.x - tracker.x) * 1.2
          b.sqv += 3
          b.squashAngle = Math.PI / 2
          state.contactCd = 0.2
          sound.bounce()
        }
      }
    }

    // 進球：往上穿過球門口且在門柱間
    if (!b.scored && b.vy < 0 && b.prevY >= goal.mouthY && b.y < goal.mouthY) {
      if (Math.abs(b.x - goal.cx) < goal.halfW - b.r * 0.4) {
        b.scored = true
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
      }
    }

    // 重生：飛出上方（含射偏 / 進球後）或落到底線
    if (b.y + b.r < -10 || b.y - b.r > H + 10) {
      if (!b.scored && b.y - b.r > H) showMsg(t('hdMiss'), 'bad')
      state.ball = newBall()
    }
  }

  // ---------- 繪製 ----------
  function render() {
    ctx.clearRect(0, 0, W, H)

    // 背景：攝影機畫面 或 漸層球場
    let drew = false
    if (usingCamera && tracker && tracker.drawVideo) drew = tracker.drawVideo(ctx, W, H)
    if (!drew) {
      const sky = ctx.createLinearGradient(0, 0, 0, H)
      sky.addColorStop(0, '#8fd0f2')
      sky.addColorStop(0.55, '#bfe6ff')
      sky.addColorStop(0.55, '#3f9b4b')
      sky.addColorStop(1, '#2e7a3a')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, W, H)
    } else {
      // 攝影機畫面上加一層暗化，讓前景球門 / 球更清楚
      ctx.fillStyle = 'rgba(0,0,0,0.12)'
      ctx.fillRect(0, 0, W, H)
    }

    drawGoal()

    // 頭部 / 指標標記
    if (tracker && tracker.active) drawHeadMarker()

    // 球
    const b = state.ball
    if (b) {
      drawBall(ctx, {
        cx: b.x,
        cy: b.y,
        r: b.r,
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
  }

  function drawGoal() {
    const sx = goal.shake > 0 ? (Math.random() - 0.5) * goal.shake * 7 : 0
    const cx = goal.cx + sx
    const x0 = cx - goal.halfW
    const x1 = cx + goal.halfW
    const topY = goal.mouthY - goal.h
    const botY = goal.mouthY

    // 網
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'
    ctx.lineWidth = 1
    const cols = 9
    const rows = 6
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

    // 門柱 + 橫楣
    ctx.strokeStyle = '#f4f6f7'
    ctx.lineWidth = Math.max(5, goal.halfW * 0.06)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x0, botY)
    ctx.lineTo(x0, topY)
    ctx.lineTo(x1, topY)
    ctx.lineTo(x1, botY)
    ctx.stroke()
    // 門口提示線
    ctx.strokeStyle = 'rgba(255,211,61,0.6)'
    ctx.lineWidth = 2
    ctx.setLineDash([10, 8])
    ctx.beginPath()
    ctx.moveTo(x0, botY)
    ctx.lineTo(x1, botY)
    ctx.stroke()
    ctx.setLineDash([])
  }

  function drawHeadMarker() {
    const hr = tracker.headR || 56
    ctx.save()
    ctx.strokeStyle = 'rgba(255,211,61,0.9)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(tracker.x, tracker.y, hr, 0, Math.PI * 2)
    ctx.stroke()
    // 往上頂的箭頭提示（頭在球下方且球接近時）
    const b = state.ball
    if (b && b.y < tracker.y && Math.abs(b.x - tracker.x) < hr * 2 && b.y > goal.mouthY) {
      ctx.fillStyle = 'rgba(255,211,61,0.85)'
      const ax = tracker.x
      const ay = tracker.y - hr - 10
      ctx.beginPath()
      ctx.moveTo(ax, ay - 16)
      ctx.lineTo(ax - 11, ay)
      ctx.lineTo(ax + 11, ay)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
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
      <button class="btn ghost" id="home">${t('back')}</button>
    `
    o.querySelector('#retry').addEventListener('click', () => {
      hideOverlay()
      showOverlay(introOverlay())
    })
    o.querySelector('#home').addEventListener('click', () => showScreen(createHomeScreen))
    return o
  }

  // ---------- 啟動：攝影機 / 降級 ----------
  async function startCamera() {
    if (tracker) tracker.stop() // 重玩再選攝影機時，釋放上一個 tracker
    tracker = null
    showOverlay(loadingOverlay(t('hdLoading')))
    video.style.display = ''
    const cam = new CameraTracker(video)
    try {
      await cam.start()
      tracker = cam
      usingCamera = true
      beginGame()
    } catch (err) {
      // 拒絕授權 / 無鏡頭 / 模型載入失敗 → 降級
      cam.stop()
      video.style.display = 'none'
      showMsg(t('hdDenied'), 'bad')
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
    window.__hd = { state, goal, get tracker() { return tracker }, startPointer }
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
