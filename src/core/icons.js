// Inline SVG 圖示，取代 Emoji。皆用 currentColor 繼承文字顏色，方便套主題與 RWD。
export const icons = {
  // 模式一：足球
  ball: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <polygon points="12,8 15,10.2 13.8,13.8 10.2,13.8 9,10.2" fill="currentColor"/>
    <g stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
      <line x1="12" y1="3" x2="12" y2="8"/>
      <line x1="20.6" y1="12.5" x2="15" y2="10.2"/>
      <line x1="17" y1="19.2" x2="13.8" y2="13.8"/>
      <line x1="7" y1="19.2" x2="10.2" y2="13.8"/>
      <line x1="3.4" y1="12.5" x2="9" y2="10.2"/>
    </g>
  </svg>`,

  // 模式二：攝影機 (頭鎚 AR 需要相機)
  camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
    <rect x="3" y="7" width="18" height="13" rx="2.5"/>
    <path d="M8 7 L9.5 4.5 H14.5 L16 7"/>
    <circle cx="12" cy="13.4" r="3.4"/>
  </svg>`,

  // 模式三：球門 + 球網
  goal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linejoin="round">
    <g stroke-width="0.8" opacity="0.55">
      <line x1="7" y1="6.5" x2="7" y2="19"/>
      <line x1="11" y1="6.5" x2="11" y2="19"/>
      <line x1="15" y1="6.5" x2="15" y2="19"/>
      <line x1="4" y1="10.5" x2="20" y2="10.5"/>
      <line x1="4" y1="14.7" x2="20" y2="14.7"/>
    </g>
    <path d="M3.5 19 V6.5 H20.5 V19" stroke-width="1.8" stroke-linecap="round"/>
    <line x1="2.5" y1="19" x2="21.5" y2="19" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`,

  // 音效開
  soundOn: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 9 H7 L11 5 V19 L7 15 H4 Z" fill="currentColor" stroke="none"/>
    <path d="M15 9.5 a3.5 3.5 0 0 1 0 5"/>
    <path d="M17.6 7 a7 7 0 0 1 0 10"/>
  </svg>`,

  // 音效關 (靜音)
  soundOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 9 H7 L11 5 V19 L7 15 H4 Z" fill="currentColor" stroke="none"/>
    <line x1="15.5" y1="9.5" x2="20.5" y2="14.5"/>
    <line x1="20.5" y1="9.5" x2="15.5" y2="14.5"/>
  </svg>`,
}
