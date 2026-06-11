import { defineConfig } from 'vite'

// 遊戲正式網址（單一來源）：用於 OG 預覽 meta 的絕對網址、QR fallback。
// 換部署網域時只改這一行。index.html 用 %SITE_URL% 佔位、JS 用 __SITE_URL__。
const SITE_URL = 'https://worldcup.jackie-yeh.com'

export default defineConfig({
  base: './',
  define: {
    __SITE_URL__: JSON.stringify(SITE_URL),
  },
  plugins: [
    {
      name: 'html-site-url',
      transformIndexHtml(html) {
        return html.replaceAll('%SITE_URL%', SITE_URL)
      },
    },
  ],
  server: { host: true, port: 5173 },
})
