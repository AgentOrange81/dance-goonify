import type { Scene, FaceHoleKeyframe } from '../scenes'
import { CANVAS_W, CANVAS_H } from '../scenes'
import type { FacePatch } from '../face/crop'

export type DrawAssets = {
  dancer: HTMLVideoElement
  facePatch: FacePatch | null
  /** Multiplier on the patch's oval → destination oval fit. 1 = exact fit,
   *  >1 = patch grows past the oval boundary, <1 = patch shrinks inside. */
  cropTightness: number
}

/**
 * Draws one frame: video → optional face patch clipped to the scene's face hole.
 *
 * The patch canvas from `cropOval` is square and contains the user's oval masked
 * to a smoothstep alpha. We fit the patch's oval (in patch-local pixels) into
 * the scene's destination oval (in canvas pixels) by uniformly scaling so that
 * the smaller axis matches exactly; the larger axis gets the same scale, so the
 * oval becomes a true ellipse with the same aspect as the destination. The
 * patch is then drawn rotated so the user's face follows the dancer's head roll.
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  fh: FaceHoleKeyframe,
  assets: DrawAssets,
): void {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
  ctx.drawImage(assets.dancer, 0, 0, CANVAS_W, CANVAS_H)

  if (!assets.facePatch) return

  const tightness = Math.max(0.3, Math.min(1.5, assets.cropTightness))
  const rot = (fh.rotation * Math.PI) / 180

  // The patch's oval sits centred in the patch canvas (see cropOval):
  //   patch.oval.cx === patch.canvas.width  / 2
  //   patch.oval.cy === patch.canvas.height / 2
  //   patch.oval.rx, .ry are in patch-local pixels.
  // The destination oval is at (fh.cx, fh.cy) with radii (fh.rx, fh.ry) in
  // canvas pixels, rotated by `rot` radians.
  //
  // Scale the patch canvas so the patch's oval maps exactly to the destination
  // oval. Both axes share the same scale so the oval aspect is preserved; we
  // pick `min(sx, sy)` so neither axis overshoots, then the user can grow it
  // past the oval via `tightness`.
  const ov = assets.facePatch.oval
  const sx = fh.rx / ov.rx
  const sy = fh.ry / ov.ry
  const baseScale = Math.min(sx, sy)
  const finalScale = baseScale * tightness

  const patchSize = assets.facePatch.canvas.width
  const drawSize = patchSize * finalScale

  // Clip to the rotated destination oval.
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(fh.cx, fh.cy, fh.rx, fh.ry, rot, 0, Math.PI * 2)
  ctx.clip()

  // Soft edge decontamination ring: pull the patch's alpha-edge pixels toward
  // the dancer's average skin chroma so the seam blends. We sample the
  // destination's mean chroma from inside the oval (the dancer's skin after
  // the video draw) BEFORE drawing the patch on top.
  let edgeColor = { r: 128, g: 128, b: 128 }
  try {
    const inset = 0.3
    const sw = Math.max(2, Math.round(fh.rx * (1 - inset * 2)))
    const sh = Math.max(2, Math.round(fh.ry * (1 - inset * 2)))
    const sx0 = Math.max(0, Math.round(fh.cx - sw / 2))
    const sy0 = Math.max(0, Math.round(fh.cy - sh / 2))
    const sw2 = Math.min(sw, CANVAS_W - sx0)
    const sh2 = Math.min(sh, CANVAS_H - sy0)
    if (sw2 > 1 && sh2 > 1) {
      const img = ctx.getImageData(sx0, sy0, sw2, sh2)
      let r = 0, g = 0, b = 0, n = 0
      for (let i = 0; i < img.data.length; i += 4) {
        r += img.data[i]
        g += img.data[i + 1]
        b += img.data[i + 2]
        n++
      }
      edgeColor = {
        r: Math.round(r / n),
        g: Math.round(g / n),
        b: Math.round(b / n),
      }
    }
  } catch {
    // CORS-tainted canvas: fall back to neutral gray.
  }

  // Draw the patch centred on the destination oval, rotated by `rot`.
  ctx.translate(fh.cx, fh.cy)
  ctx.rotate(rot)
  ctx.drawImage(
    assets.facePatch.canvas,
    -drawSize / 2,
    -drawSize / 2,
    drawSize,
    drawSize,
  )
  ctx.restore()

  // After the patch is on top, paint a soft ring biased toward the dancer's
  // skin tone inside the oval boundary. This softens the alpha feather and
  // suppresses the brown halo against the warm teal rim light. Keep it
  // narrow and low-alpha so it doesn't look like a separate overlay.
  const ringWidth = Math.min(fh.rx, fh.ry) * 0.08
  const ringInner = Math.max(2, Math.min(fh.rx, fh.ry) - ringWidth)
  const ringOuter = Math.min(fh.rx, fh.ry)
  const grad = ctx.createRadialGradient(
    fh.cx, fh.cy, ringInner,
    fh.cx, fh.cy, ringOuter,
  )
  grad.addColorStop(0, `rgba(${edgeColor.r}, ${edgeColor.g}, ${edgeColor.b}, 0)`)
  grad.addColorStop(1, `rgba(${edgeColor.r}, ${edgeColor.g}, ${edgeColor.b}, 0.18)`)
  ctx.save()
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.ellipse(fh.cx, fh.cy, fh.rx, fh.ry, rot, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}
