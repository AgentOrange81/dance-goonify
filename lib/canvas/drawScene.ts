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

  // Clear + base layer
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)

  // Background — fills canvas, no transform
  ctx.drawImage(assets.background, 0, 0, CANVAS_W, CANVAS_H)

  // The dancer is drawn at dancerLayout (x, y) with the given width and height.
  // The motion transform is applied around the dancer's center.
  const dl = scene.dancerLayout
  const dancerCx = dl.x + dl.w / 2
  const dancerCy = dl.y + dl.h / 2
  ctx.save()
  ctx.translate(dancerCx + motion.dx, dancerCy + motion.dy)
  ctx.rotate(((motion.dRoll + (cal.rotation ?? 0)) * Math.PI) / 180)
  ctx.scale(motion.dScale, motion.dScale)
  ctx.drawImage(assets.dancer, -dl.w / 2, -dl.h / 2, dl.w, dl.h)

  // Face patch composite — inside the face hole oval.
  // ovalCx/ovalCy are in CANVAS coords (relative to the canvas, not the translated origin),
  // because we restore the transform and re-translate to oval-relative coords below.
  const fh = scene.faceHole
  const ovalCx = dancerCx + (fh.cx - 0.5) * dl.w + (cal.dx ?? 0)
  const ovalCy = dancerCy + (fh.cy - 0.5) * dl.h + (cal.dy ?? 0)
  const ovalRx = fh.rx * dl.w * (cal.rxMul ?? 1)
  const ovalRy = fh.ry * dl.h * (cal.ryMul ?? 1)
  const ovalRot = ((fh.rotation + (cal.rotation ?? 0)) * Math.PI) / 180

  // Apply rotation around the oval center, then clip to the ellipse.
  // The clip is in CANVAS coords because we restore the dancer transform first.
  ctx.restore()  // undo the dancer translate/rotate/scale

  ctx.save()
  ctx.translate(ovalCx, ovalCy)
  ctx.rotate(ovalRot)
  ctx.beginPath()
  ctx.ellipse(0, 0, ovalRx, ovalRy, 0, 0, Math.PI * 2)
  ctx.clip()

  // Draw the face patch. The patch canvas is square (size = patch canvas width).
  // Scale so the smaller oval dim equals the patch width — fills the oval.
  const patchSize = assets.facePatch.canvas.width
  const drawSize = Math.min(ovalRx, ovalRy) * 2
  ctx.drawImage(
    assets.facePatch.canvas,
    -drawSize / 2,
    -drawSize / 2,
    drawSize,
    drawSize
  )
  ctx.restore()

  // Hair overlay AFTER face (so bangs sit on top of the user's face patch).
  // Drawn in CANVAS coords, no transform.
  if (assets.hairOverlay) {
    ctx.drawImage(assets.hairOverlay, dl.x, dl.y, dl.w, dl.h)
  }

  // Vignette on top of everything — disabled for now while debugging black screen.
  // if (scene.grade.vignette > 0) {
  //   applyVignette(ctx, scene.grade.vignette)
  // }
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
