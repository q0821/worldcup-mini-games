// 音效：以 Web Audio API 合成基本音效，免音檔。
// 行動瀏覽器需在首次使用者手勢後 unlock()。靜音狀態存 localStorage。
const MUTE_KEY = 'fg_muted'

class SoundManager {
  constructor() {
    this.ctx = null
    this.muted = localStorage.getItem(MUTE_KEY) === '1'
    this.listeners = new Set()
    this._noiseBuf = null
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

  // ---------- 噪音合成 (踢球 / 群眾等打擊 / 環境音) ----------
  _noise() {
    const len = this.ctx.sampleRate
    if (!this._noiseBuf) {
      this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const ch = this._noiseBuf.getChannelData(0)
      for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1
    }
    return this._noiseBuf
  }

  noiseBurst({ dur = 0.15, type = 'lowpass', freq = 400, q = 1, gain = 0.3, attack = 0.004 }) {
    if (this.muted || !this.ctx) return
    const now = this.ctx.currentTime
    const src = this.ctx.createBufferSource()
    src.buffer = this._noise()
    src.loop = true
    const f = this.ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(gain, now + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur)
    src.connect(f).connect(g).connect(this.ctx.destination)
    src.start(now)
    src.stop(now + dur + 0.05)
  }

  // PK 模式事件音
  kick() {
    this.noiseBurst({ dur: 0.1, freq: 240, gain: 0.5 })
    this.tone({ freq: 75, slideTo: 42, dur: 0.13, type: 'sine', gain: 0.5 })
  }
  thud() {
    // 撲救 (手套悶擊)
    this.noiseBurst({ dur: 0.12, freq: 420, gain: 0.4 })
    this.tone({ freq: 130, slideTo: 70, dur: 0.12, type: 'sine', gain: 0.35 })
  }
  swish() {
    // 球入網
    this.noiseBurst({ dur: 0.28, type: 'bandpass', freq: 1700, q: 0.7, gain: 0.22 })
  }
  postHit() {
    // 中門柱 (清脆金屬)
    this.tone({ freq: 640, slideTo: 360, dur: 0.28, type: 'triangle', gain: 0.3 })
  }
  crowd(dur = 1.6, gain = 0.3) {
    this.noiseBurst({ dur, type: 'bandpass', freq: 850, q: 0.35, gain, attack: 0.12 })
  }
  whistle(n = 1) {
    if (this.muted || !this.ctx) return
    const now = this.ctx.currentTime
    for (let i = 0; i < n; i++) {
      const osc = this.ctx.createOscillator()
      const g = this.ctx.createGain()
      osc.type = 'square'
      osc.frequency.setValueAtTime(2350, now + i * 0.3)
      const t0 = now + i * 0.3
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.015)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22)
      osc.connect(g).connect(this.ctx.destination)
      osc.start(t0)
      osc.stop(t0 + 0.25)
    }
  }
}

export const sound = new SoundManager()
