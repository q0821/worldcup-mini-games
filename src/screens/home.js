import { t, toggleLang, getLang } from '../core/i18n.js'
import { sound } from '../core/sound.js'
import { showScreen } from '../core/screens.js'
import { makeBgLayer } from '../core/bg.js'
import { icons } from '../core/icons.js'
import { createKeepyScreen } from './keepy.js'
import { createPkScreen } from './pk.js'
import { createHeaderScreen } from './header.js'

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
    {
      icon: icons.camera,
      title: t('mode2Title'),
      desc: t('mode2Desc'),
      open: () => {
        sound.unlock()
        sound.click()
        showScreen(createHeaderScreen)
      },
    },
    {
      icon: icons.goal,
      title: t('mode3Title'),
      desc: t('mode3Desc'),
      open: () => {
        sound.unlock()
        sound.click()
        showScreen(createPkScreen)
      },
    },
  ]

  const repoIcon = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true" style="vertical-align:-2px"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`

  const home = document.createElement('div')
  home.className = 'home'
  home.innerHTML = `
    <button class="icon-btn" id="lang" style="position:absolute;top:calc(14px + var(--safe-top));right:14px">${
      getLang() === 'zh' ? 'EN' : '中'
    }</button>
    <h1>${t('appTitle')}</h1>
    <p class="tagline">${t('tagline')}</p>
    <div class="cards"></div>
    <footer class="home-footer">
      <span>Made by Jackie Yeh</span>
      <a href="https://github.com/q0821/worldcup-mini-games" target="_blank" rel="noopener">${repoIcon} GitHub</a>
    </footer>
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
