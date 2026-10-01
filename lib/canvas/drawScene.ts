import type { Scene } from '../scenes'
import type { FacePatch } from '../face/crop'
import type { FrameMotion } from './motion'

const CANVAS_W = 1280
const CANVAS_H = 720

export type DrawAssets = {
  background: HTMLImageElement
  dancer: HTMLImageElement
  hairOverlay?: HTMLImageElement
  facePatch: FacePatch
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  assets: DrawAssets,
  motion: FrameMotion,
  calibration?: { dx?: number; dy?: number; rxMul?: number; ryMul?: number; rotation?: number }
): void {
  const cal = calibration ?? {}

  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)

  // Background — fills canvas, no transform
  ctx.drawImage(assets.background, 0, 0, CANVAS_W, CANVAS_H)

  // Apply motion + draw dancer centered
  const dl = scene.dancerLayout
  ctx.save()
  ctx.translate(CANVAS_W / 2 + motion.dx, CANVAS_H / 2 + motion.dy)
  ctx.rotate(((motion.dRoll + (cal.rotation ?? 0)) * Math.PI) / 180)
  ctx.scale(motion.dScale, motion.dScale)
  ctx.drawImage(assets.dancer, -dl.w / 2, -dl.h / 2, dl.w, dl.h)

  // Composite the face patch inside the oval
  const fh = scene.faceHole
  const ovalCx = dl.x + fh.cx * dl.w + (cal.dx ?? 0)
  const ovalCy = dl.y + fh.cy * dl.h + (cal.dy ?? 0)
  const ovalRx = fh.rx * dl.w * (cal.rxMul ?? 1)
  const ovalRy = fh.ry * dl.h * (cal.ryMul ?? 1)
  const ovalRot = ((fh.rotation + (cal.rotation ?? 0)) * Math.PI) / 180

  ctx.save()
  ctx.translate(ovalCx, ovalCy)
  ctx.rotate(ovalRot)
  ctx.beginPath()
  ctx.ellipse(0, 0, ovalRx, ovalRy, 0, 0, Math.PI * 2)
  ctx.clip()

  // The face patch was cropped as a square (size = its canvas width).
  // We want to fit it inside the ellipse. Scale so the ellipse's smaller dim
  // equals the patch size; this fills the oval nicely.
  const patchSize = assets.facePatch.canvas.width
  const targetSize = Math.min(ovalRx, ovalRy) * 2
  const drawSize = targetSize
  // Center the patch on the oval center
  ctx.drawImage(
    assets.facePatch.canvas,
    -drawSize / 2,
    -drawSize / 2,
    drawSize,
    drawSize
  )
  ctx.restore()

  // Apply the elliptical alpha mask to the face patch by re-drawing it with
  // composite operation 'destination-in' restricted to the ellipse.
  // This blends the patch's edges into the dancer cleanly.
  ctx.save()
  ctx.translate(ovalCx, ovalCy)
  ctx.rotate(ovalRot)
  ctx.beginPath()
  ctx.ellipse(0, 0, ovalRx, ovalRy, 0, 0, Math.PI * 2)
  ctx.globalCompositeOperation = 'destination-in'
  // The mask is an ellipse — draw it as a filled shape and let destination-in do the work
  ctx.fillStyle = '#fff'
  ctx.fill()
  ctx.restore()

  // Hair overlay AFTER face (so bangs sit on top of the user's face patch)
  if (assets.hairOverlay) {
    ctx.drawImage(assets.hairOverlay, dl.x, dl.y, dl.w, dl.h)
  }

  ctx.restore()  // undo dancer transform

  // Vignette on top of everything
  if (scene.grade.vignette > 0) {
    applyVignette(ctx, scene.grade.vignette)
  }
}

function applyVignette(ctx: CanvasRenderingContext2D, strength: number): void {
  const s = Math.max(0, Math.min(1, strength))
  if (s === 0) return
  const grad = ctx.createRadialGradient(
    CANVAS_W / 2, CANVAS_H / 2, Math.min(CANVAS_W, CANVAS_H) * 0.35,
    CANVAS_W / 2, CANVAS_H / 2, Math.max(CANVAS_W, CANVAS_H) * 0.7
  )
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(1, `rgba(0,0,0,${s * 0.7})`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
}
