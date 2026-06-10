// 模式三：PK 大賽（罰球對戰）。
// 玩家與電腦輪流射門：玩家拖曳瞄準（長度 = 力道、可選直射 / 香蕉球），
// 玩家當門將時點球門位置飛撲。標準 5 球制 + 提前判定 + 驟死賽。
// 物理採公尺制 3D 模擬（重力 / Magnus 側旋）再透視投影。

import { t } from '../core/i18n.js'
import { sound } from '../core/sound.js'
import { showScreen } from '../core/screens.js'
import { icons } from '../core/icons.js'
import { drawBall } from '../ball.js'
import { createHomeScreen } from './home.js'
import {
  GOAL,
  BALL_R,
  makeCamera,
  makeNet,
  renderBackground,
  drawGoalAndNet,
  drawKeeper,
} from './pkScene.js'

const G = 9.81 // m/s²
const KEEPER_Z = 10.8
const DIVE_DUR = 0.42 // 門將撲救動畫時長 (s)

// 難度參數
const DIFFS = {
  easy: {
    keeperSide: 0.5, // 電腦門將判對方向機率
    keeperReach: 0.85, // 撲救半徑 (m)
    cpuScatter: 0.5, // 電腦射門誤差 σ (m)
    cpuCorner: 0.45, // 電腦挑刁鑽角度機率
    cpuSpeed: [16, 21], // 電腦球速 (m/s)
    cueTruth: 0.75, // 預備動作提示為真的機率
  },
  hard: {
    keeperSide: 0.72,
    keeperReach: 1.02,
    cpuScatter: 0.26,
    cpuCorner: 0.82,
    cpuSpeed: [20, 26],
    cueTruth: 0.55,
  },
}

