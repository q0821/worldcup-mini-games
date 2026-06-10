// 模式三：PK 大賽（罰球對戰）。
//
// 射手回合（視角：球後方看球門）：
//   1. 點九宮格選射門位置 → 2. 力道條來回擺動（甜蜜區小：過強射飛、過弱易被撲）
//   → 3. 再點一下出腳。香蕉球：力道條速度不均、球速較慢、但弧線會騙過門將。
// 門將回合（視角反轉：站在門裡看射手）：
//   猜九宮格選撲救位置 → 射手助跑、明確出腳瞬間 → 按「撲球」抓時機。
//   球的方向與速度每球不同，香蕉球弧線誇張、會中途換格。
// 標準 5 球制 + 提前判定 + 驟死賽。物理採公尺制（重力 / Magnus）。

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
  zoneCenter,
  zoneOf,
  drawGridFwd,
  makeRevView,
  renderBackgroundRev,
  drawGoalFrameRev,
  drawGridRev,
  drawStriker,
  drawGloves,
} from './pkScene.js'

const G = 9.81
const KEEPER_Z = 10.8
const DIVE_DUR = 0.42
const RUN_DUR = 0.8 // 射手助跑時長
const AIM_WAIT = 1.6 // 門將回合：選格子時間

const DIFFS = {
  easy: {
    sweet: [0.56, 0.8], // 力道條甜蜜區
    meterHz: 0.7, // 力道條來回頻率
    cpuZoneRead: 0.42, // 電腦門將猜對格機率
    cornerProb: 0.5, // 電腦射角落機率
    missChance: 0.16, // 電腦直接射偏機率
    cpuSpeed: [13, 19], // 電腦球速（速度差大 → 時機難抓）
    cpuBanana: 0.18,
  },
  hard: {
    sweet: [0.62, 0.78],
    meterHz: 1.1,
    cpuZoneRead: 0.66,
    cornerProb: 0.85,
    missChance: 0.07,
    cpuSpeed: [15, 23],
    cpuBanana: 0.38,
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
    <button class="pk-divebtn" id="divebtn">${t('pkDive')}</button>
  `
  el.appendChild(hud)

  const $ = (id) => hud.querySelector('#' + id)
  const msgEl = $('msg')
  const hintEl = $('hint')
  const meterEl = $('meter')
  const sweetEl = $('sweet')
  const cursorEl = $('cursor')
  const typesEl = $('types')
  const diveBtn = $('divebtn')
  const kickLabel = $('kicklabel')

  // ---------- 畫布 / 投影 ----------
  const ctx = canvas.getContext('2d')
  let W = 0
  let H = 0
  let dpr = 1
  let cam = null // 射手視角
  let rev = null // 門將視角
  let bgFwd = null
  let bgRev = null
  let standsImg = null

  const state = {
    raf: 0,
    last: 0,
    time: 0,
    diff: null,
    phase: 'menu', // menu | zone | power | keepAim | runup | fly | between | end
    phaseT: 0,
    pRes: [],
    cRes: [],
    sudden: false,
    playerShoots: true,
    ball: null,
    net: makeNet(),
    keeper: null, // 電腦門將（射手回合）
    striker: null, // 射手人物（門將回合）
    selZone: -1,
    ballType: 'straight',
    meter: { ph: 0, v: 0 },
    shot: null, // { T, quality, banana }
    cpuPlan: null,
    cpuZone: -1, // 電腦門將撲的格
    dive: null, // 玩家撲救 { t, zone, lead }
    flyT: 0,
    netHit: false,
    shake: 0,
    kickFlash: 0,
    msgT: 0,
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
      z: atSpot ? 0 : GOAL.z, // 門將回合球在罰球點 = 距門 11m
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
    const [lo, hi] = state.diff.sweet
    sweetEl.style.left = `${lo * 100}%`
    sweetEl.style.width = `${(hi - lo) * 100}%`
    setupKick()
  }

  function setupKick() {
    const taken = state.pRes.length + state.cRes.length
    state.playerShoots = taken % 2 === 0
    state.selZone = -1
    state.shot = null
    state.cpuPlan = null
    state.cpuZone = -1
    state.dive = null
    state.flyT = 0
    state.netHit = false
    state.kickFlash = 0
    meterEl.classList.remove('show')
    diveBtn.classList.remove('show')
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
      }
      state.striker = null
      state.phase = 'zone'
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
      diveBtn.classList.add('show')
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
    diveBtn.classList.remove('show')
  }

  function endMatch() {
    state.phase = 'end'
    const win = goals(state.pRes) > goals(state.cRes)
    sound.whistle(3)
    if (win) sound.crowd(2.2, 0.4)
    else sound.fail()
    showOverlay(endOverlay(win))
  }

  // ---------- 射手回合 ----------
  function pickZone(sx, sy) {
    const p = cam.unprojectGoal(sx, sy)
    const z = zoneOf(p.x, p.y)
    if (z < 0) return
    state.selZone = z
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
    const zc = zoneCenter(state.selZone)
    const banana = state.ballType === 'banana'
    let tx = zc.x
    let ty = zc.y
    let speed
    let quality

    if (powerV > hi) {
      // 射飛：超出越多偏越高越偏
      const over = (powerV - hi) / (1 - hi)
      quality = 'over'
      ty += 0.9 + over * 2.4
      tx *= 1 + over * 0.5
      speed = 24 + over * 5
      showMsgLater = t('pkTooStrong')
    } else if (powerV < lo) {
      // 力道不足：球慢、下沉、容易被撲
      const w = powerV / lo
      quality = 'weak'
      speed = 12 + 7 * w
      ty = Math.max(0.15, ty * (0.45 + 0.55 * w))
      tx = tx * (0.75 + 0.25 * w) + gauss() * 0.3
      showMsgLater = null
    } else {
      quality = 'sweet'
      speed = banana ? 20.5 : 23.5 // 香蕉球速度差：較慢
      tx += gauss() * 0.2
      ty += gauss() * 0.15
      showMsgLater = null
    }
    state.shotQuality = quality

    fireShot({ tx, ty, speed, banana, dir: 1 })

    // 電腦門將選格：直射讀真實落點、香蕉球讀「起始航向」→ 被誇張弧線騙
    const T = state.shot.T
    let readX = tx
    if (banana) readX = tx - 0.5 * state.ball.aLat * T * T // 無弧線時的落點 = 起始航向
    const read = zoneOf(clamp(readX, -3.4, 3.4), clamp(ty, 0.15, 2.3))
    if (Math.random() < d.cpuZoneRead && read >= 0) {
      state.cpuZone = read
    } else {
      // 猜錯：挑一個不同列的格子
      const col = ((read >= 0 ? read : 4) % 3) + (Math.random() < 0.5 ? 1 : 2)
      state.cpuZone = ((Math.random() * 3) | 0) * 3 + (col % 3)
    }
    const kc = zoneCenter(state.cpuZone)
    state.keeper.targetX = kc.x
    state.keeper.targetY = kc.y
    state.keeper.commitAt = 0.1 + Math.random() * 0.08
  }

  let showMsgLater = null

  // ---------- 門將回合 ----------
  function prepareCpuShot() {
    const d = state.diff
    const corners = [0, 2, 6, 8]
    let zone
    if (Math.random() < d.cornerProb) zone = corners[(Math.random() * 4) | 0]
    else zone = (Math.random() * 9) | 0
    const zc = zoneCenter(zone)
    let tx = zc.x + gauss() * 0.26
    let ty = Math.max(0.12, zc.y + gauss() * 0.2)
    if (Math.random() < d.missChance) {
      // 直接射偏
      if (Math.random() < 0.6) tx = Math.sign(tx || 1) * (3.9 + Math.random())
      else ty = 2.7 + Math.random() * 0.8
    }
    const speed = d.cpuSpeed[0] + Math.random() * (d.cpuSpeed[1] - d.cpuSpeed[0])
    const banana = Math.random() < d.cpuBanana
    state.cpuPlan = { tx, ty, speed, banana }
  }

  function cpuKick() {
    state.striker.phase = 'kick'
    state.striker.t = 0
    state.kickFlash = 0.14
    setHint(t('pkDiveTiming'))
    fireShot({ ...state.cpuPlan, dir: -1 }) // 朝鏡頭飛來
  }

  function selectKeepZone(sx, sy) {
    if (state.dive) return // 已出手
    const p = rev.unprojectGoal(sx, sy)
    const z = zoneOf(p.x, p.y)
    if (z < 0) return
    state.selZone = z
    sound.click()
  }

  function doDive() {
    if (state.dive) return
    sound.unlock()
    const zone = state.selZone >= 0 ? state.selZone : 4
    // 出腳時間差：球已飛 flyT，總飛行 T；提前 / 太晚都撲不到
    let lead
    if (state.phase === 'fly') lead = state.shot.T - state.flyT
    else lead = 99 // 還沒出腳就撲 → 太早
    state.dive = { t: 0, zone, lead }
    diveBtn.classList.remove('show')
    sound.thud()
  }

  // ---------- 出腳（共用） ----------
  // dir: 1 = 射手回合（z 0→11）、-1 = 門將回合（z 11→0，朝鏡頭）
  function fireShot({ tx, ty, speed, banana, dir }) {
    const b = state.ball
    const vz = speed * 0.97
    const T = GOAL.z / vz
    let aLat = 0
    if (banana) {
      // 誇張弧線：橫移可達一整格以上，會中途換格
      const cdir = -(Math.sign(tx) || (Math.random() < 0.5 ? 1 : -1))
      aLat = cdir * (16 + 9 * (speed / 24))
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

    const bz = zoneOf(cx, cy)
    if (bz < 0) {
      b.aLat = 0
      showMsg(showMsgLater || t('pkOffTarget'), 'bad')
      showMsgLater = null
      record('miss')
      return
    }

    // 門將撲救判定（九宮格制）
    let saved = false
    if (state.cpuZone === bz) {
      saved = true
      // 甜蜜力道射角落，仍有機率太刁鑽進球
      const isCorner = bz % 3 !== 1 && ((bz / 3) | 0) !== 1
      if (state.shotQuality === 'sweet' && isCorner && Math.random() < 0.3) saved = false
    } else if (state.shotQuality === 'weak' && state.cpuZone % 3 === bz % 3) {
      saved = true // 球太慢：同一直行就來得及撲
    }

    if (saved) {
      b.vz = -Math.abs(b.vz) * 0.28
      b.vx = Math.sign(cx - state.keeper.targetX || 0.5) * (2.5 + Math.random() * 2)
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
    const cx = b.x
    const cy = b.y
    const bz = zoneOf(cx, cy)

    if (bz < 0) {
      b.aLat = 0
      showMsg(t('pkCpuMissed'), 'good')
      record('miss')
      return
    }

    let saved = false
    let failMsg = null
    if (state.dive && state.dive.zone === bz) {
      const lead = state.dive.lead
      if (lead >= 0.04 && lead <= 0.55) saved = true
      else failMsg = lead > 0.55 ? t('pkTooEarly') : t('pkTooLate')
    }

    if (saved) {
      // 撲出：球反彈回場內
      b.vz = 3 + Math.random() * 3
      b.vy = Math.max(b.vy, 2.5)
      b.vx = Math.sign(cx || 0.5) * (2 + Math.random() * 2)
      b.aLat = 0
      sound.thud()
      state.shake = 0.35
      showMsg(t('pkYouSaved'), 'good')
      record('miss')
    } else {
      b.isGoal = true
      showMsg(failMsg || t('pkConceded'), 'bad')
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

    // 力道條
    if (state.phase === 'power') {
      const banana = state.ballType === 'banana'
      const mod = banana ? 0.45 + 1.15 * Math.pow(Math.sin(state.time * 2.9), 2) : 1
      state.meter.ph += dt * state.diff.meterHz * 2 * mod
      const ph = state.meter.ph % 2
      state.meter.v = ph < 1 ? ph : 2 - ph
      cursorEl.style.left = `${state.meter.v * 100}%`
    }

    // 門將回合節奏：選格 → 助跑 → 出腳
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
    if (state.dive) state.dive.t = Math.min(1.4, state.dive.t + dt / 0.32)

    const b = state.ball
    if (b && b.live) {
      state.flyT += dt
      // 電腦門將起跳
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

      // 進球撞網（射手視角才有網）
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
    drawGoalAndNet(ctx, cam, state.net)

    // 九宮格（選格 / 力道階段顯眼，飛行中淡出）
    if (state.phase === 'zone' || state.phase === 'power') drawGridFwd(ctx, cam, state.selZone, 0.85)
    else if (state.phase === 'fly') drawGridFwd(ctx, cam, -1, 0.18)

    const b = state.ball
    const kp = state.keeper
    const ballVisible = b && b.z > -1.2 // 球飛過相機平面後不再繪製（s 轉負會炸）
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
  }

  function renderKeeperView() {
    ctx.drawImage(bgRev, 0, 0, W, H)

    // 九宮格
    const gridAlpha = state.phase === 'fly' ? 0.4 : 0.75
    drawGridRev(ctx, rev, state.dive ? state.dive.zone : state.selZone, gridAlpha)

    // 射手
    if (state.striker) drawStriker(ctx, rev, state.striker, state.time)

    // 球
    const b = state.ball
    if (b && b.z > -0.5) {
      const sh = rev.project(b.x, 0, Math.max(0, b.z))
      ctx.fillStyle = 'rgba(0,0,0,0.25)'
      ctx.beginPath()
      ctx.ellipse(sh.x, sh.y, BALL_R * 3 * rev.Kx * sh.s, BALL_R * 1.1 * rev.Ky * sh.s, 0, 0, Math.PI * 2)
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

    // 出腳瞬間閃光（明確的射門時機提示）
    if (state.kickFlash > 0 && b) {
      const p = rev.project(b.x, b.y, b.z)
      const a = state.kickFlash / 0.14
      const fr = rev.W * 0.1 * (1.6 - a)
      ctx.fillStyle = `rgba(255,255,255,${a * 0.8})`
      ctx.beginPath()
      ctx.arc(p.x, p.y, fr, 0, Math.PI * 2)
      ctx.fill()
    }

    // 球門框（最前景，蓋在球之上）
    drawGoalFrameRev(ctx, rev)

    // 玩家手套
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
    if (state.phase === 'zone') pickZone(x, y)
    else if (state.phase === 'power') lockPower()
    else if (!state.playerShoots && (state.phase === 'keepAim' || state.phase === 'runup' || state.phase === 'fly')) {
      selectKeepZone(x, y)
    }
  })

  diveBtn.addEventListener('click', doDive)

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
      pickZone: (i) => {
        if (state.phase !== 'zone') return false
        state.selZone = i
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
      keepZone: (i) => {
        state.selZone = i
      },
      diveNow: () => doDive(),
    }
  }

  requestAnimationFrame(() => {
    resize()
    state.ball = newBall(true)
    state.keeper = { x: 0, z: KEEPER_Z, color: '#e8a200', pose: 'idle', t: 0, targetX: 0, targetY: 0.9 }
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
