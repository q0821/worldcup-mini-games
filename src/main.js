import './style.css'
import { showScreen } from './core/screens.js'
import { createHomeScreen } from './screens/home.js'
import { createKeepyScreen } from './screens/keepy.js'
import { createHeaderScreen } from './screens/header.js'
import { createPkScreen } from './screens/pk.js'

// 深連結：網址帶 #keepy / #header / #pk 直接進入對應模式（分享連結 / QR 掃碼用）
const ROUTES = { keepy: createKeepyScreen, header: createHeaderScreen, pk: createPkScreen }
const mode = location.hash.slice(1)
showScreen(ROUTES[mode] || createHomeScreen)