export function createPkScreen() {
  const el = document.createElement('div')
  el.className = 'screen'

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

  // HUD
  const hud = document.createElement('div')
  hud.className = 'hud'
  hud.innerHTML = `
    <div class="pk-board">
      <div class="row"><span class="name">${t('pkYou')}</span><span class="dots" id="pdots"></span><b id="pscore">0</b></div>
      <div class="row"><span class="name">${t('pkCpu')}</span><span class="dots" id="cdots"></span><b id="cscore">0</b></div>
    </div>
    <div class="pk-kicklabel" id="kicklabel"></div>
    <div class="pk-msg" id="msg"></div>
    <div class="pk-hint" id="hint"></div>
    <div class="pk-power" id="powerwrap"><i id="powerfill"></i></div>
    <div class="pk-types" id="types">
      <button data-type="straight" class="on">${t('pkStraight')}</button>
      <button data-type="banana">${t('pkBanana')}</button>
    </div>
  `
  el.appendChild(hud)

  const $ = (id) => hud.querySelector('#' + id)
  const msgEl = $('msg')
  const hintEl = $('hint')
  const powerWrap = $('powerwrap')
  const powerFill = $('powerfill')
  const typesEl = $('types')
  const kickLabel = $('kicklabel')

  // ---------- 狀態 ----------
  const ctx = canvas.getContext('2d')
  let W = 0
  let H = 0
  let dpr = 1
  let cam = null
  let bg = null
  let standsImg = null

  const state = {
    raf: 0,
    last: 0,
    time: 0,
    diff: null,
    phase: 'menu', // menu | aim | cue | fly | between | end
    phaseT: 0,
    pRes: [],
    cRes: [],
    sudden: false,
    playerShoots: true,
    ball: null,
    net: makeNet(),
    keeper: null,
    shot: null, // { tx, ty, T, banana } 本球資料
    cue: null, // { dir } 電腦射門提示
    flyT: 0,
    keeperCommitted: false,
    netHit: false,
    shake: 0,
    ballType: 'straight',
    msgT: 0,
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
  const gauss = () => Math.random() + Math.random() + Math.random() - 1.5 // 近似常態 (±1.5)

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    W = game.clientWidth
    H = game.clientHeight
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    cam = makeCamera(W, H)
    bg = renderBackground(cam, dpr, standsImg)
  }

  // AI 看台背景圖（若存在則替換程序繪製看台）
  {
    const img = new Image()
    img.onload = () => {
      standsImg = img
      if (cam) bg = renderBackground(cam, dpr, standsImg)
    }
    img.src = 'assets/bg/pk-stands.webp'
  }

  function newBall() {
    return {
      x: 0,
      y: BALL_R,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      aLat: 0, // Magnus 側向加速度
      rot: 0,
      vrot: 0,
      sq: 0,
      sqv: 0,
      squashAngle: 0,
      live: false, // 飛行中（尚未過門線）
      crossed: false,
      isGoal: false,
    }
  }

  function newKeeper(isPlayer) {
    return {
      x: 0,
      z: KEEPER_Z,
      color: isPlayer ? '#1f8a8a' : '#e8a200',
      pose: 'idle',
      t: 0,
      targetX: 0,
      targetY: 0.9,
      reach: 0,
      isPlayer,
    }
  }

  // ---------- 計分 ----------
  const goals = (arr) => arr.filter((r) => r === 'goal').length

  function renderBoard() {
    const render = (arr, elDots) => {
      let html = ''
      const shown = state.sudden ? arr.slice(5) : arr
      const total = state.sudden ? Math.max(shown.length + 1, 1) : 5
      for (let i = 0; i < total; i++) {
        const r = shown[i]
        html += `<i class="dot ${r === 'goal' ? 'goal' : r === 'miss' ? 'miss' : 'pending'}"></i>`
      }
      elDots.innerHTML = html
    }
    render(state.pRes, $('pdots'))
    render(state.cRes, $('cdots'))
    $('pscore').textContent = goals(state.pRes)
    $('cscore').textContent = goals(state.cRes)
    const kickNo = Math.min(state.pRes.length, state.cRes.length) + 1
    kickLabel.textContent = state.sudden ? t('pkSudden') : t('pkKickNo').replace('{n}', Math.min(5, kickNo))
  }

  function checkDecided() {
    const pG = goals(state.pRes)
    const cG = goals(state.cRes)
    const pT = state.pRes.length
    const cT = state.cRes.length
    if (!state.sudden) {
      if (pG > cG + (5 - cT) || cG > pG + (5 - pT)) return true
      if (pT === 5 && cT === 5) {
        if (pG !== cG) return true
        state.sudden = true
      }
      return false
    }
    return pT === cT && pG !== cG
  }

  // ---------- 訊息 ----------
  function showMsg(text, tone = '') {
    msgEl.textContent = text
    msgEl.className = 'pk-msg show ' + tone
    state.msgT = 1.3
  }

  function setHint(text) {
    hintEl.textContent = text || ''
  }

  // ---------- 流程 ----------
  function startMatch(diff) {
    state.diff = DIFFS[diff]
    state.pRes = []
    state.cRes = []
    state.sudden = false
    hideOverlay()
    sound.whistle(1)
    setupKick()
  }

  function setupKick() {
    const taken = state.pRes.length + state.cRes.length
    state.playerShoots = taken % 2 === 0
    state.ball = newBall()
    state.keeper = newKeeper(!state.playerShoots)
    state.shot = null
    state.cue = null
    state.flyT = 0
    state.keeperCommitted = false
    state.netHit = false
    renderBoard()

    if (state.playerShoots) {
      state.phase = 'aim'
      setHint(t('pkYouShoot'))
      powerWrap.classList.remove('show')
      typesEl.classList.add('show')
    } else {
      state.phase = 'cue'
      state.phaseT = 0
      setHint(t('pkYouKeep'))
      typesEl.classList.remove('show')
      prepareCpuShot()
    }
  }

  function record(result) {
    if (state.playerShoots) state.pRes.push(result)
    else state.cRes.push(result)
    renderBoard()
    state.phase = 'between'
    state.phaseT = 0
  }

  function endMatch() {
    state.phase = 'end'
    const win = goals(state.pRes) > goals(state.cRes)
    sound.whistle(3)
    if (win) sound.crowd(2.2, 0.4)
    else sound.fail()
    showOverlay(endOverlay(win))
  }

  // ---------- 玩家射門 ----------
  let aim = null // { sx, sy, x, y }

  function releaseShot(ax, ay) {
    const dxp = ax - aim.sx
    const dyp = ay - aim.sy
    const len = Math.hypot(dxp, dyp)
    aim = null
    powerWrap.classList.remove('show')
    if (len < 36 || dyp > -18) return // 太短或往下拖 → 取消

    const powerN = clamp(len / (H * 0.5), 0.18, 1)
    powerFill.style.width = '0%'

    // 瞄準點：放開位置反投影到球門平面
    const tgt = cam.unprojectGoal(ax, ay)
    let tx = clamp(tgt.x, -4.6, 4.6)
    let ty = clamp(tgt.y, 0.12, 3.4)

    const banana = state.ballType === 'banana'
    // 誤差：力道越大越不準，香蕉球再加成
    const sigma = 0.15 + 0.45 * powerN * powerN + (banana ? 0.2 : 0)
    tx += gauss() * sigma
    ty += gauss() * sigma * 0.65
    ty = Math.max(0.1, ty)

    fireShot({ tx, ty, speed: 13.5 + 13.5 * powerN, banana })

    // 電腦門將決策：直射讀真實落點、香蕉球讀「初速方向」→ 會被弧線騙
    const d = state.diff
    const sideRead = state.shot.banana ? Math.sign(state.ball.vx || 0.001) : Math.sign(tx || 0.001)
    let side
    if (Math.random() < d.keeperSide) side = sideRead
    else side = Math.random() < 0.7 ? -sideRead : 0
    const kp = state.keeper
    kp.targetX = side === 0 ? 0 : side * (1.5 + Math.random() * 1.7)
    kp.targetY = 0.4 + Math.random() * 1.5
    kp.reach = d.keeperReach * (state.shot.speed < 16.5 ? 1.3 : 1)
    kp.commitAt = 0.1 + Math.random() * 0.1
    typesEl.classList.remove('show')
    setHint('')
  }

  function fireShot({ tx, ty, speed, banana }) {
    const b = state.ball
    const vz = speed * 0.97
    const T = GOAL.z / vz
    let aLat = 0
    if (banana) {
      const dir = -(Math.sign(tx) || (Math.random() < 0.5 ? 1 : -1))
      aLat = dir * (5.5 + 5 * (speed / 27))
    }
    b.vz = vz
    b.vx = (tx - b.x - 0.5 * aLat * T * T) / T
    b.vy = (ty - b.y + 0.5 * G * T * T) / T
    b.aLat = aLat
    b.vrot = 9 + Math.random() * 4
    b.live = true
    b.sqv += 4.5
    b.squashAngle = Math.atan2(-b.vy, b.vx)
    state.shot = { tx, ty, T, speed, banana }
    state.phase = 'fly'
    state.flyT = 0
    sound.kick()
  }

  // ---------- 電腦射門 / 玩家撲救 ----------
  const CUE_DUR = 1.1

  function prepareCpuShot() {
    const d = state.diff
    const corner = Math.random() < d.cpuCorner
    const sx = Math.random() < 0.5 ? -1 : 1
    let tx = sx * (corner ? 2.5 + Math.random() * 0.85 : 0.7 + Math.random() * 1.7)
    let ty = Math.random() < 0.55 ? 0.2 + Math.random() * 0.8 : 1.2 + Math.random() * 1.0
    tx += gauss() * d.cpuScatter
    ty += gauss() * d.cpuScatter * 0.7
    ty = Math.max(0.1, ty)
    const speed = d.cpuSpeed[0] + Math.random() * (d.cpuSpeed[1] - d.cpuSpeed[0])
    const banana = Math.random() < (state.diff === DIFFS.hard ? 0.3 : 0.12)
    state.cpuPlan = { tx, ty, speed, banana }
    // 預備動作提示（不一定為真）
    const truth = Math.random() < d.cueTruth
    state.cue = { dir: truth ? Math.sign(tx || 1) : -Math.sign(tx || 1) }
    setHint(t('pkShootCue'))
  }

  function cpuKick() {
    state.cue = null
    setHint(t('pkYouKeep'))
    fireShot(state.cpuPlan)
  }

  function playerDive(sx, sy) {
    if (state.keeperCommitted) return
    const kp = state.keeper
    const tgt = cam.unprojectGoal(sx, sy)
    kp.targetX = clamp(tgt.x, -3.4, 3.4)
    kp.targetY = clamp(tgt.y, 0.2, 2.2)
    kp.pose = 'dive'
    kp.t = 0
    state.keeperCommitted = true
    // 越早撲到位範圍越大（提前賭方向有獎勵、最後一刻撲不到）
    if (state.phase === 'cue') {
      kp.reach = 1.18
    } else {
      const lateness = state.shot ? state.flyT / state.shot.T : 0
      kp.reach = 1.05 * clamp(1.3 - lateness, 0.3, 1.12)
    }
  }

  // ---------- 過門線判定 ----------
  function resolveCrossing() {
    const b = state.ball
    b.crossed = true
    const cx = b.x
    const cy = b.y
    const kp = state.keeper

    const nearPostX = Math.abs(Math.abs(cx) - GOAL.halfW) < 0.12 && cy < GOAL.height + 0.12
    const nearBar = Math.abs(cy - GOAL.height) < 0.12 && Math.abs(cx) < GOAL.halfW + 0.12
    const inGoal = Math.abs(cx) < GOAL.halfW - 0.06 && cy < GOAL.height - 0.06

    if (nearPostX || nearBar) {
      // 中柱彈出
      b.vz = -Math.abs(b.vz) * 0.35
      b.vx = (cx > 0 ? -1 : 1) * (2 + Math.random() * 2)
      b.aLat = 0
      sound.postHit()
      state.shake = 0.5
      showMsg(t('pkHitPost'), 'bad')
      record('miss')
      return
    }
    if (!inGoal) {
      b.aLat = 0
      showMsg(state.playerShoots ? t('pkOffTarget') : t('pkCpuMissed'), state.playerShoots ? 'bad' : 'good')
      record('miss')
      return
    }

    // 門將是否撲到：未出手的門將只守站位小範圍
    if (!kp.pose || kp.pose === 'idle') {
      kp.targetX = 0
      kp.targetY = 0.9
      kp.reach = kp.reach || 0.55
      if (Math.hypot(cx - 0, cy - 0.9) < 0.7) {
        kp.pose = 'dive'
        kp.t = 0
      }
    }
    const saved = Math.hypot(cx - kp.targetX, cy - kp.targetY) < (kp.reach || 0.9)

    if (saved) {
      if (kp.pose === 'idle') {
        kp.pose = 'dive'
        kp.t = 0
      }
      b.vz = -Math.abs(b.vz) * 0.28
      b.vx = Math.sign(cx - kp.targetX || 0.5) * (2.5 + Math.random() * 2)
      b.vy = Math.max(b.vy, 1.5)
      b.aLat = 0
      sound.thud()
      state.shake = 0.35
      showMsg(state.playerShoots ? t('pkSavedByCpu') : t('pkYouSaved'), state.playerShoots ? 'bad' : 'good')
      record('miss')
    } else {
      b.isGoal = true
      showMsg(state.playerShoots ? t('pkGoalScored') : t('pkConceded'), state.playerShoots ? 'good' : 'bad')
      if (state.playerShoots) sound.crowd(1.6, 0.35)
      sound.point()
      record('goal')
    }
  }

  // ---------- 物理更新 ----------
  function update(dt) {
    state.time += dt
    state.phaseT += dt
    state.net.update(dt)
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 2.2)
    if (state.msgT > 0) {
      state.msgT -= dt
      if (state.msgT <= 0) msgEl.classList.remove('show')
    }

    const kp = state.keeper
    if (kp && kp.pose === 'dive') kp.t = Math.min(1.4, kp.t + dt / DIVE_DUR)

    if (state.phase === 'cue') {
      if (state.phaseT >= CUE_DUR) cpuKick()
    }

    const b = state.ball
    if (b && b.live) {
      state.flyT += dt
      // 電腦門將起跳時機
      if (state.playerShoots && !state.keeperCommitted && state.flyT >= (kp.commitAt || 0.12)) {
        kp.pose = 'dive'
        kp.t = 0
        state.keeperCommitted = true
      }
      // 飛行積分
      b.vy -= G * dt
      if (!b.crossed && b.vz > 0.5) b.vx += b.aLat * dt
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.z += b.vz * dt
      b.rot += b.vrot * dt

      // 擠壓彈簧
      b.sqv += (-900 * b.sq - 18 * b.sqv) * dt
      b.sq += b.sqv * dt
      b.sq = clamp(b.sq, -0.18, 0.18)

      // 過門線
      if (!b.crossed && b.z >= GOAL.z) resolveCrossing()

      // 進球後撞網
      if (b.isGoal && !state.netHit && b.z >= state.net.zBack(Math.max(0, b.y)) - 0.08) {
        state.netHit = true
        state.net.impact(b.x, clamp(b.y, 0, GOAL.height), 0.22 + b.vz * 0.012)
        b.vz *= 0.08
        b.vx *= 0.25
        sound.swish()
      }

      // 地面反彈
      if (b.y < BALL_R && b.vy < 0) {
        b.y = BALL_R
        b.vy *= -0.42
        b.vx *= 0.82
        b.vz *= 0.9
        if (Math.abs(b.vy) > 0.8) {
          b.sqv += 2.2
          b.squashAngle = Math.PI / 2
        }
      }
    }

    if (state.phase === 'between' && state.phaseT >= 1.7) {
      if (checkDecided()) endMatch()
      else setupKick()
    }
  }

  // ---------- 繪製 ----------
  function render() {
    ctx.clearRect(0, 0, W, H)
    ctx.save()
    if (state.shake > 0) {
      const a = state.shake * 7
      ctx.translate((Math.random() - 0.5) * a, (Math.random() - 0.5) * a)
    }
    ctx.drawImage(bg, 0, 0, W, H)
    drawGoalAndNet(ctx, cam, state.net)

    const b = state.ball
    const kp = state.keeper

    // 球影
    if (b) {
      const sh = cam.project(b.x, 0, Math.min(b.z, GOAL.z + 1.4))
      const hN = clamp(1 - b.y / 3.2, 0.25, 1)
      ctx.fillStyle = `rgba(0,0,0,${0.26 * hN})`
      ctx.beginPath()
      ctx.ellipse(sh.x, sh.y, BALL_R * 2.4 * cam.K * sh.s * hN, BALL_R * 0.8 * cam.K * sh.s * hN, 0, 0, Math.PI * 2)
      ctx.fill()
    }

    const ballBehindKeeper = b && b.z > KEEPER_Z
    if (b && ballBehindKeeper) paintBall(b)
    if (kp) drawKeeper(ctx, cam, kp, state.time)
    if (b && !ballBehindKeeper) paintBall(b)

    // 拖曳瞄準輔助
    if (aim) {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'
      ctx.lineWidth = 2
      ctx.setLineDash([7, 7])
      ctx.beginPath()
      ctx.moveTo(aim.sx, aim.sy)
      ctx.lineTo(aim.x, aim.y)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.arc(aim.x, aim.y, 13, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(aim.x, aim.y, 2.5, 0, Math.PI * 2)
      ctx.fillStyle = '#fff'
      ctx.fill()
    }

    // 電腦預備動作提示箭頭
    if (state.cue) {
      const p = cam.project(state.cue.dir * 0.9, 0.5, 0.6)
      const a = 0.45 + 0.4 * Math.sin(state.phaseT * 9)
      ctx.fillStyle = `rgba(255,211,61,${a})`
      const sgn = state.cue.dir
      ctx.beginPath()
      ctx.moveTo(p.x + sgn * 22, p.y)
      ctx.lineTo(p.x - sgn * 8, p.y - 13)
      ctx.lineTo(p.x - sgn * 8, p.y + 13)
      ctx.closePath()
      ctx.fill()
    }

    ctx.restore()
  }

  function paintBall(b) {
    const p = cam.project(b.x, b.y, b.z)
    const r = Math.max(3, BALL_R * 1.35 * cam.K * p.s) // 視覺半徑略放大，太小看不清
    drawBall(ctx, {
      cx: p.x,
      cy: p.y,
      r,
      rotation: b.rot,
      sx: 1 - b.sq,
      sy: 1 + b.sq * 0.5,
      squashAngle: b.squashAngle,
    })
  }

  // ---------- 主迴圈 ----------
  function frame(now) {
    state.raf = requestAnimationFrame(frame)
    let dt = (now - state.last) / 1000
    state.last = now
    if (dt > 0.05) dt = 0.05
    if (state.phase !== 'menu' && state.phase !== 'end') update(dt)
    else {
      state.time += dt
      state.net.update(dt)
    }
    render()
  }

  // ---------- 輸入 ----------
  function pointerXY(e) {
    const rect = canvas.getBoundingClientRect()
    return [
      (e.touches ? e.touches[0].clientX : e.clientX) - rect.left,
      (e.touches ? e.touches[0].clientY : e.clientY) - rect.top,
    ]
  }

  function onDown(e) {
    const [x, y] = pointerXY(e)
    if (state.phase === 'aim') {
      aim = { sx: x, sy: y, x, y }
      powerWrap.classList.add('show')
    } else if (!state.playerShoots && (state.phase === 'cue' || (state.phase === 'fly' && !state.ball.crossed))) {
      sound.unlock()
      playerDive(x, y)
    }
  }
  function onMove(e) {
    if (!aim) return
    const [x, y] = pointerXY(e)
    aim.x = x
    aim.y = y
    const len = Math.hypot(x - aim.sx, y - aim.sy)
    powerFill.style.width = `${clamp(len / (H * 0.5), 0, 1) * 100}%`
  }
  function onUp(e) {
    if (!aim) return
    sound.unlock()
    releaseShot(aim.x, aim.y)
  }

  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)

  typesEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button')
    if (!btn) return
    state.ballType = btn.dataset.type
    typesEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn))
    sound.click()
  })

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

  function menuOverlay() {
    const o = document.createElement('div')
    o.className = 'overlay'
    o.innerHTML = `
      <h2>${t('mode3Title')}</h2>
      <p>${t('pkChooseDiff')}</p>
      <button class="btn" id="easy">${t('pkEasy')}</button>
      <button class="btn" id="hard">${t('pkHard')}</button>
    `
    o.querySelector('#easy').addEventListener('click', () => {
      sound.unlock()
      startMatch('easy')
    })
    o.querySelector('#hard').addEventListener('click', () => {
      sound.unlock()
      startMatch('hard')
    })
    return o
  }

  function endOverlay(win) {
    const o = document.createElement('div')
    o.className = 'overlay'
    o.innerHTML = `
      <h2>${win ? t('pkWin') : t('pkLose')}</h2>
      <p class="big">${goals(state.pRes)} : ${goals(state.cRes)}</p>
      <button class="btn" id="retry">${t('retry')}</button>
      <button class="btn ghost" id="home">${t('back')}</button>
    `
    o.querySelector('#retry').addEventListener('click', () => {
      hideOverlay()
      showOverlay(menuOverlay())
      state.phase = 'menu'
    })
    o.querySelector('#home').addEventListener('click', () => showScreen(createHomeScreen))
    return o
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

  // 自動測試掛鉤
  if (location.search.includes('fgtest')) {
    window.__pk = {
      state,
      shoot: (tx, ty, powerN = 0.8, type = 'straight') => {
        if (state.phase !== 'aim') return false
        state.ballType = type
        aim = { sx: W / 2, sy: H * 0.85, x: W / 2, y: H * 0.4 }
        const p = cam.project(tx, ty, GOAL.z)
        releaseShot(p.x, p.y - (powerN - 0.5) * 0) // 位置決定瞄準
        return true
      },
      dive: (x, y) => {
        const p = cam.project(x, y, GOAL.z)
        playerDive(p.x, p.y)
      },
    }
  }

  requestAnimationFrame(() => {
    resize()
    state.ball = newBall()
    state.keeper = newKeeper(false)
    renderBoard()
    showOverlay(menuOverlay())
    state.last = performance.now()
    state.raf = requestAnimationFrame(frame)
  })

  return {
    el,
    destroy() {
      cancelAnimationFrame(state.raf)
      ro.disconnect()
      if (window.__pk) delete window.__pk
    },
  }
}
