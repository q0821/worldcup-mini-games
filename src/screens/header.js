// 模式二：頭鎚射門（攝影機 AR）。
// 球從遠方球門「朝你飛來」（由小變大撲面），你把頭（攝影機追蹤額頭）移到落點、
// 在球到臉前的瞬間「往上一頂」→ 球反向縮小飛向遠方球門得分。
// 用 2.5D 深度（z + 縮放）營造「迎來 → 頂走」的對撞頭鎚感。
// 攝影機不可用 / 拒絕授權 → 自動降級為手指 / 滑鼠控制頂球點，同一套迴圈。

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
const HEAD_UP_THRESH = 180 // 頭向上速度門檻 (px/s)，超過才算有效頂球
const T_IN = 1.5 // 來球飛行時間 (s)
const T_OUT = 0.85 // 頂出去飛向球門時間
const T_DROP = 0.9 // 沒頂到掉落時間
const FAR_SCALE = 0.32 // 遠方(球門處)球的縮放
const NEAR_SCALE = 1.0 // 到臉前的縮放
const CONTACT_FROM = 0.74 // 來球進度 > 此值才進入可頂擊窗

export function createHeaderScreen() {
  const el = document.createElement('div')
  el.className = 'screen'

  // video 作為攝影機來源（離屏渲染，畫進 canvas 統一座標）
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

  const goal = { cx: 0, halfW: 0, y: 0, h: 0, shake: 0 }
  const state = {
    raf: 0,
    last: 0,
    running: false,
    score: 0,
    timeLeft: GAME_SEC,
    ball: null,
    msgT: 0,
    flash: 0,
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
  const lerp = (a, b, p) => a + (b - a) * p

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    W = game.clientWidth
    H = game.clientHeight
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    goal.cx = W / 2
    goal.halfW = clamp(W * 0.17, 66, 140)
    goal.h = goal.halfW * 0.78
    goal.y = H * 0.15 // 遠方球門中心螢幕高度
  }

  // 一顆來球：從球門(遠、小、上) 飛向 落點(近、大、下)
  function newBall() {
    const baseR = Math.max(30, Math.min(W, H) * 0.085)
    const strikeX = lerp(W * 0.28, W * 0.72, Math.random())
    const strikeY = H * (0.52 + Math.random() * 0.12)
    return {
      phase: 'in', // in | out | drop
      t: 0,
      baseR,
      // 路徑端點（螢幕座標）
      x0: goal.cx,
      y0: goal.y,
      x1: strikeX,
      y1: strikeY,
      strikeX,
      strikeY,
      // 即時（render/collision 用）
      bx: goal.cx,
      by: goal.y,
      scale: FAR_SCALE,
      rot: 0,
      vrot: (Math.random() - 0.5) * 5,
      sq: 0,
      sqv: 0,
      squashAngle: 0,
      headed: false,
      goalX: 0, // out 階段最終落到球門平面的 x
      willScore: false,
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

  // ---------- 頂球：把球從 in 切到 out（飛向球門） ----------
  function headerBall(b, hx) {
    b.phase = 'out'
    b.t = 0
    b.x0 = b.bx
    b.y0 = b.by
    // 瞄準：頭頂到球的哪一側決定方向（頭偏左 → 球往右），加頭部水平動量
    const off = (b.bx - hx) * 1.1 + (tracker.vx || 0) * 0.12
    b.goalX = clamp(goal.cx + off, goal.cx - goal.halfW * 2.4, goal.cx + goal.halfW * 2.4)
    b.willScore = Math.abs(b.goalX - goal.cx) < goal.halfW - b.baseR * FAR_SCALE * 0.5
    b.x1 = b.goalX
    b.y1 = goal.y
    b.headed = true
    b.sqv += 6
    b.squashAngle = Math.PI / 2
    state.flash = 0.12
    sound.kick()
  }

  function missDrop(b) {
    b.phase = 'drop'
    b.t = 0
    b.x0 = b.bx
    b.y0 = b.by
    showMsg(t('hdMiss'), 'bad')
  }

  // ---------- 更新 ----------
  function update(dt) {
    if (state.msgT > 0) {
      state.msgT -= dt
      if (state.msgT <= 0) msgEl.classList.remove('show')
    }
    if (goal.shake > 0) goal.shake = Math.max(0, goal.shake - dt * 2.4)
    if (state.flash > 0) state.flash -= dt

    if (tracker) tracker.update(dt, W, H)
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
    // 擠壓彈簧
    b.sqv += (-900 * b.sq - 18 * b.sqv) * dt
    b.sq += b.sqv * dt
    b.sq = clamp(b.sq, -0.2, 0.2)

    if (b.phase === 'in') {
      const p = clamp(b.t / T_IN, 0, 1)
      const e = p * p // 加速逼近（撲面感）
      b.scale = lerp(FAR_SCALE, NEAR_SCALE, e)
      b.bx = lerp(b.x0, b.x1, p)
      b.by = lerp(b.y0, b.y1, p) - Math.sin(Math.PI * p) * H * 0.06 // 微弧線
      // 可頂擊窗：球接近臉時
      if (p >= CONTACT_FROM && tracker && tracker.active) {
        const rr = b.baseR * b.scale
        const hr = tracker.headR || 56
        const d = Math.hypot(b.bx - tracker.x, b.by - tracker.y)
        if (d < rr + hr) {
          if (tracker.vy < -HEAD_UP_THRESH) headerBall(b, tracker.x)
          else {
            // 碰到但沒往上頂 → 沒頂好，掉落
            b.sqv += 3
            b.squashAngle = Math.PI / 2
            sound.bounce()
            missDrop(b)
          }
        }
      }
      if (b.phase === 'in' && p >= 1) missDrop(b) // 沒接到
    } else if (b.phase === 'out') {
      const p = clamp(b.t / T_OUT, 0, 1)
      b.scale = lerp(NEAR_SCALE, FAR_SCALE, p)
      b.bx = lerp(b.x0, b.x1, p)
      b.by = lerp(b.y0, b.y1, p) - Math.sin(Math.PI * p) * H * 0.05
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
    } else if (b.phase === 'drop') {
      const p = clamp(b.t / T_DROP, 0, 1)
      b.by = lerp(b.y0, H + b.baseR * NEAR_SCALE, p * p)
      b.bx = b.x0 + (b.bx - b.x0)
      b.scale = NEAR_SCALE
      if (p >= 1) state.ball = newBall()
    }
  }

  // ---------- 繪製 ----------
  function render() {
    ctx.clearRect(0, 0, W, H)

    let drew = false
    if (usingCamera && tracker && tracker.drawVideo) drew = tracker.drawVideo(ctx, W, H)
    if (!drew) {
      const sky = ctx.createLinearGradient(0, 0, 0, H)
      sky.addColorStop(0, '#8fd0f2')
      sky.addColorStop(0.5, '#bfe6ff')
      sky.addColorStop(0.5, '#3f9b4b')
      sky.addColorStop(1, '#2e7a3a')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, W, H)
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.12)'
      ctx.fillRect(0, 0, W, H)
    }

    drawGoal()

    const b = state.ball
    // 落點提示（來球期間顯示目標環，引導把頭移過去）
    if (b && b.phase === 'in') drawStrikeTarget(b)

    // 頭部 / 指標標記
    if (tracker && tracker.active) drawHeadMarker(b)

    // 球
    if (b) {
      const r = b.baseR * b.scale
      drawBall(ctx, {
        cx: b.bx,
        cy: b.by,
        r,
        rotation: b.rot,
        sx: 1 - b.sq,
        sy: 1 + b.sq * 0.5,
        squashAngle: b.squashAngle,
      })
    }

    if (state.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${(state.flash / 0.12) * 0.2})`
      ctx.fillRect(0, 0, W, H)
    }
  }

  function drawGoal() {
    const sx = goal.shake > 0 ? (Math.random() - 0.5) * goal.shake * 6 : 0
    const cx = goal.cx + sx
    const x0 = cx - goal.halfW
    const x1 = cx + goal.halfW
    const topY = goal.y - goal.h / 2
    const botY = goal.y + goal.h / 2

    ctx.strokeStyle = 'rgba(255,255,255,0.38)'
    ctx.lineWidth = 1
    const cols = 7
    const rows = 4
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
    ctx.lineWidth = Math.max(4, goal.halfW * 0.075)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x0, botY)
    ctx.lineTo(x0, topY)
    ctx.lineTo(x1, topY)
    ctx.lineTo(x1, botY)
    ctx.stroke()
  }

  function drawStrikeTarget(b) {
    const p = clamp(b.t / T_IN, 0, 1)
    const a = 0.25 + 0.5 * p
    const r = lerp(46, 26, p) + Math.sin(b.t * 12) * 3
    ctx.save()
    ctx.strokeStyle = `rgba(255,211,61,${a})`
    ctx.lineWidth = 3
    ctx.setLineDash([6, 6])
    ctx.beginPath()
    ctx.arc(b.strikeX, b.strikeY, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()
  }

  function drawHeadMarker(b) {
    const hr = tracker.headR || 56
    ctx.save()
    // 在可頂擊窗時把環變亮、提示往上頂
    const hot = b && b.phase === 'in' && b.t / T_IN >= CONTACT_FROM
    ctx.strokeStyle = hot ? 'rgba(255,80,60,0.95)' : 'rgba(255,211,61,0.85)'
    ctx.lineWidth = hot ? 4 : 3
    ctx.beginPath()
    ctx.arc(tracker.x, tracker.y, hr, 0, Math.PI * 2)
    ctx.stroke()
    if (hot) {
      ctx.fillStyle = 'rgba(255,80,60,0.9)'
      const ax = tracker.x
      const ay = tracker.y - hr - 8
      ctx.beginPath()
      ctx.moveTo(ax, ay - 15)
      ctx.lineTo(ax - 10, ay)
      ctx.lineTo(ax + 10, ay)
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
