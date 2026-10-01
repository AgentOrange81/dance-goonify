import type { Scene, FaceHoleKeyframe } from '../scenes'
import type { FacePatch } from '../face/crop'

const CANVAS_W = 1280
const CANVAS_H = 720

export type DrawAssets = {
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

  // 1) Sample destination's average skin chroma at the OVAL CENTER (not inset).
  //    This becomes the "edge chroma" we decontaminate toward. We sample from the
  //    BEVEL CENTER (a small rect inside the hole) so we don't catch rim light.
  let edgeGray: [number, number, number] = [128, 128, 128]
  try {
    const inset = 0.25
    const sw = Math.max(2, Math.round(fh.rx * (1 - inset * 2)))
    const sh = Math.max(2, Math.round(fh.ry * (1 - inset * 2)))
    const sx0 = Math.max(0, Math.round(fh.cx - sw / 2))
    const sy0 = Math.max(0, Math.round(fh.cy - sh / 2))
    const sw2 = Math.min(sw, CANVAS_W - sx0)
    const sh2 = Math.min(sh, CANVAS_H - sy0)
    const img = ctx.getImageData(sx0, sy0, sw2, sh2)
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

  // 2) Draw the patch clipped to the rotated oval. We use 'source-over' for normal alpha.
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(fh.cx, fh.cy, fh.rx, fh.ry, rot, 0, Math.PI * 2)
  ctx.clip()
  ctx.translate(fh.cx, fh.cy)
  ctx.rotate(rot)
  ctx.drawImage(assets.facePatch.canvas, -drawW / 2, -drawH / 2, drawW, drawH)
  ctx.restore()

  // 3) Soft edge decontamination ring. The previous version had a strong gray halo
  //    that was more visible than the patch itself. We now blend subtly toward the
  //    dancer's actual oval color, at a low alpha, only in a narrow band on the inside.
  //
  //    Approach: draw a thin ring inside the oval, fill with destination chroma,
  //    low alpha. This pulls the patch's edge pixels toward the dancer's skin tone
  //    without creating a visible halo.
  const ringWidth = Math.min(fh.rx, fh.ry) * 0.08
  const ringInset = Math.max(2, fh.rx - ringWidth)
  const ringOuter = fh.rx
  const gradient = ctx.createRadialGradient(
    fh.cx, fh.cy, ringInset,
    fh.cx, fh.cy, ringOuter
  )
  gradient.addColorStop(0, `rgba(${edgeGray[0]}, ${edgeGray[1]}, ${edgeGray[2]}, 0)`)
  gradient.addColorStop(1, `rgba(${edgeGray[0]}, ${edgeGray[1]}, ${edgeGray[2]}, 0.18)`)
  ctx.fillStyle = gradient
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(fh.cx, fh.cy, fh.rx, fh.ry, rot, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}