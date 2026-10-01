import type { Scene } from '../scenes'
import type { FacePatch } from '../face/crop'

const CANVAS_W = 1280
const CANVAS_H = 720

export type DrawAssets = {
  background: HTMLImageElement
  dancer: HTMLVideoElement  // H3-generated animated video of the dancer
  facePatch: FacePatch
  cropTightness: number     // 0.5 (loose) → 1.3 (tight)
}

// Draws one frame: background → dancer (video frame) → face patch clipped to oval.
export function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  assets: DrawAssets,
): void {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)

  // Background — static image of the empty club room
  ctx.drawImage(assets.background, 0, 0, CANVAS_W, CANVAS_H)

  // Dancer — current frame of the video. The video's body covers most of the bg,
  // which is fine (and expected — H3 generated the dancer in-scene).
  ctx.drawImage(assets.dancer, 0, 0, CANVAS_W, CANVAS_H)

  // Face composite inside the oval.
  const fh = scene.faceHole
  const tightness = Math.max(0.3, Math.min(1.5, assets.cropTightness))
  const faceW = fh.rx * 2 * tightness
  const faceH = fh.ry * 2 * tightness

  ctx.save()
  ctx.translate(fh.cx, fh.cy)
  ctx.rotate((fh.rotation * Math.PI) / 180)
  ctx.beginPath()
  ctx.ellipse(0, 0, fh.rx, fh.ry, 0, 0, Math.PI * 2)
  ctx.clip()

  ctx.drawImage(
    assets.facePatch.canvas,
    -faceW / 2,
    -faceH / 2,
    faceW,
    faceH
  )
  ctx.restore()
}