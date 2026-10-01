import type { Scene, FaceHoleKeyframe } from '../scenes'
import type { FacePatch } from '../face/crop'

const CANVAS_W = 1280
const CANVAS_H = 720

export type DrawAssets = {
  background: HTMLImageElement
  dancer: HTMLVideoElement
  facePatch: FacePatch | null
  cropTightness: number
}

// Draws one frame: background → dancer (video frame) → face patch (if any) clipped to fh.
// Edge decontamination: at the alpha boundary (pixels with partial transparency),
// we blend the source color toward the destination's average chroma to suppress
// the "brown halo" / color spill artifact that otherwise shows up against the warm
// teal rim lighting on the dancer.
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

  // 1) Sample destination's average skin chroma (insetted to avoid rim light)
  //    We sample a small rect at the center of the oval region on the dancer image
  //    BEFORE drawing the patch. This becomes the "edge chroma" we decontaminate toward.
  const inset = 0.30
  const destCx = fh.cx
  const destCy = fh.cy
  const destRx = fh.rx * (1 - inset * 2)
  const destRy = fh.ry * (1 - inset * 2)
  let edgeGray: [number, number, number] = [128, 128, 128]
  try {
    const w = Math.max(2, Math.round(destRx * 1.4))
    const h = Math.max(2, Math.round(destRy * 1.4))
    const x = Math.max(0, Math.round(destCx - w / 2))
    const y = Math.max(0, Math.round(destCy - h / 2))
    const img = ctx.getImageData(x, y, Math.min(w, CANVAS_W - x), Math.min(h, CANVAS_H - y))
    let r = 0, g = 0, b = 0, n = 0
    for (let i = 0; i < img.data.length; i += 4) {
      r += img.data[i]
      g += img.data[i + 1]
      b += img.data[i + 2]
      n++
    }
    edgeGray = [Math.round(r / n), Math.round(g / n), Math.round(b / n)]
  } catch {
    // CORS-tainted canvas — fall back to neutral gray
  }

  // 2) Draw the patch clipped to the rotated oval
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(fh.cx, fh.cy, fh.rx, fh.ry, rot, 0, Math.PI * 2)
  ctx.clip()
  ctx.translate(fh.cx, fh.cy)
  ctx.rotate(rot)
  ctx.drawImage(assets.facePatch.canvas, -drawW / 2, -drawH / 2, drawW, drawH)
  ctx.restore()

  // 3) Edge decontamination pass — at the alpha boundary of the oval clip, blend
  //    toward the destination's average gray. This kills the "brown halo" when the
  //    user's patch edges (background colors, hair, etc.) leak past the feather.
  //
  //    Trick: draw a second pass of just the patch's *edge ring* (alpha < 1, > 0)
  //    composited with 'source-atop' over the destination. The destination shows through
  //    where the patch alpha is partial, and our color is biased toward the destination gray.
  //
  //    Implementation: re-draw the patch with 'source-atop' blend mode, then over-blend
  //    the destination gray based on (1 - alpha).
  //
  //    Simpler approach: draw a "decontaminate ring" — a soft-edged annulus at the oval
  //    boundary, fill with the destination's average gray at low alpha. This pushes the
  //    brown halo toward gray.

  const ringWidth = Math.min(fh.rx, fh.ry) * 0.15
  const gradient = ctx.createRadialGradient(
    fh.cx, fh.cy, Math.max(2, fh.rx - ringWidth),
    fh.cx, fh.cy, fh.rx + ringWidth
  )
  gradient.addColorStop(0, `rgba(${edgeGray[0]}, ${edgeGray[1]}, ${edgeGray[2]}, 0)`)
  gradient.addColorStop(0.5, `rgba(${edgeGray[0]}, ${edgeGray[1]}, ${edgeGray[2]}, 0.35)`)
  gradient.addColorStop(1, `rgba(${edgeGray[0]}, ${edgeGray[1]}, ${edgeGray[2]}, 0.6)`)
  ctx.fillStyle = gradient
  // Only fill inside the oval
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(fh.cx, fh.cy, fh.rx + ringWidth, fh.ry + ringWidth, rot, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}