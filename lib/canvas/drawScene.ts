import type { Scene } from '../scenes'
import type { FacePatch } from '../face/crop'

const CANVAS_W = 1280
const CANVAS_H = 720

export type DrawAssets = {
  background: HTMLImageElement
  dancer: HTMLVideoElement
  facePatch: FacePatch
  cropTightness: number  // 0.5 → 1.5, scales the patch around faceHole center
}

// Draws one frame: background → dancer (video frame) → face patch centered at faceHole,
// scaled by tightness, clipped to the rotated oval.
export function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  assets: DrawAssets,
): void {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
  ctx.drawImage(assets.background, 0, 0, CANVAS_W, CANVAS_H)
  ctx.drawImage(assets.dancer, 0, 0, CANVAS_W, CANVAS_H)

  const fh = scene.faceHole
  const tightness = Math.max(0.3, Math.min(1.5, assets.cropTightness))
  const rot = (fh.rotation * Math.PI) / 180

  // Scale the patch so its oval region fits the faceHole oval at tightness=1.
  // Use the smaller dim so the patch doesn't overflow either axis of the hole.
  const ov = assets.facePatch.oval
  const sx = fh.rx / ov.rx
  const sy = fh.ry / ov.ry
  const baseScale = Math.min(sx, sy)
  const finalScale = baseScale * tightness
  const patchSize = assets.facePatch.canvas.width
  const drawW = patchSize * finalScale
  const drawH = patchSize * finalScale

  ctx.save()
  // Clip to the rotated oval
  ctx.beginPath()
  ctx.ellipse(fh.cx, fh.cy, fh.rx, fh.ry, rot, 0, Math.PI * 2)
  ctx.clip()
  // Translate to faceHole center, rotate to faceHole angle, then draw the patch centered.
  ctx.translate(fh.cx, fh.cy)
  ctx.rotate(rot)
  ctx.drawImage(assets.facePatch.canvas, -drawW / 2, -drawH / 2, drawW, drawH)
  ctx.restore()
}