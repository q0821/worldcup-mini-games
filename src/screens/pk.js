// 模式三：PK 大賽（罰球對戰）。
//
// 射手回合（視角：球後方看球門）：
//   1. 點球門選射門落點（準星）→ 2. 力道條來回擺動，再點一下出腳。
//   力道條為連續力道：左段球慢易被撲 → 越右越強 → 完美區（黃）→ 過頭（紅）射飛。
//   難度差異 = 完美區寬度。香蕉球：力道條速度不均、球速較慢、弧線誇張會騙過門將。
// 門將回合（視角反轉：站在門裡看射手）：
//   射手助跑、出腳瞬間球門上出現「紅圈」標示來球落點，
//   必須在球到門前點到紅圈才算擋下（紅圈隨球接近縮小）。
//   直球快（反應窗短）、香蕉球慢（窗長、但球先彎向別處再回來）。
//   電腦球速隨機、也可能直接射飛。
// 標準 5 球制 + 提前判定 + 驟死賽。物理採公尺制（重力 / Magnus）。

import { t } from '../core/i18n.js'
import { sound } from '../core/sound.js'
import { showScreen } from '../core/screens.js'
import { icons } from '../core/icons.js'
import { submitScore } from '../core/storage.js'
import { bindShare } from '../core/share.js'
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
  makeRevView,
  renderBackgroundRev,
  drawGoalFrameRev,
  drawStriker,
  drawGloves,
  makeCrowd,
  drawCrowd,
} from './pkScene.js'

const G = 9.81
const KEEPER_Z = 10.8
const DIVE_DUR = 0.42
const RUN_DUR = 0.8
const AIM_WAIT = 1.2 // 門將回合：射手起跑前的等待

