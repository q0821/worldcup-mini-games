// 多語系 (中 / 英)。文案集中管理，預設依瀏覽器語言。
const DICT = {
  zh: {
    appTitle: '世足小遊戲',
    tagline: '世足賽開踢！選一個模式開始',
    play: '開始',
    back: '返回',
    retry: '再玩一次',
    share: '分享成績',
    mute: '靜音',
    unmute: '開聲音',
    bestScore: '最高分',
    score: '分數',

    mode1Title: '顛球挑戰',
    mode1Desc: '點擊讓球往上彈，看你能連續顛幾下',
    mode2Title: '頭鎚射門',
    mode2Desc: '用攝影機，用頭把球頂進球門',
    mode3Title: 'PK 大賽',
    mode3Desc: '罰球對決，輪流當射手與門將',

    comingSoon: '開發中，敬請期待',

    keepyCombo: '連續',
    keepyUnit: '下',
    tapToStart: '點擊開始',
    gameOver: '結束！',
    newRecord: '新紀錄！',

    cameraNote: '此模式需要攝影機權限，畫面僅在本機處理、不會上傳。',

    pkChooseDiff: '選擇難度',
    pkEasy: '簡單',
    pkHard: '困難',
    pkYou: '你',
    pkCpu: '電腦',
    pkKickNo: '第 {n} 球',
    pkSudden: '驟死賽',
    pkPickZone: '點球門，選射門落點',
    pkLockPower: '抓準力道，再點一下出腳',
    pkPickSide: '盯住射手，等他出腳…',
    pkDiveTiming: '點紅圈擋球！',
    pkTooStrong: '射飛了！',
    pkStraight: '直射',
    pkBanana: '香蕉球',
    pkGoalScored: '進球！',
    pkSavedByCpu: '被撲出！',
    pkOffTarget: '射偏了！',
    pkHitPost: '中柱！',
    pkYouSaved: '神撲！',
    pkConceded: '失球…',
    pkCpuMissed: '對方射偏！',
    pkWin: '你贏了！',
    pkLose: '你輸了',

    hdReady: '準備好了嗎？',
    hdHowto: '球從左右兩側傳中飛入，左右擺頭把「頂球點」對到球，往上一頂把球頂進上方球門！',
    hdCamNote: '建議開啟攝影機，用真實頭部動作來玩。畫面只在本機處理、不會上傳。',
    hdUseCam: '開攝影機玩',
    hdUsePointer: '用手指 / 滑鼠玩',
    hdLoading: '載入頭部追蹤模型中…',
    hdGrant: '請允許攝影機權限',
    hdDenied: '無法使用攝影機，改用手指 / 滑鼠玩',
    hdCalib: '把頭移進框內',
    hdCalibPointer: '移動手指 / 滑鼠控制頂球點',
    hdGo: '開始',
    hdGoal: '進球！',
    hdMiss: '漏接！',
    hdTime: '時間',
    hdHeadHint: '擺頭撞球，朝球門頂出！',

    shareCardCta: '來挑戰我的分數！',
    shareScanCta: '掃描 QR 一起玩',
    shareText: '我在「{mode}」拿到 {score}，換你挑戰看看！',
    shareSaved: '已儲存成績圖卡',
    shareUnit: { keepy: '連續 {n} 下', header: '進 {n} 球', pk: '射進 {n} 球' },
  },
  en: {
    appTitle: 'World Cup Mini Games',
    tagline: 'Kickoff! Pick a mode to start',
    play: 'Play',
    back: 'Back',
    retry: 'Play again',
    share: 'Share score',
    mute: 'Mute',
    unmute: 'Sound on',
    bestScore: 'Best',
    score: 'Score',

    mode1Title: 'Keepy-Uppy',
    mode1Desc: 'Tap to bounce the ball — how many in a row?',
    mode2Title: 'Header Shot',
    mode2Desc: 'Use your camera, head the ball into the goal',
    mode3Title: 'Penalty Shootout',
    mode3Desc: 'Take turns as striker and goalkeeper',

    comingSoon: 'Coming soon',

    keepyCombo: 'Combo',
    keepyUnit: '',
    tapToStart: 'Tap to start',
    gameOver: 'Game over!',
    newRecord: 'New record!',

    cameraNote: 'This mode needs camera access. Video stays on your device and is never uploaded.',

    pkChooseDiff: 'Choose difficulty',
    pkEasy: 'Easy',
    pkHard: 'Hard',
    pkYou: 'You',
    pkCpu: 'CPU',
    pkKickNo: 'Kick {n}',
    pkSudden: 'Sudden death',
    pkPickZone: 'Tap the goal to aim',
    pkLockPower: 'Tap again to lock the power',
    pkPickSide: 'Watch the striker...',
    pkDiveTiming: 'Tap the red ring to block!',
    pkTooStrong: 'Blazed over!',
    pkStraight: 'Straight',
    pkBanana: 'Curler',
    pkGoalScored: 'GOAL!',
    pkSavedByCpu: 'Saved!',
    pkOffTarget: 'Off target!',
    pkHitPost: 'Off the post!',
    pkYouSaved: 'What a save!',
    pkConceded: 'Conceded...',
    pkCpuMissed: 'CPU missed!',
    pkWin: 'You win!',
    pkLose: 'You lose',

    hdReady: 'Ready?',
    hdHowto: 'Crosses fly in from the sides — move your head left/right to meet the ball, then nod up to head it into the goal!',
    hdCamNote: 'We recommend the camera so you can play with real head movement. Video stays on your device and is never uploaded.',
    hdUseCam: 'Play with camera',
    hdUsePointer: 'Play with finger / mouse',
    hdLoading: 'Loading head-tracking model...',
    hdGrant: 'Please allow camera access',
    hdDenied: 'Camera unavailable — switching to finger / mouse',
    hdCalib: 'Move your head into the frame',
    hdCalibPointer: 'Move finger / mouse to control the header point',
    hdGo: 'Start',
    hdGoal: 'GOAL!',
    hdMiss: 'Missed!',
    hdTime: 'Time',
    hdHeadHint: 'Swing your head to head it goalward!',

    shareCardCta: 'Beat my score!',
    shareScanCta: 'Scan to play',
    shareText: 'I scored {score} in "{mode}" — can you beat it?',
    shareSaved: 'Score card saved',
    shareUnit: { keepy: '{n} in a row', header: '{n} goals', pk: '{n} scored' },
  },
}

const STORAGE_KEY = 'fg_lang'
let lang = detectLang()
const listeners = new Set()

function detectLang() {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved && DICT[saved]) return saved
  const nav = (navigator.language || 'en').toLowerCase()
  return nav.startsWith('zh') ? 'zh' : 'en'
}

export function t(key) {
  return DICT[lang][key] ?? DICT.en[key] ?? key
}

export function getLang() {
  return lang
}

export function setLang(next) {
  if (!DICT[next]) return
  lang = next
  localStorage.setItem(STORAGE_KEY, next)
  document.documentElement.lang = next === 'zh' ? 'zh-Hant' : 'en'
  listeners.forEach((fn) => fn(lang))
}

export function toggleLang() {
  setLang(lang === 'zh' ? 'en' : 'zh')
}

export function onLangChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
