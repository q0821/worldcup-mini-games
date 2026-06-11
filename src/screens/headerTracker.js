// 頭部 / 指標追蹤器：兩種實作同介面，遊戲迴圈不需分支。
//   read 結果（畫布像素座標）：{ active, x, y, vx, vy }
//   vy < 0 = 往上移動（螢幕座標 y 向下）→ 頂球力道來源。
//
// CameraTracker：getUserMedia 前鏡頭 + MediaPipe FaceLandmarker（CDN 延遲載入）。
//   影像純本機推論、不上傳。失敗 / 拒絕 → 由呼叫端退回 PointerTracker。
// PointerTracker：滑鼠 / 觸控控制頂球點（降級玩法，無需攝影機）。

// MediaPipe 版本固定 pin（不可用 @latest，避免 API 漂移），失敗時呼叫端降級。
const MP_VER = '0.10.22'
const MP_ESM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}`
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/wasm`
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

const FOREHEAD = 10 // Face Mesh：額頭中央
const TEMPLE_L = 234
const TEMPLE_R = 454

// 將「以較短邊為基準、置中 cover」的來源（video）映射到畫布。
// 回傳 { draw(ctx), map(nx, ny) }；map 接受 video 正規化座標 [0,1] → 畫布像素（水平鏡像）。
function coverTransform(srcW, srcH, dstW, dstH) {
  const scale = Math.max(dstW / srcW, dstH / srcH)
  const w = srcW * scale
  const h = srcH * scale
  const ox = (dstW - w) / 2
  const oy = (dstH - h) / 2
  return {
    drawArgs: [ox, oy, w, h],
    map(nx, ny) {
      // 鏡像：使用者舉右手出現在畫面右側，符合照鏡子直覺
      return { x: dstW - (ox + nx * w), y: oy + ny * h }
    },
  }
}

class BaseTracker {
  constructor() {
    this.active = false
    this.x = 0
    this.y = 0
    this.vx = 0
    this.vy = 0
    this._lx = null
    this._ly = null
  }
  // 以 dt 平滑位置並算速度（px/s）
  _commit(tx, ty, dt) {
    if (this._lx == null) {
      this.x = tx
      this.y = ty
    } else {
      const a = Math.min(1, dt * 18) // 平滑係數
      this.x += (tx - this.x) * a
      this.y += (ty - this.y) * a
    }
    if (dt > 0 && this._lx != null) {
      this.vx = (this.x - this._lx) / dt
      this.vy = (this.y - this._ly) / dt
    }
    this._lx = this.x
    this._ly = this.y
    this.active = true
  }
}

// ---------- 指標 / 觸控（降級） ----------
export class PointerTracker {
  constructor(el) {
    this.type = 'pointer'
    this.el = el
    this._tx = 0
    this._ty = 0
    this._has = false
    this._lx = null
    this._ly = null
    this.active = false
    this.x = 0
    this.y = 0
    this.vx = 0
    this.vy = 0
    this._onMove = (e) => {
      const r = el.getBoundingClientRect()
      this._tx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left
      this._ty = (e.touches ? e.touches[0].clientY : e.clientY) - r.top
      this._has = true
    }
  }
  async start() {
    this.el.addEventListener('pointermove', this._onMove)
    this.el.addEventListener('pointerdown', this._onMove)
    return true
  }
  update(dt) {
    if (!this._has) return
    if (this._lx == null) {
      this.x = this._tx
      this.y = this._ty
    } else {
      const a = Math.min(1, dt * 22)
      this.x += (this._tx - this.x) * a
      this.y += (this._ty - this.y) * a
    }
    if (dt > 0 && this._lx != null) {
      this.vx = (this.x - this._lx) / dt
      this.vy = (this.y - this._ly) / dt
    }
    this._lx = this.x
    this._ly = this.y
    this.active = true
  }
  stop() {
    this.el.removeEventListener('pointermove', this._onMove)
    this.el.removeEventListener('pointerdown', this._onMove)
  }
}

// ---------- 攝影機 + MediaPipe ----------
export class CameraTracker extends BaseTracker {
  constructor(video) {
    super()
    this.type = 'camera'
    this.video = video
    this.stream = null
    this.landmarker = null
    this.headR = 60 // 偵測到的頭部半徑（px，依太陽穴間距估）
    this._lastResultTime = -1
  }

  // 可能拋錯：NotAllowedError（拒絕）/ NotFoundError（無鏡頭）/ 模型載入失敗 / 非安全內容。
  async start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('getUserMedia unsupported')
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    })
    this.video.srcObject = this.stream
    this.video.muted = true
    this.video.playsInline = true
    await this.video.play()

    // 延遲載入 MediaPipe（CDN），失敗讓呼叫端降級
    const { FaceLandmarker, FilesetResolver } = await import(/* @vite-ignore */ MP_ESM)
    const fileset = await FilesetResolver.forVisionTasks(MP_WASM)
    this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
    })
    return true
  }

  // dstW/dstH = 畫布尺寸。回傳是否有偵測到臉。
  update(dt, dstW, dstH) {
    const v = this.video
    if (!this.landmarker || !v || v.readyState < 2) return
    const t = performance.now()
    let res
    try {
      res = this.landmarker.detectForVideo(v, t)
    } catch {
      return
    }
    const faces = res && res.faceLandmarks
    if (!faces || !faces.length) {
      this.active = false
      this._lx = null // 重新出現時不要算出爆衝速度
      return
    }
    const lm = faces[0]
    const ct = coverTransform(v.videoWidth, v.videoHeight, dstW, dstH)
    const fh = ct.map(lm[FOREHEAD].x, lm[FOREHEAD].y)
    const tl = ct.map(lm[TEMPLE_L].x, lm[TEMPLE_L].y)
    const tr = ct.map(lm[TEMPLE_R].x, lm[TEMPLE_R].y)
    this.headR = Math.max(36, Math.hypot(tl.x - tr.x, tl.y - tr.y) * 0.62)
    this._commit(fh.x, fh.y, dt)
  }

  // 把目前攝影機畫面 cover + 鏡像畫到 ctx（作為遊戲背景）
  drawVideo(ctx, dstW, dstH) {
    const v = this.video
    if (!v || v.readyState < 2) return false
    const ct = coverTransform(v.videoWidth, v.videoHeight, dstW, dstH)
    ctx.save()
    ctx.translate(dstW, 0)
    ctx.scale(-1, 1) // 鏡像
    ctx.drawImage(v, ct.drawArgs[0], ct.drawArgs[1], ct.drawArgs[2], ct.drawArgs[3])
    ctx.restore()
    return true
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach((tk) => tk.stop())
    this.stream = null
    if (this.landmarker && this.landmarker.close) {
      try {
        this.landmarker.close()
      } catch {
        /* noop */
      }
    }
    this.landmarker = null
    if (this.video) this.video.srcObject = null
  }
}
