import type { Scene, FaceHoleKeyframe } from '../scenes'
import { CANVAS_W, CANVAS_H } from '../scenes'
import type { FacePatch } from '../face/crop'
import { transferPatchToMatch } from '../color/transfer'
import { drawWarpedFace, type Point } from '../face/warp'

export type DrawAssets = {
  dancer: HTMLVideoElement
  facePatch: FacePatch | null
  /** Multiplier on the patch's oval → destination oval fit. 1 = exact fit,
   *  >1 = patch grows past the oval boundary, <1 = patch shrinks inside.
   *  Only used by the legacy oval fallback; ignored when landmarks are
   *  available (Delaunay warping handles sizing internally). */
  cropTightness: number
}

/**
 * Read the destination's average chroma from inside the destination oval.
 * Used for the soft edge decontamination ring (per frame). The caller must
 * invoke this AFTER `drawVideoFrame` and BEFORE `drawPatch` so the canvas
 * still contains pure dancer skin, not the user's face on top.
 */
export function sampleDestinationChroma(
  ctx: CanvasRenderingContext2D,
  fh: FaceHoleKeyframe,
): { r: number; g: number; b: number } {
  try {
    const inset = 0.3
    const sw = Math.max(2, Math.round(fh.rx * (1 - inset * 2)))
    const sh = Math.max(2, Math.round(fh.ry * (1 - inset * 2)))
    const sx0 = Math.max(0, Math.round(fh.cx - sw / 2))
    const sy0 = Math.max(0, Math.round(fh.cy - sh / 2))
    const sw2 = Math.min(sw, CANVAS_W - sx0)
    const sh2 = Math.min(sh, CANVAS_H - sy0)
    if (sw2 <= 1 || sh2 <= 1) return { r: 128, g: 128, b: 128 }
    const img = ctx.getImageData(sx0, sy0, sw2, sh2)
    let r = 0, g = 0, b = 0, n = 0
    for (let i = 0; i < img.data.length; i += 4) {
      r += img.data[i]
      g += img.data[i + 1]
      b += img.data[i + 2]
      n++
    }
    return {
      r: Math.round(r / n),
      g: Math.round(g / n),
      b: Math.round(b / n),
    }
  } catch {
    return { r: 128, g: 128, b: 128 }
  }
}

/**
 * Clear the canvas and paint the current video frame. This is the "base" pass —
 * it must run BEFORE any face patch is composited so subsequent steps see pure
 * dancer pixels at the oval position.
 */
export function drawVideoFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
): void {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
  ctx.drawImage(video, 0, 0, CANVAS_W, CANVAS_H)
}

/**
 * Composite the user's face patch onto the oval and paint the soft skin-tone
 * decontamination ring around the seam. Assumes `drawVideoFrame` has already
 * run for this frame.
 *
 * The patch canvas from `cropOval` is square and contains the user's oval
 * masked to a smoothstep alpha. We fit the patch's oval (in patch-local
 * pixels) into the destination oval (in canvas pixels) by uniformly scaling so
 * the smaller axis matches exactly; the larger axis gets the same scale, so
 * the oval becomes a true ellipse with the same aspect as the destination.
 * The patch is then drawn rotated so the user's face follows the dancer's
 * head roll.
 *
 * `fh.headYaw` (degrees, 0 = facing camera) drives two effects so the patch
 * behaves sensibly during a 360° spin: `frontness = max(0, cos(yaw))` shrinks
 * the patch horizontally (0 at perpendicular / back of head) and fades its
 * alpha to 0 across the back-of-head region. When `frontness` is 0 the patch
 * isn't drawn at all — no seam, no wasted clip.
 */
