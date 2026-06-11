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

import { t, tRandom } from '../core/i18n.js'
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
  drawNetRev,
  drawStriker,
  drawKeeperBack,
} from './pkScene.js'

const G = 9.81
const KEEPER_Z = 10.5
const DIVE_DUR = 0.42
const RUN_DUR = 0.8
const AIM_WAIT = 1.2 // 門將回合：射手起跑前的等待
// 三段擺動箭頭：方向 → 力道 → 曲度
const MAX_DIR = 0.62 // 方向擺動最大角 (rad，約 35°)
const DIR_HZ = 0.85 // 方向擺動頻率
const CURVE_HZ = 0.9 // 曲度擺動頻率
const MAX_LAT = 22 // 香蕉球最大側向加速度

const DIFFS = {
  easy: {
    sweet: [0.56, 0.84], // 完美力道區（寬）
    meterHz: 0.7,
    keeperSide: 0.48, // 電腦門將判對方向機率
    keeperReach: 0.85,
    missChance: 0.18, // 電腦直接射偏機率
    cpuSpeed: [11, 15], // 球速放慢 → 反應窗較長、好擋
    cpuBanana: 0.18,
    cornerProb: 0.45,
    circleRm: 1.1, // 紅圈半徑（公尺，依球門比例投影 → 跨裝置一致）
  },
  hard: {
    sweet: [0.64, 0.76], // 完美力道區（窄）
    meterHz: 1.1,
    keeperSide: 0.7,
    keeperReach: 1.0,
    missChance: 0.08,
    cpuSpeed: [15, 20],
    cpuBanana: 0.38,
    cornerProb: 0.82,
    circleRm: 0.78,
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
  `
  el.appendChild(hud)

  const $ = (id) => hud.querySelector('#' + id)
  const msgEl = $('msg')
  const hintEl = $('hint')
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
  // 夜景背景：直式 / 橫式各一組，依畫面長寬比挑選（cut = 圖中草地分界線比例，實測）
  const BG = {
    fwdP: { src: 'assets/bg/pk-night.webp', cut: 0.495, img: null },
    fwdL: { src: 'assets/bg/pk-night-l.webp', cut: 0.518, img: null },
    revP: { src: 'assets/bg/pk-night-rev.webp', cut: 0.486, img: null },
    revL: { src: 'assets/bg/pk-night-rev-l.webp', cut: 0.519, img: null },
  }
  // 取用中的背景：橫式優先用橫式圖，沒載到就退直式（再不行退程序繪製）
  const pickBg = (kind) => {
    const wide = W > H
    const a = BG[kind + (wide ? 'L' : 'P')]
    const b = BG[kind + (wide ? 'P' : 'L')]
    return a.img ? a : b.img ? b : a
  }
  const crowdAnim = { cheer: 0, sink: 0, time: 0 } // 看台情緒：進球變亮(歡呼) / 沒進變暗(沮喪)

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
    // 三段擺動箭頭
    arrow: { ph: 0, dir: 0, power: 0, curve: 0 },
    lockedDir: 0,
    lockedPower: 0,
    lockedCurve: 0,
    shot: null, // { tx, ty, T, speed }
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
    const f = pickBg('fwd')
    const r = pickBg('rev')
    bgFwd = renderBackground(cam, dpr, f.img, f.cut)
    bgRev = renderBackgroundRev(rev, dpr, r.img, r.cut)
  }

  // 觀眾情緒：圖內已有觀眾，這裡只在看台區疊亮度／暗度——進球時看台變亮(歡呼)、沒進變暗(沮喪)
  // 夜場加碼：看台上隨機閃爍的相機閃光燈（平時零星、歡呼時密集）
  function drawCrowdMood(hzY) {
    if (crowdAnim.cheer > 0.01) {
      const a = 0.22 * crowdAnim.cheer * (0.85 + 0.15 * Math.sin(crowdAnim.time * 12)) // 微閃爍像在跳
      ctx.fillStyle = `rgba(255,236,150,${a})`
      ctx.fillRect(0, 0, W, hzY)
    }
    if (crowdAnim.sink > 0.01) {
      ctx.fillStyle = `rgba(0,6,24,${0.36 * crowdAnim.sink})`
      ctx.fillRect(0, 0, W, hzY)
    }
    const flashes = Math.round(3 + 26 * crowdAnim.cheer)
    for (let i = 0; i < flashes; i++) {
      if (Math.random() > 0.5) continue // 一半機率閃，避免均勻感
      const x = Math.random() * W
      const y = hzY * (0.12 + Math.random() * 0.82)
      const r = 0.6 + Math.random() * 1.6
      ctx.fillStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.6})`
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // ---------- 彩帶（進球 / 獲勝時自頂落下） ----------
  const confetti = []
  const CONFETTI_COLORS = ['#ffd33d', '#f0533f', '#3f8ef0', '#2ecc71', '#f7f7f5']
  function spawnConfetti(n) {
    for (let i = 0; i < n; i++) {
      confetti.push({
        x: Math.random() * W,
        y: -20 - Math.random() * H * 0.25,
        vx: (Math.random() - 0.5) * 50,
        vy: 90 + Math.random() * 160,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 9,
        w: 3.5 + Math.random() * 4,
        h: 6 + Math.random() * 7,
        sway: Math.random() * Math.PI * 2,
        color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
      })
    }
  }
  function updateConfetti(dt) {
    for (let i = confetti.length - 1; i >= 0; i--) {
      const c = confetti[i]
      c.x += (c.vx + Math.sin(state.time * 3 + c.sway) * 36) * dt
      c.y += c.vy * dt
      c.rot += c.vrot * dt
      if (c.y > H + 24) confetti.splice(i, 1)
    }
  }
  function drawConfetti() {
    for (const c of confetti) {
      ctx.save()
      ctx.translate(c.x, c.y)
      ctx.rotate(c.rot)
      ctx.fillStyle = c.color
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h)
      ctx.restore()
    }
  }

  {
    // 預載四張夜景背景；任何一張載入完成就重建對應視角的底圖（載不到則退程序繪製夜景）
    for (const key of Object.keys(BG)) {
      const entry = BG[key]
      const im = new Image()
      im.onload = () => {
        entry.img = im
        if (!cam) return
        if (key.startsWith('fwd')) {
          const f = pickBg('fwd')
          bgFwd = renderBackground(cam, dpr, f.img, f.cut)
        } else {
          const r = pickBg('rev')
          bgRev = renderBackgroundRev(rev, dpr, r.img, r.cut)
        }
      }
      im.src = entry.src
    }
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
      prevSX: null, // 上一幀的螢幕 x（旋轉 = 螢幕位移 ÷ 螢幕半徑，同顛球模式）
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
    // 觀眾反應：好事 → 歡呼跳動 + 彩帶；壞事 → 往下坐
    if (tone === 'good') {
      crowdAnim.cheer = 1
      crowdAnim.sink = 0
      spawnConfetti(70)
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
    setupKick()
  }

  function setupKick() {
    const taken = state.pRes.length + state.cRes.length
    state.playerShoots = taken % 2 === 0
    state.shot = null
    state.shotQuality = null
    state.cpuPlan = null
    state.redCircle = null
    state.dive = null
    state.flyT = 0
    state.netHit = false
    state.kickFlash = 0
    state.overMsg = null
    state.arrow.ph = 0
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
      state.phase = 'aimDir' // 第一段：左右擺動定方向
      setHint(t('pkAimDir'))
    } else {
      state.ball = newBall(false)
      state.keeper = null
      state.striker = { phase: 'wait', t: 0 }
      state.phase = 'keepAim'
      state.phaseT = 0
      setHint(t('pkPickSide'))
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
    setHint('')
    const win = goals(state.pRes) > goals(state.cRes)
    submitScore('pk', goals(state.pRes)) // 記錄單場最高進球數
    sound.whistle(3)
    if (win) {
      sound.crowd(2.2, 0.4)
      crowdAnim.cheer = 1
      spawnConfetti(180)
    } else sound.fail()
    showOverlay(endOverlay(win))
  }

  // ---------- 射手回合：三段擺動箭頭（點擊鎖定）----------
  // 點一下 → 鎖定當前擺動值，進下一段；第三段鎖定後直接射出。
  function advanceAim() {
    if (state.phase === 'aimDir') {
      state.lockedDir = state.arrow.dir
      sound.click()
      state.phase = 'aimPower'
      state.arrow.ph = 0
      setHint(t('pkLockPower'))
    } else if (state.phase === 'aimPower') {
      state.lockedPower = state.arrow.power
      sound.click()
      state.phase = 'aimCurve'
      state.arrow.ph = 0
      setHint(t('pkAimCurve'))
    } else if (state.phase === 'aimCurve') {
      state.lockedCurve = state.arrow.curve
      setHint('')
      playerFire(state.lockedDir, state.lockedPower, state.lockedCurve)
    }
  }

  function playerFire(dirAngle, powerV, curveV) {
    const d = state.diff
    const [lo, hi] = d.sweet
    let tx = (dirAngle / MAX_DIR) * 4.6 // 方向角 → 球門平面落點 x（±4.6，比球門寬可射偏）
    let ty = 1.05 // 方向只決定左右，高度固定（力道過大才會飛高）
    let speed
    let quality

    if (powerV > hi) {
      const over = (powerV - hi) / (1 - hi)
      quality = 'over'
      ty += 0.8 + over * 2.0
      tx *= 1 + over * 0.35
      speed = 25 + over * 4
      state.overMsg = t('pkTooStrong')
    } else if (powerV >= lo) {
      quality = 'perfect'
      speed = 23.5
      tx += gauss() * 0.15
    } else {
      const w = powerV / lo
      quality = 'weak'
      speed = 10 + 14 * Math.pow(w, 1.4)
      ty = Math.max(0.2, ty * (0.5 + 0.5 * w))
      tx += gauss() * 0.3
    }
    // 曲度 → 側向加速度。負號讓「箭頭往右彎」對應「球軌跡往右凸」（物理上球先反向起步再彎回）
    const aLat = -curveV * MAX_LAT
    state.shotQuality = quality

    fireShot({ tx, ty, speed, aLat, dir: 1 })

    // 電腦門將：讀「起始航向」（不含弧線的落點）→ 香蕉球會騙過它
    const T = state.shot.T
    const readX = tx - 0.5 * aLat * T * T
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
    let aLat = 0
    if (Math.random() < d.cpuBanana) {
      speed *= 0.72 // 香蕉球慢 → 反應窗較長
      const cdir = -(Math.sign(tx) || (Math.random() < 0.5 ? 1 : -1))
      aLat = cdir * (16 + 9 * (speed / 24))
    }
    state.cpuPlan = { tx, ty, speed, aLat }
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
    // 紅圈隨球接近縮小（緊迫感），點擊判定用同一半徑。
    // 半徑以公尺定義、用 rev.Kx 投影成像素 → 手機 / 桌機比例一致（不再綁螢幕寬）
    const base = state.diff.circleRm * rev.Kx
    const prog = state.shot ? clamp(state.flyT / state.shot.T, 0, 1) : 0
    return base * (1.4 - 0.4 * prog)
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
  function fireShot({ tx, ty, speed, aLat = 0, dir }) {
    const b = state.ball
    const vz = speed * 0.97
    const T = GOAL.z / vz
    b.vz = dir * vz
    b.vx = (tx - b.x - 0.5 * aLat * T * T) / T // 解初速：球起步偏一側、弧線彎回 tx
    b.vy = (ty - b.y + 0.5 * G * T * T) / T
    b.aLat = aLat
    b.prevSX = null
    b.live = true
    b.sqv += 4.5
    b.squashAngle = Math.atan2(-b.vy, b.vx)
    state.shot = { tx, ty, T, speed }
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
      showMsg(tRandom('pkMsgPost'), 'bad')
      record('miss')
      return
    }

    const inGoal = Math.abs(cx) < GOAL.halfW - 0.06 && cy < GOAL.height - 0.06
    if (!inGoal) {
      b.aLat = 0
      showMsg(tRandom('pkMsgOver'), 'bad')
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
      showMsg(tRandom('pkMsgSaved'), 'bad')
      record('miss')
    } else {
      b.isGoal = true
      // 決勝球偵測：這球進後電腦追不上 → 救世主
      const pG = goals(state.pRes) + 1
      const cLeft = state.sudden ? 0 : 5 - state.cRes.length
      const clutch = state.sudden || pG > goals(state.cRes) + cLeft
      showMsg(tRandom(clutch ? 'pkMsgGoalClutch' : 'pkMsgGoal'), 'good')
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
      showMsg(tRandom('pkMsgCpuMissed'), 'good')
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
      showMsg(tRandom('pkMsgSave'), 'good')
      record('miss')
    } else {
      b.isGoal = true
      showMsg(tRandom('pkMsgConcede'), 'bad')
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

    // 三段擺動箭頭：方向（正弦左右擺）→ 力道（三角波 0~1）→ 曲度（正弦左彎~右彎）
    if (state.phase === 'aimDir') {
      state.arrow.ph += dt * DIR_HZ * Math.PI * 2
      state.arrow.dir = Math.sin(state.arrow.ph) * MAX_DIR
    } else if (state.phase === 'aimPower') {
      state.arrow.ph += dt * state.diff.meterHz * 2
      const ph = state.arrow.ph % 2
      state.arrow.power = ph < 1 ? ph : 2 - ph
    } else if (state.phase === 'aimCurve') {
      state.arrow.ph += dt * CURVE_HZ * Math.PI * 2
      state.arrow.curve = Math.sin(state.arrow.ph)
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

      // 旋轉 = 螢幕水平位移 ÷ 螢幕半徑（與顛球模式一致的「滾動感」）：
      // 直射幾乎不轉、香蕉球隨弧線明顯旋轉、彈地滾動方向正確
      {
        let p
        let r
        if (state.playerShoots) {
          p = cam.project(b.x, b.y, b.z)
          r = Math.max(3, BALL_R * 1.35 * cam.K * p.s)
        } else {
          p = rev.project(b.x, b.y, Math.max(-1.4, b.z))
          r = Math.max(5, BALL_R * 2.2 * rev.Ky * p.s)
        }
        if (b.prevSX !== null) b.rot += (p.x - b.prevSX) / r
        b.prevSX = p.x
      }

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
      // 門將回合失球：球撞上背網（rev 座標的網在 z = GOAL.z - zBack(y)，為負值）
      // 衝擊放大 1.6 倍：網面朝鏡頭凸起是這個視角的主要戲劇效果
      if (
        !state.playerShoots &&
        b.isGoal &&
        !state.netHit &&
        b.z <= GOAL.z - state.net.zBack(Math.max(0, b.y)) + 0.08
      ) {
        state.netHit = true
        state.net.impact(b.x, clamp(b.y, 0, GOAL.height), (0.22 + Math.abs(b.vz) * 0.012) * 1.6)
        b.vz *= 0.08
        b.vx *= 0.25
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
    drawConfetti()
  }

  function renderShooterView() {
    ctx.drawImage(bgFwd, 0, 0, W, H)
    drawCrowdMood(cam.horizonY) // 看台區情緒亮度
    drawGoalAndNet(ctx, cam, state.net)

    const b = state.ball
    const kp = state.keeper
    const ballVisible = b && b.z > -1.2
    if (ballVisible) {
      // 影子（同顛球模式邏輯）：越高 → 越大、越模糊、越淡；貼地 → 小而銳利深色。
      // 投影 z 與球本體一致（不夾限），射飛 / 入網後影子才會跟著球走；
      // 過門線後逐漸淡出（網內 / 門後視覺上被遮光）
      const fadeBehind = clamp(1 - (b.z - GOAL.z) / 1.8, 0, 1)
      if (fadeBehind > 0.02) {
        const sh = cam.project(b.x, 0, b.z)
        const rG = Math.max(3, BALL_R * 1.35 * cam.K * sh.s)
        const hN = clamp(b.y / 2.2, 0, 1)
        ctx.save()
        if (ctx.filter !== undefined) ctx.filter = `blur(${(1 + hN * 8).toFixed(1)}px)`
        ctx.globalAlpha = 0.34 * (1 - hN * 0.7) * fadeBehind
        ctx.fillStyle = '#000'
        ctx.beginPath()
        ctx.ellipse(sh.x, sh.y, rG * (0.95 + hN * 0.95), rG * (0.95 + hN * 0.95) * 0.32, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }
    const ballBehind = b && b.z > KEEPER_Z
    if (ballVisible && ballBehind) paintBallFwd(b)
    if (kp) drawKeeper(ctx, cam, kp, state.time)
    if (ballVisible && !ballBehind) paintBallFwd(b)

    // 三段擺動箭頭
    if (state.phase === 'aimDir' || state.phase === 'aimPower' || state.phase === 'aimCurve') {
      drawAimArrow()
    }
  }

  // 從球往球門方向的箭頭：方向(角度) / 力道(填滿量+甜蜜區色) / 曲度(彎曲)
  function drawAimArrow() {
    const ph = state.phase
    const dirA = ph === 'aimDir' ? state.arrow.dir : state.lockedDir
    const power = ph === 'aimPower' ? state.arrow.power : ph === 'aimCurve' ? state.lockedPower : 1
    const curve = ph === 'aimCurve' ? state.arrow.curve : 0
    const [lo, hi] = state.diff.sweet

    const base = cam.project(0, BALL_R, 0)
    const L = H * 0.26
    // 方向：dirA=0 朝正上；正=右、負=左
    const ux = Math.sin(dirA)
    const uy = -Math.cos(dirA)
    const tipX = base.x + ux * L
    const tipY = base.y + uy * L
    // 曲度 → 控制點側偏（垂直於箭頭方向）
    const px = -uy
    const py = ux
    const bend = curve * L * 0.55
    const cxp = (base.x + tipX) / 2 + px * bend
    const cyp = (base.y + tipY) / 2 + py * bend

    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // 底層灰桿
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.lineWidth = 16
    ctx.beginPath()
    ctx.moveTo(base.x, base.y)
    ctx.quadraticCurveTo(cxp, cyp, tipX, tipY)
    ctx.stroke()

    // 力道填滿：依甜蜜區上色（不足=橘、完美=黃、過大=紅）
    let fillCol = 'rgba(255,211,61,0.95)'
    if (ph === 'aimPower') {
      fillCol = power > hi ? 'rgba(231,76,60,0.95)' : power >= lo ? 'rgba(255,211,61,0.98)' : 'rgba(255,157,61,0.95)'
    } else {
      fillCol = 'rgba(255,211,61,0.98)'
    }
    // 沿 quadratic 曲線取樣，畫出前 frac 比例的填滿段
    const seg = (frac) => {
      ctx.beginPath()
      ctx.moveTo(base.x, base.y)
      const steps = 20
      for (let i = 1; i <= steps; i++) {
        const tt = (i / steps) * frac
        const mx = (1 - tt) * (1 - tt) * base.x + 2 * (1 - tt) * tt * cxp + tt * tt * tipX
        const my = (1 - tt) * (1 - tt) * base.y + 2 * (1 - tt) * tt * cyp + tt * tt * tipY
        ctx.lineTo(mx, my)
      }
      ctx.stroke()
    }
    ctx.strokeStyle = fillCol
    ctx.lineWidth = 11
    seg(ph === 'aimPower' ? Math.max(0.02, power) : 1)

    // 甜蜜區刻度（力道段顯示）
    if (ph === 'aimPower') {
      for (const m of [lo, hi]) {
        const mx = (1 - m) * (1 - m) * base.x + 2 * (1 - m) * m * cxp + m * m * tipX
        const my = (1 - m) * (1 - m) * base.y + 2 * (1 - m) * m * cyp + m * m * tipY
        ctx.fillStyle = '#fff'
        ctx.beginPath()
        ctx.arc(mx, my, 4, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // 箭頭頭部（沿切線方向）
    const tx = tipX - cxp
    const ty = tipY - cyp
    const ang = Math.atan2(ty, tx)
    ctx.fillStyle = fillCol
    ctx.translate(tipX, tipY)
    ctx.rotate(ang)
    ctx.beginPath()
    ctx.moveTo(14, 0)
    ctx.lineTo(-8, -12)
    ctx.lineTo(-8, 12)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  // 門將視角（門後轉播鏡頭）繪製順序：
  // 背景 → 看台情緒 → 射手 → 場內球 → 門框 → 門將背影 → 門內球 → 前景背網 → 紅圈 → 特效
  function renderKeeperView() {
    ctx.drawImage(bgRev, 0, 0, W, H)
    drawCrowdMood(rev.horizonY)

    if (state.striker) drawStriker(ctx, rev, state.striker, state.time)

    const b = state.ball
    const paintBallRev = () => {
      // 影子（同顛球模式邏輯）：高度決定大小 / 模糊 / 透明度
      const sh = rev.project(b.x, 0, Math.max(-1.4, b.z))
      const rG = Math.max(4, BALL_R * 2.2 * rev.Kx * sh.s)
      const hN = clamp(b.y / 2.2, 0, 1)
      ctx.save()
      if (ctx.filter !== undefined) ctx.filter = `blur(${(1 + hN * 8).toFixed(1)}px)`
      ctx.globalAlpha = 0.34 * (1 - hN * 0.7)
      ctx.fillStyle = '#000'
      ctx.beginPath()
      ctx.ellipse(sh.x, sh.y, rG * (0.95 + hN * 0.95), rG * (0.95 + hN * 0.95) * 0.36, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      const p = rev.project(b.x, b.y, Math.max(-1.4, b.z))
      const r = Math.max(5, BALL_R * 2.2 * rev.Ky * p.s)
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
    const ballVisible = b && b.z > -1.5
    const ballInField = b && b.z >= 0

    if (ballVisible && ballInField) paintBallRev()

    drawGoalFrameRev(ctx, rev)
    drawKeeperBack(ctx, rev, state.dive, state.time)

    if (ballVisible && !ballInField) paintBallRev() // 進門後的球畫在門框 / 門將之上、網之下

    drawNetRev(ctx, rev, state.net) // 前景背網（隔網看球場）

    // 出腳瞬間閃光（以公尺投影定大小，跨裝置一致）
    if (state.kickFlash > 0 && b) {
      const p = rev.project(b.x, b.y, b.z)
      const a = state.kickFlash / 0.14
      ctx.fillStyle = `rgba(255,255,255,${a * 0.8})`
      ctx.beginPath()
      ctx.arc(p.x, p.y, 2.6 * rev.Kx * p.s * (1.6 - a), 0, Math.PI * 2)
      ctx.fill()
    }

    // 紅圈：來球落點，點到才擋得下（隨球接近縮小）；畫在網前確保清晰
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
    updateConfetti(dt)
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
    if (state.phase === 'aimDir' || state.phase === 'aimPower' || state.phase === 'aimCurve') advanceAim()
    else if (!state.playerShoots && state.phase === 'fly') keeperTap(x, y)
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
      // 一鍵射門：直接指定方向(-1~1)、力道(0~1)、曲度(-1~1)
      shoot: (dirN = 0, powerV = 0.7, curveV = 0) => {
        if (state.phase !== 'aimDir' && state.phase !== 'aimPower' && state.phase !== 'aimCurve') return false
        playerFire(dirN * MAX_DIR, powerV, curveV)
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
