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

// Solve a 3x3 linear system via Cramer's rule.
// Each row is [a, b, c]; the constant vector is [d, e, f]. Returns [a, b, c] such that
// a*X + b*Y + c = Z for each input point.
function solveAffine(
  xs: number[], ys: number[], zs: number[],
): { a: number; b: number; c: number } | null {
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])

  const M = xs.map((x, i) => [x, ys[i], 1])
  const D = det(M)
  if (Math.abs(D) < 1e-6) return null

  // Replace column 0 with zs → solve for 'a'
  const Ma = M.map((row, i) => [zs[i], row[1], row[2]])
  // Replace column 1 with zs → solve for 'b'
  const Mb = M.map((row, i) => [row[0], zs[i], row[2]])
  // Replace column 2 with zs → solve for 'c'
  const Mc = M.map((row, i) => [row[0], row[1], zs[i]])

  return { a: det(Ma) / D, b: det(Mb) / D, c: det(Mc) / D }
}

// Draws one frame: background → dancer (video frame) → face patch affine-warped to dancer's
// landmark positions and clipped to the faceHole oval.
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

  // Convert dancerLandmarks from 1344x768 (video native) to 1280x720 (canvas coords).
  const sx = 1280 / 1344
  const sy = 720 / 768
  const D = {
    leftEye:    { x: scene.dancerLandmarks.leftEye.x * sx,    y: scene.dancerLandmarks.leftEye.y * sy },
    rightEye:   { x: scene.dancerLandmarks.rightEye.x * sx,   y: scene.dancerLandmarks.rightEye.y * sy },
    nose:       { x: scene.dancerLandmarks.nose.x * sx,       y: scene.dancerLandmarks.nose.y * sy },
    mouthLeft:  { x: scene.dancerLandmarks.mouthLeft.x * sx,  y: scene.dancerLandmarks.mouthLeft.y * sy },
    mouthRight: { x: scene.dancerLandmarks.mouthRight.x * sx, y: scene.dancerLandmarks.mouthRight.y * sy },
  }

  // Rotate the dancer's destination landmarks around faceHole center by faceHole.rotation.
  const rot = (fh.rotation * Math.PI) / 180
  const cosR = Math.cos(rot)
  const sinR = Math.sin(rot)
  const rotateAround = (p: { x: number; y: number }) => ({
    x: fh.cx + (p.x - fh.cx) * cosR - (p.y - fh.cy) * sinR,
    y: fh.cy + (p.x - fh.cx) * sinR + (p.y - fh.cy) * cosR,
  })
  const Drot = {
    leftEye:    rotateAround(D.leftEye),
    rightEye:   rotateAround(D.rightEye),
    nose:       rotateAround(D.nose),
    mouthLeft:  rotateAround(D.mouthLeft),
    mouthRight: rotateAround(D.mouthRight),
  }

  // Source landmarks (already in patch coords). Apply tightness by scaling around patch center.
  const S = assets.facePatch.landmarksInPatch
  const patchSize = assets.facePatch.canvas.width
  const pc = patchSize / 2
  const tScale = tightness
  const sP = (p: { x: number; y: number }) => ({
    x: pc + (p.x - pc) * tScale,
    y: pc + (p.y - pc) * tScale,
  })
  const Ssc = {
    leftEye:    sP(S.leftEye),
    rightEye:   sP(S.rightEye),
    nose:       sP(S.nose),
    mouthLeft:  sP(S.mouthLeft),
    mouthRight: sP(S.mouthRight),
  }

  // 3-anchor affine: leftEye, rightEye, mouth-center.
  const sMouthX = (Ssc.mouthLeft.x + Ssc.mouthRight.x) / 2
  const sMouthY = (Ssc.mouthLeft.y + Ssc.mouthRight.y) / 2
  const dMouthX = (Drot.mouthLeft.x + Drot.mouthRight.x) / 2
  const dMouthY = (Drot.mouthLeft.y + Drot.mouthRight.y) / 2

  const srcXs = [Ssc.leftEye.x, Ssc.rightEye.x, sMouthX]
  const srcYs = [Ssc.leftEye.y, Ssc.rightEye.y, sMouthY]
  const dxAff = solveAffine(srcXs, srcYs, [Drot.leftEye.x, Drot.rightEye.x, dMouthX])
  const dyAff = solveAffine(srcXs, srcYs, [Drot.leftEye.y, Drot.rightEye.y, dMouthY])

  if (!dxAff || !dyAff) {
    // Degenerate — landmarks collinear. Skip face composite this frame.
    return
  }

  // Clip to the rotated oval
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(fh.cx, fh.cy, fh.rx, fh.ry, rot, 0, Math.PI * 2)
  ctx.clip()

  // Apply the affine and draw the patch
  ctx.setTransform(dxAff.a, dxAff.b, dyAff.a, dyAff.b, dxAff.c, dyAff.c)
  ctx.drawImage(assets.facePatch.canvas, 0, 0)

  ctx.restore()
}