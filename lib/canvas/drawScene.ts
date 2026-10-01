import type { Scene, FaceHoleKeyframe } from '../scenes'
import type { FacePatch } from '../face/crop'

const CANVAS_W = 1280
const CANVAS_H = 720

export type DrawAssets = {
  background: HTMLImageElement
  dancer: HTMLVideoElement
  facePatch: FacePatch | null  // null → no face composite; dancer plays alone
  cropTightness: number  // 0.5 → 1.5
}

// Draws one frame: background → dancer (video frame) → face patch (if any) clipped to fh.
// When facePatch is null, only bg + dancer draw, leaving the dancer's blank oval face visible.
export function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  fh: FaceHoleKeyframe,
  assets: DrawAssets,
): void {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
  ctx.drawImage(assets.background, 0, 0, CANVAS_W, CANVAS_H)
  ctx.drawImage(assets.dancer, 0, 0, CANVAS_W, CANVAS_H)

  if (!assets.facePatch) return

  const tightness = Math.max(0.3, Math.min(1.5, assets.cropTightness))
  const rot = (fh.rotation * Math.PI) / 180

  // Scale the patch so its oval region fits the current faceHole oval at tightness=1.
  const ov = assets.facePatch.oval
  const sx = fh.rx / ov.rx
  const sy = fh.ry / ov.ry
  const baseScale = Math.min(sx, sy)
  const finalScale = baseScale * tightness
  const patchSize = assets.facePatch.canvas.width
  const drawW = patchSize * finalScale
  const drawH = patchSize * finalScale

  ctx.save()
  ctx.beginPath()
  ctx.ellipse(fh.cx, fh.cy, fh.rx, fh.ry, rot, 0, Math.PI * 2)
  ctx.clip()
  ctx.translate(fh.cx, fh.cy)
  ctx.rotate(rot)
  ctx.drawImage(assets.facePatch.canvas, -drawW / 2, -drawH / 2, drawW, drawH)
  ctx.restore()
}