const DIFFS = {
  easy: {
    sweet: [0.56, 0.84], // 完美力道區（寬）
    meterHz: 0.7,
    keeperSide: 0.48, // 電腦門將判對方向機率
    keeperReach: 0.85,
    missChance: 0.16, // 電腦直接射偏機率
    cpuSpeed: [15, 21],
    cpuBanana: 0.22,
    cornerProb: 0.5,
    circleR: 0.115, // 紅圈半徑（佔畫面寬比例）
  },
  hard: {
    sweet: [0.64, 0.76], // 完美力道區（窄）
    meterHz: 1.1,
    keeperSide: 0.7,
    keeperReach: 1.0,
    missChance: 0.07,
    cpuSpeed: [18, 25],
    cpuBanana: 0.4,
    cornerProb: 0.85,
    circleR: 0.085,
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
    <div class="pk-meter" id="meter"><div class="zone" id="sweet"></div><i id="cursor"></i></div>
    <div class="pk-types" id="types">
      <button data-type="straight" class="on">${t('pkStraight')}</button>
      <button data-type="banana">${t('pkBanana')}</button>
    </div>
  `
  el.appendChild(hud)

  const $ = (id) => hud.querySelector('#' + id)
  const msgEl = $('msg')
  const hintEl = $('hint')
  const meterEl = $('meter')
  const sweetEl = $('sweet')
  const cursorEl = $('cursor')
  const typesEl = $('types')
  const kickLabel = $('kicklabel')

  // ---------- 畫布 / 投影 ----------
  const ctx = canvas.getContext('2d')
  let W = 0
  let H = 0
  let dpr = 1
  let cam = null
  let rev = null
  let bgFwd = null
  let bgRev = null
  let standsImg = null
  let crowdFwd = null
  let crowdRev = null
  const crowdAnim = { cheer: 0, sink: 0, time: 0 } // 觀眾情緒：歡呼跳動 / 往下坐
  const crowdLayer = document.createElement('canvas') // 離屏圖層，整批觀眾模糊一次
  const crowdCtx = crowdLayer.getContext('2d')

  const state = {
    raf: 0,
    last: 0,
    time: 0,
    diff: null,
    phase: 'menu', // menu | aim | power | keepAim | runup | fly | between | end
    phaseT: 0,
    pRes: [],
    cRes: [],
    sudden: false,
    playerShoots: true,
    ball: null,
    net: makeNet(),
    keeper: null, // 電腦門將（射手回合）
    striker: null, // 射手人物（門將回合）
    aimPoint: null, // 射手準星 { x, y }（球門平面世界座標）
    ballType: 'straight',
    meter: { ph: 0, v: 0 },
    shot: null, // { tx, ty, T, speed, banana }
    shotQuality: null, // weak | perfect | over
    cpuPlan: null,
    redCircle: null, // 門將回合：來球落點 { x, y }
    dive: null, // 玩家撲救 { t, sx, sy, hit }
    flyT: 0,
    netHit: false,
    shake: 0,
    kickFlash: 0,
    msgT: 0,
    overMsg: null,
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
  const gauss = () => Math.random() + Math.random() + Math.random() - 1.5

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    W = game.clientWidth
    H = game.clientHeight
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    cam = makeCamera(W, H)
    rev = makeRevView(W, H)
    bgFwd = renderBackground(cam, dpr, standsImg)
    bgRev = renderBackgroundRev(rev, dpr)
    crowdFwd = makeCrowd(W, cam.horizonY)
    crowdRev = makeCrowd(W, rev.horizonY)
    crowdLayer.width = canvas.width
    crowdLayer.height = canvas.height
    crowdCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  // 觀眾：畫到離屏層、再對整批一次模糊貼到主畫布（省效能、避免逐方塊 filter）
  function paintCrowd(crowd) {
    if (!crowd) return
    crowdCtx.clearRect(0, 0, W, H)
    drawCrowd(crowdCtx, crowd, crowdAnim)
    ctx.save()
    if (ctx.filter !== undefined) ctx.filter = 'blur(0.8px)'
    ctx.drawImage(crowdLayer, 0, 0, W, H)
    ctx.restore()
  }

  {
    const img = new Image()
    img.onload = () => {
      standsImg = img
      if (cam) bgFwd = renderBackground(cam, dpr, standsImg)
    }
    img.src = 'assets/bg/pk-stands.webp'
  }

  function newBall(atSpot) {
    return {
      x: 0,
      y: BALL_R,
      z: atSpot ? 0 : GOAL.z,
      vx: 0,
      vy: 0,
      vz: 0,
      aLat: 0,
      rot: 0,
      vrot: 0,
      sq: 0,
      sqv: 0,
      squashAngle: 0,
      live: false,
      crossed: false,
      isGoal: false,
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

  function showMsg(text, tone = '') {
    msgEl.textContent = text
    msgEl.className = 'pk-msg show ' + tone
    state.msgT = 1.3
    // 觀眾反應：好事 → 歡呼跳動；壞事 → 往下坐
    if (tone === 'good') {
      crowdAnim.cheer = 1
      crowdAnim.sink = 0
    } else if (tone === 'bad') {
      crowdAnim.sink = 1
      crowdAnim.cheer = 0
    }
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
    // 力道條外觀：弱(藍) → 強(橘) → 完美(黃) → 過大(紅)
    const [lo, hi] = state.diff.sweet
    sweetEl.style.left = `${lo * 100}%`
    sweetEl.style.width = `${(hi - lo) * 100}%`
    meterEl.style.background = `linear-gradient(90deg,
      rgba(105,192,255,0.8) 0%,
      rgba(255,157,61,0.85) ${lo * 100}%,
      rgba(255,157,61,0.85) ${hi * 100}%,
      rgba(231,76,60,0.9) ${hi * 100}%,
      rgba(231,76,60,0.9) 100%)`
    setupKick()
  }

  function setupKick() {
    const taken = state.pRes.length + state.cRes.length
    state.playerShoots = taken % 2 === 0
    state.aimPoint = null
    state.shot = null
    state.shotQuality = null
    state.cpuPlan = null
    state.redCircle = null
    state.dive = null
    state.flyT = 0
    state.netHit = false
    state.kickFlash = 0
    state.overMsg = null
    meterEl.classList.remove('show')
    renderBoard()

    if (state.playerShoots) {
      state.ball = newBall(true)
      state.keeper = {
        x: 0,
        z: KEEPER_Z,
        color: '#e8a200',
        pose: 'idle',
        t: 0,
        targetX: 0,
        targetY: 0.9,
        reach: 0,
      }
      state.striker = null
      state.phase = 'aim'
      setHint(t('pkPickZone'))
      typesEl.classList.add('show')
    } else {
      state.ball = newBall(false)
      state.keeper = null
      state.striker = { phase: 'wait', t: 0 }
      state.phase = 'keepAim'
      state.phaseT = 0
      setHint(t('pkPickSide'))
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
    meterEl.classList.remove('show')
  }

  function endMatch() {
    state.phase = 'end'
    const win = goals(state.pRes) > goals(state.cRes)
    submitScore('pk', goals(state.pRes)) // 記錄單場最高進球數
    sound.whistle(3)
    if (win) sound.crowd(2.2, 0.4)
    else sound.fail()
    showOverlay(endOverlay(win))
  }

  // ---------- 射手回合 ----------
  function pickAim(sx, sy) {
    const p = cam.unprojectGoal(sx, sy)
    // 需點在球門附近（含柱邊緣一點容差），太離譜的點忽略
    if (p.y < -0.4 || p.y > 3.6 || Math.abs(p.x) > 5) return
    state.aimPoint = { x: clamp(p.x, -3.5, 3.5), y: clamp(p.y, 0.12, 2.32) }
    sound.click()
    state.phase = 'power'
    state.meter.ph = 0
    meterEl.classList.add('show')
    setHint(t('pkLockPower'))
  }

  function lockPower() {
    const v = state.meter.v
    meterEl.classList.remove('show')
    typesEl.classList.remove('show')
    setHint('')
    playerFire(v)
  }

  function playerFire(powerV) {
    const d = state.diff
    const [lo, hi] = d.sweet
    const banana = state.ballType === 'banana'
    let tx = state.aimPoint.x
    let ty = state.aimPoint.y
    let speed
    let quality

    if (powerV > hi) {
      // 力道過大 → 射飛：超出越多偏越多
      const over = (powerV - hi) / (1 - hi)
      quality = 'over'
      ty += 0.8 + over * 2.2
      tx *= 1 + over * 0.5
      speed = 25 + over * 4
      state.overMsg = t('pkTooStrong')
    } else if (powerV >= lo) {
      // 完美力道：快、準
      quality = 'perfect'
      speed = banana ? 21 : 23.5
      tx += gauss() * 0.15
      ty += gauss() * 0.12
    } else {
      // 力道不足：bar 越左球越慢（連續），下沉、誤差大
      const w = powerV / lo // 0..1
      quality = 'weak'
      speed = 10 + 14 * Math.pow(w, 1.4)
      ty = Math.max(0.15, ty * (0.55 + 0.45 * w))
      tx += gauss() * 0.3
    }
    if (banana) speed -= 1.5 // 香蕉球速度差
    state.shotQuality = quality

    fireShot({ tx, ty, speed, banana, dir: 1 })

    // 電腦門將：直射讀真實落點、香蕉球讀「起始航向」→ 被弧線騙
    const T = state.shot.T
    const readX = banana ? tx - 0.5 * state.ball.aLat * T * T : tx
    const kp = state.keeper
    if (Math.random() < d.keeperSide) {
      kp.targetX = clamp(readX, -3.2, 3.2) * (0.8 + Math.random() * 0.3)
      kp.targetY = clamp(ty + gauss() * 0.45, 0.3, 2.0)
    } else {
      kp.targetX = -Math.sign(readX || 1) * (1.2 + Math.random() * 1.8) // 撲錯邊
      kp.targetY = 0.4 + Math.random() * 1.4
    }
    // 球越慢門將越來得及反應；完美力道則更難撲穩
    kp.reach = d.keeperReach * (1 + Math.max(0, 23 - speed) * 0.055) * (quality === 'perfect' ? 0.78 : 1)
    kp.commitAt = 0.1 + Math.random() * 0.08
  }

  // ---------- 門將回合 ----------
  function prepareCpuShot() {
    const d = state.diff
    let tx
    let ty
    if (Math.random() < d.cornerProb) {
      tx = (Math.random() < 0.5 ? -1 : 1) * (2.3 + Math.random())
      ty = Math.random() < 0.55 ? 0.25 + Math.random() * 0.7 : 1.5 + Math.random() * 0.7
    } else {
      tx = gauss() * 1.6
      ty = 0.3 + Math.random() * 1.6
    }
    if (Math.random() < d.missChance) {
      // 直接射飛
      if (Math.random() < 0.6) tx = Math.sign(tx || 1) * (3.9 + Math.random())
      else ty = 2.7 + Math.random() * 0.8
    }
    let speed = d.cpuSpeed[0] + Math.random() * (d.cpuSpeed[1] - d.cpuSpeed[0])
    const banana = Math.random() < d.cpuBanana
    if (banana) speed *= 0.72 // 香蕉球慢 → 反應窗較長
    state.cpuPlan = { tx, ty, speed, banana }
  }

  function cpuKick() {
    state.striker.phase = 'kick'
    state.striker.t = 0
    state.kickFlash = 0.14
    setHint(t('pkDiveTiming'))
    fireShot({ ...state.cpuPlan, dir: -1 })
    // 出腳瞬間亮出紅圈：來球的最終落點
    state.redCircle = { x: state.cpuPlan.tx, y: state.cpuPlan.ty }
  }

  function circleRadius() {
    // 紅圈隨球接近縮小（緊迫感），點擊判定用同一半徑
    const base = W * state.diff.circleR
    const prog = state.shot ? clamp(state.flyT / state.shot.T, 0, 1) : 0
    return base * (1.35 - 0.55 * prog)
  }

  function keeperTap(sx, sy) {
    if (state.phase !== 'fly' || state.dive || !state.redCircle || state.ball.crossed) return
    const p = rev.project(state.redCircle.x, state.redCircle.y, 0)
    const hit = Math.hypot(sx - p.x, sy - p.y) <= circleRadius()
    state.dive = { t: 0, sx, sy, hit }
    sound.thud()
  }

  // ---------- 出腳（共用） ----------
  // dir: 1 = 射手回合（z 0→11）、-1 = 門將回合（z 11→0 朝鏡頭）
  function fireShot({ tx, ty, speed, banana, dir }) {
    const b = state.ball
    const vz = speed * 0.97
    const T = GOAL.z / vz
    let aLat = 0
    if (banana) {
      const cdir = -(Math.sign(tx) || (Math.random() < 0.5 ? 1 : -1))
      aLat = cdir * (16 + 9 * (speed / 24)) // 誇張弧線
    }
    b.vz = dir * vz
    b.vx = (tx - b.x - 0.5 * aLat * T * T) / T
    b.vy = (ty - b.y + 0.5 * G * T * T) / T
    b.aLat = aLat
    b.vrot = (9 + Math.random() * 4) * dir
    b.live = true
    b.sqv += 4.5
    b.squashAngle = Math.atan2(-b.vy, b.vx)
    state.shot = { tx, ty, T, speed, banana }
    state.phase = 'fly'
    state.flyT = 0
    sound.kick()
  }

  // ---------- 過門線判定 ----------
  function resolveShooterCrossing() {
    const b = state.ball
    b.crossed = true
    const cx = b.x
    const cy = b.y

    const nearPost = Math.abs(Math.abs(cx) - GOAL.halfW) < 0.12 && cy < GOAL.height + 0.12
    const nearBar = Math.abs(cy - GOAL.height) < 0.12 && Math.abs(cx) < GOAL.halfW + 0.12
    if (nearPost || nearBar) {
      b.vz = -Math.abs(b.vz) * 0.35
      b.vx = (cx > 0 ? -1 : 1) * (2 + Math.random() * 2)
      b.aLat = 0
      sound.postHit()
      state.shake = 0.5
      showMsg(t('pkHitPost'), 'bad')
      record('miss')
      return
    }

    const inGoal = Math.abs(cx) < GOAL.halfW - 0.06 && cy < GOAL.height - 0.06
    if (!inGoal) {
      b.aLat = 0
      showMsg(state.overMsg || t('pkOffTarget'), 'bad')
      record('miss')
      return
    }

    // 門將撲救：距離制
    const kp = state.keeper
    const saved = Math.hypot(cx - kp.targetX, cy - kp.targetY) < kp.reach
    if (saved) {
      b.vz = -Math.abs(b.vz) * 0.28
      b.vx = Math.sign(cx - kp.targetX || 0.5) * (2.5 + Math.random() * 2)
      b.vy = Math.max(b.vy, 1.5)
      b.aLat = 0
      sound.thud()
      state.shake = 0.35
      showMsg(t('pkSavedByCpu'), 'bad')
      record('miss')
    } else {
      b.isGoal = true
      showMsg(t('pkGoalScored'), 'good')
      sound.crowd(1.6, 0.35)
      sound.point()
      record('goal')
    }
  }

  function resolveKeeperCrossing() {
    const b = state.ball
    b.crossed = true
    const inGoal = Math.abs(b.x) < GOAL.halfW - 0.06 && b.y < GOAL.height - 0.06

    if (!inGoal) {
      b.aLat = 0
      showMsg(t('pkCpuMissed'), 'good')
      record('miss')
      return
    }

    if (state.dive && state.dive.hit) {
      // 點中紅圈 → 擋下，球反彈回場內
      b.vz = 3 + Math.random() * 3
      b.vy = Math.max(b.vy, 2.5)
      b.vx = Math.sign(b.x || 0.5) * (2 + Math.random() * 2)
      b.aLat = 0
      sound.thud()
      state.shake = 0.35
      showMsg(t('pkYouSaved'), 'good')
      record('miss')
    } else {
      b.isGoal = true
      showMsg(t('pkConceded'), 'bad')
      sound.swish()
      record('goal')
    }
  }

  // ---------- 更新 ----------
  function update(dt) {
    state.time += dt
    state.phaseT += dt
    state.net.update(dt)
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 2.2)
    if (state.kickFlash > 0) state.kickFlash -= dt
    if (state.msgT > 0) {
      state.msgT -= dt
      if (state.msgT <= 0) msgEl.classList.remove('show')
    }

    // 力道條（香蕉球速度不均）
    if (state.phase === 'power') {
      const banana = state.ballType === 'banana'
      const mod = banana ? 0.45 + 1.15 * Math.pow(Math.sin(state.time * 2.9), 2) : 1
      state.meter.ph += dt * state.diff.meterHz * 2 * mod
      const ph = state.meter.ph % 2
      state.meter.v = ph < 1 ? ph : 2 - ph
      cursorEl.style.left = `${state.meter.v * 100}%`
    }

    // 門將回合節奏
    if (state.phase === 'keepAim' && state.phaseT >= AIM_WAIT) {
      state.phase = 'runup'
      state.phaseT = 0
      state.striker.phase = 'run'
      state.striker.t = 0
    }
    if (state.phase === 'runup') {
      state.striker.t = state.phaseT / RUN_DUR
      if (state.phaseT >= RUN_DUR) cpuKick()
    }
    if (state.striker && state.striker.phase === 'kick') state.striker.t += dt

    const kp = state.keeper
    if (kp && kp.pose === 'dive') kp.t = Math.min(1.4, kp.t + dt / DIVE_DUR)
    if (state.dive) state.dive.t = Math.min(1.4, state.dive.t + dt / 0.3)

    const b = state.ball
    if (b && b.live) {
      state.flyT += dt
      if (state.playerShoots && kp && kp.pose === 'idle' && state.flyT >= (kp.commitAt || 0.12)) {
        kp.pose = 'dive'
        kp.t = 0
      }
      b.vy -= G * dt
      if (!b.crossed && Math.abs(b.vz) > 0.5) b.vx += b.aLat * dt
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.z += b.vz * dt
      b.rot += b.vrot * dt

      b.sqv += (-900 * b.sq - 18 * b.sqv) * dt
      b.sq += b.sqv * dt
      b.sq = clamp(b.sq, -0.18, 0.18)

      if (!b.crossed) {
        if (state.playerShoots && b.z >= GOAL.z) resolveShooterCrossing()
        else if (!state.playerShoots && b.z <= 0.02) resolveKeeperCrossing()
      }

      if (state.playerShoots && b.isGoal && !state.netHit && b.z >= state.net.zBack(Math.max(0, b.y)) - 0.08) {
        state.netHit = true
        state.net.impact(b.x, clamp(b.y, 0, GOAL.height), 0.22 + Math.abs(b.vz) * 0.012)
        b.vz *= 0.08
        b.vx *= 0.25
        sound.swish()
      }

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
    if (state.playerShoots || state.phase === 'menu' || state.phase === 'end') renderShooterView()
    else renderKeeperView()
    ctx.restore()
  }

  function renderShooterView() {
    ctx.drawImage(bgFwd, 0, 0, W, H)
    if (!standsImg) paintCrowd(crowdFwd) // AI 看台圖時不疊
    drawGoalAndNet(ctx, cam, state.net)

    const b = state.ball
    const kp = state.keeper
    const ballVisible = b && b.z > -1.2
    if (ballVisible) {
      const sh = cam.project(b.x, 0, Math.min(b.z, GOAL.z + 1.4))
      const hN = clamp(1 - b.y / 3.2, 0.25, 1)
      ctx.fillStyle = `rgba(0,0,0,${0.26 * hN})`
      ctx.beginPath()
      ctx.ellipse(sh.x, sh.y, BALL_R * 2.4 * cam.K * sh.s * hN, BALL_R * 0.8 * cam.K * sh.s * hN, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    const ballBehind = b && b.z > KEEPER_Z
    if (ballVisible && ballBehind) paintBallFwd(b)
    if (kp) drawKeeper(ctx, cam, kp, state.time)
    if (ballVisible && !ballBehind) paintBallFwd(b)

    // 瞄準準星（選點與力道階段）
    if ((state.phase === 'aim' || state.phase === 'power') && state.aimPoint) {
      const p = cam.project(state.aimPoint.x, state.aimPoint.y, GOAL.z)
      const r = Math.max(10, cam.K * 0.045)
      ctx.strokeStyle = 'rgba(255,211,61,0.95)'
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        ctx.moveTo(p.x + dx * r * 0.55, p.y + dy * r * 0.55)
        ctx.lineTo(p.x + dx * r * 1.45, p.y + dy * r * 1.45)
      }
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,211,61,0.95)'
      ctx.beginPath()
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  function renderKeeperView() {
    ctx.drawImage(bgRev, 0, 0, W, H)
    paintCrowd(crowdRev)

    if (state.striker) drawStriker(ctx, rev, state.striker, state.time)

    const b = state.ball
    if (b && b.z > -0.5) {
      const sh = rev.project(b.x, 0, Math.max(0, b.z))
      ctx.fillStyle = 'rgba(0,0,0,0.25)'
      ctx.beginPath()
      ctx.ellipse(sh.x, sh.y, BALL_R * 2 * rev.Kx * sh.s, BALL_R * 0.8 * rev.Ky * sh.s, 0, 0, Math.PI * 2)
      ctx.fill()
      const p = rev.project(b.x, b.y, Math.max(-0.3, b.z))
      const r = Math.max(4, BALL_R * 2.0 * rev.Ky * p.s)
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

    // 出腳瞬間閃光
    if (state.kickFlash > 0 && b) {
      const p = rev.project(b.x, b.y, b.z)
      const a = state.kickFlash / 0.14
      ctx.fillStyle = `rgba(255,255,255,${a * 0.8})`
      ctx.beginPath()
      ctx.arc(p.x, p.y, rev.W * 0.1 * (1.6 - a), 0, Math.PI * 2)
      ctx.fill()
    }

    // 紅圈：來球落點，點到才擋得下（隨球接近縮小）
    if (state.redCircle && state.phase === 'fly' && !b.crossed) {
      const p = rev.project(state.redCircle.x, state.redCircle.y, 0)
      const r = circleRadius()
      const pulse = 1 + Math.sin(state.time * 14) * 0.04
      ctx.strokeStyle = 'rgba(231,60,50,0.95)'
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.arc(p.x, p.y, r * pulse, 0, Math.PI * 2)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(p.x, p.y, r * pulse * 0.82, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = 'rgba(231,60,50,0.15)'
      ctx.beginPath()
      ctx.arc(p.x, p.y, r * pulse, 0, Math.PI * 2)
      ctx.fill()
    }

    drawGoalFrameRev(ctx, rev)

    if (state.dive) drawGloves(ctx, rev, state.dive)
  }

  function paintBallFwd(b) {
    const p = cam.project(b.x, b.y, b.z)
    const r = Math.max(3, BALL_R * 1.35 * cam.K * p.s)
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
    // 觀眾情緒（不分階段都推進）：歡呼慢衰減、坐下快回復
    crowdAnim.time += dt
    crowdAnim.cheer = Math.max(0, crowdAnim.cheer - dt * 0.5)
    crowdAnim.sink = Math.max(0, crowdAnim.sink - dt * 0.7) // 沮喪退得慢一點
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

  canvas.addEventListener('pointerdown', (e) => {
    const [x, y] = pointerXY(e)
    sound.unlock()
    if (state.phase === 'aim') pickAim(x, y)
    else if (state.phase === 'power') lockPower()
    else if (!state.playerShoots && state.phase === 'fly') keeperTap(x, y)
  })

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
      <button class="btn share" id="share">${t('share')}</button>
      <button class="btn ghost" id="home">${t('back')}</button>
    `
    o.querySelector('#retry').addEventListener('click', () => {
      hideOverlay()
      showOverlay(menuOverlay())
      state.phase = 'menu'
    })
    o.querySelector('#home').addEventListener('click', () => showScreen(createHomeScreen))
    bindShare(o.querySelector('#share'), 'pk', goals(state.pRes))
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
      crowdAnim,
      aim: (x, y) => {
        if (state.phase !== 'aim') return false
        state.aimPoint = { x, y }
        state.phase = 'power'
        state.meter.ph = 0
        meterEl.classList.add('show')
        return true
      },
      lockPower: (v) => {
        if (state.phase !== 'power') return false
        state.meter.v = v
        lockPower()
        return true
      },
      tapCircle: () => {
        if (!state.redCircle) return false
        const p = rev.project(state.redCircle.x, state.redCircle.y, 0)
        keeperTap(p.x, p.y)
        return true
      },
    }
  }

  requestAnimationFrame(() => {
    resize()
    state.ball = newBall(true)
    state.keeper = { x: 0, z: KEEPER_Z, color: '#e8a200', pose: 'idle', t: 0, targetX: 0, targetY: 0.9, reach: 0 }
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