export function drawPatch(
  ctx: CanvasRenderingContext2D,
  fh: FaceHoleKeyframe,
  patch: FacePatch,
  cropTightness: number,
): void {
  const yawRad = (fh.headYaw * Math.PI) / 180
  // 1 at front, 0 at perpendicular or back of head. Using max(0, cos(yaw))
  // means the patch is fully visible only for yaw ∈ [-90°, 90°] (mod 360),
  // i.e. dancer's face roughly toward camera.
  const frontness = Math.max(0, Math.cos(yawRad))
  if (frontness < 0.01) {
    // Back-of-head dead zone — skip the draw entirely. No clip, no ring,
    // no patch pixels on screen.
    return
  }

  const tightness = Math.max(0.3, Math.min(1.5, cropTightness))
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
  const ov = patch.oval
  const sx = fh.rx / ov.rx
  const sy = fh.ry / ov.ry
  const baseScale = Math.min(sx, sy)
  // Horizontal squash: as the head turns away, scale_x drops to 0. This
  // visually communicates "head turned" without needing an actual 3D face
  // model. We scale around the oval's vertical center axis so the squash
  // looks like a perspective flip, not a slide.
  const finalScale = baseScale * tightness

  const patchSize = patch.canvas.width
  const drawSize = patchSize * finalScale

  // Sample the dancer's skin tone inside the oval. Used for the soft edge
  // decontamination ring below.
  const edgeColor = sampleDestinationChroma(ctx, fh)

  // Save state so we can apply non-uniform scale + alpha for the squash/fade.
  ctx.save()
  ctx.globalAlpha *= frontness
  // Translate to oval center, apply head rotation, then squash horizontally
  // toward the vertical centerline. We do the squash as a separate scale
  // around x=0 inside the already-translated frame, so the oval shrinks
  // toward its own vertical axis (mirroring what a real face turning away
  // would look like).
  ctx.translate(fh.cx, fh.cy)
  ctx.rotate(rot)
  ctx.scale(frontness, 1)

  // Clip to the destination oval. Apply AFTER translate/scale so the clip
  // uses the destination's real oval shape, not the squashed one.
  ctx.beginPath()
  ctx.ellipse(0, 0, fh.rx, fh.ry, 0, 0, Math.PI * 2)
  ctx.clip()

  ctx.drawImage(
    patch.canvas,
    -drawSize / 2,
    -drawSize / 2,
    drawSize,
    drawSize,
  )
  ctx.restore()

  // The decontamination ring is painted on the ORIGINAL oval (not the
  // squashed one) so the seam-blending band stays consistent with the
  // destination head silhouette regardless of yaw.
  const ringWidth = Math.min(fh.rx, fh.ry) * 0.08
  const ringInner = Math.max(2, Math.min(fh.rx, fh.ry) - ringWidth)
  const ringOuter = Math.min(fh.rx, fh.ry)
  const grad = ctx.createRadialGradient(
    fh.cx, fh.cy, ringInner,
    fh.cx, fh.cy, ringOuter,
  )
  grad.addColorStop(0, `rgba(${edgeColor.r}, ${edgeColor.g}, ${edgeColor.b}, 0)`)
  grad.addColorStop(1, `rgba(${edgeColor.r}, ${edgeColor.g}, ${edgeColor.b}, ${0.18 * frontness})`)
  ctx.save()
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.ellipse(fh.cx, fh.cy, fh.rx, fh.ry, rot, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/**
 * Convenience: draw a complete frame (video + optional patch + ring).
 *
 * Dispatcher: if the FacePatch has landmarks AND the keyframe has landmarks,
 * use Delaunay-based warping (the user's face conforms to the dancer's
 * actual face shape — eyes/mouth track the dancer's expressions). Otherwise
 * fall back to the legacy oval-based drawPatch.
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  fh: FaceHoleKeyframe,
  assets: DrawAssets,
): void {
  void scene // scene param kept for API parity / future scene-level overlays
  drawVideoFrame(ctx, assets.dancer)
  if (!assets.facePatch) return

  // Compute once: frontness drives the fade-in/out for back-of-head frames.
  const yawRad = (fh.headYaw * Math.PI) / 180
  const frontness = Math.max(0, Math.cos(yawRad))

  if (
    frontness >= 0.01
    && fh.landmarks
    && fh.landmarks.length === 478
    && assets.facePatch.sourceLandmarks
    && assets.facePatch.sourceLandmarks.length === 478
  ) {
    drawWarpedFace(
      ctx,
      assets.facePatch.sourceLandmarks,
      fh.landmarks as Point[],
      assets.facePatch.sourceImage,
      frontness,
    )
    return
  }
  // Fallback: legacy oval mask.
  drawPatch(ctx, fh, assets.facePatch, assets.cropTightness)
}

/**
 * Apply a one-shot Reinhard-style Lab mean/std transfer to the patch so its
 * colour profile matches the dancer's. Resets `patch.canvas` from
 * `patch.originalCanvas` first so a scene switch never re-transforms an
 * already-transformed patch.
 *
 * Called from SceneCanvas AFTER `drawVideoFrame` and BEFORE `drawPatch`, so
 * the destination sample reads pure dancer skin (not the previous frame's
 * composite).
 *
 * Cost is ~5–15 ms on a 400×400 patch; safe to run on the main thread when
 * transitioning scenes (not per frame).
 */
export function applyOneShotColorMatch(
  ctx: CanvasRenderingContext2D,
  fh: FaceHoleKeyframe,
  patch: FacePatch,
  mix = 0.7,
): void {
  try {
    // Reset the working canvas from the untouched source so this match is
    // always computed from the user's original face pixels — not from a
    // previously colour-matched version of the same patch.
    const patchCtx = patch.canvas.getContext('2d', { willReadFrequently: true })
    if (!patchCtx) return
    patchCtx.clearRect(0, 0, patch.canvas.width, patch.canvas.height)
    patchCtx.drawImage(patch.originalCanvas, 0, 0)

    // Sample a chunk of the dancer's face area. Reuse the same region as the
    // chroma sampler so we're comparing apples to apples.
    const inset = 0.3
    const sw = Math.max(2, Math.round(fh.rx * (1 - inset * 2)))
    const sh = Math.max(2, Math.round(fh.ry * (1 - inset * 2)))
    const sx0 = Math.max(0, Math.round(fh.cx - sw / 2))
    const sy0 = Math.max(0, Math.round(fh.cy - sh / 2))
    const sw2 = Math.min(sw, CANVAS_W - sx0)
    const sh2 = Math.min(sh, CANVAS_H - sy0)
    if (sw2 <= 1 || sh2 <= 1) return
    const dstImageData = ctx.getImageData(sx0, sy0, sw2, sh2)
    transferPatchToMatch(patch.canvas, dstImageData, mix)
  } catch {
    // CORS-tainted canvas: skip the colour match. The decontamination ring
    // still helps blend the seam.
  }
}
