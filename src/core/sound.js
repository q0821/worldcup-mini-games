// 音效：以 Web Audio API 合成基本音效，免音檔。
// 行動瀏覽器需在首次使用者手勢後 unlock()。靜音狀態存 localStorage。
const MUTE_KEY = 'fg_muted'

class SoundManager {
  constructor() {
    this.ctx = null
    this.muted = localStorage.getItem(MUTE_KEY) === '1'
    this.listeners = new Set()
  }

  // 必須在使用者手勢中呼叫 (點「開始」)
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (AC) this.ctx = new AC()
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume()
  }

  isMuted() {
    return this.muted
  }

  toggleMute() {
    this.muted = !this.muted
    localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0')
    this.listeners.forEach((fn) => fn(this.muted))
    return this.muted
  }

  onMuteChange(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  // 基本合成音：type=sine/square/triangle/sawtooth
  tone({ freq = 440, dur = 0.12, type = 'sine', gain = 0.2, slideTo = null }) {
    if (this.muted || !this.ctx) return
    const now = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, now)
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + dur)
    g.gain.setValueAtTime(gain, now)
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur)
    osc.connect(g).connect(this.ctx.destination)
    osc.start(now)
    osc.stop(now + dur)
  }

  // 預設事件音
  bounce() {
    this.tone({ freq: 520, slideTo: 760, dur: 0.1, type: 'triangle', gain: 0.25 })
  }
  point() {
    this.tone({ freq: 660, slideTo: 990, dur: 0.12, type: 'square', gain: 0.15 })
  }
  record() {
    this.tone({ freq: 660, slideTo: 1320, dur: 0.3, type: 'sawtooth', gain: 0.2 })
  }
  fail() {
    this.tone({ freq: 300, slideTo: 120, dur: 0.4, type: 'sawtooth', gain: 0.22 })
  }
  click() {
    this.tone({ freq: 440, dur: 0.06, type: 'sine', gain: 0.15 })
  }
}

export const sound = new SoundManager()
