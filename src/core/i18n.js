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
