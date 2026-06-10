import { t, toggleLang, getLang } from '../core/i18n.js'
import { sound } from '../core/sound.js'
import { showScreen } from '../core/screens.js'
import { makeBgLayer } from '../core/bg.js'
import { icons } from '../core/icons.js'
import { createKeepyScreen } from './keepy.js'

export function createHomeScreen() {
  const el = document.createElement('div')
  el.className = 'screen'
  el.appendChild(makeBgLayer('home'))

  const modes = [
    {
      icon: icons.ball,
      title: t('mode1Title'),
      desc: t('mode1Desc'),
      open: () => {
        sound.unlock()
        sound.click()
        showScreen(createKeepyScreen)
      },
    },
    { icon: icons.camera, title: t('mode2Title'), desc: t('mode2Desc'), soon: true },
    { icon: icons.goal, title: t('mode3Title'), desc: t('mode3Desc'), soon: true },
  ]

  const home = document.createElement('div')
  home.className = 'home'
  home.innerHTML = `
    <button class="icon-btn" id="lang" style="position:absolute;top:calc(14px + var(--safe-top));right:14px">${
      getLang() === 'zh' ? 'EN' : '中'
    }</button>
    <h1>${t('appTitle')}</h1>
    <p class="tagline">${t('tagline')}</p>
    <div class="cards"></div>
  `

  const cards = home.querySelector('.cards')
  modes.forEach((m) => {
    const c = document.createElement('div')
    c.className = 'card' + (m.soon ? ' soon' : '')
    c.innerHTML = `
      <span class="emoji">${m.icon}</span>
      <h3>${m.title}</h3>
      <p>${m.desc}</p>
      ${m.soon ? `<span class="badge-soon">${t('comingSoon')}</span>` : ''}
    `
    if (!m.soon) c.addEventListener('click', m.open)
    cards.appendChild(c)
  })

  home.querySelector('#lang').addEventListener('click', () => {
    toggleLang()
    showScreen(createHomeScreen) // 重繪套用語言
  })

  el.appendChild(home)
  return { el }
}
