/**
 * Face warp — Delaunay-triangulate a subset of MediaPipe FaceLandmarker
 * landmarks on the user's photo, then render the source photo through
 * per-triangle affine transforms so the user's face deforms to align with
 * the dancer's pose/expression.
 *
 * Why this exists:
 *   The old "oval mask + scale" face-swap looked like a floating sticker
 *   because it ignored the dancer's actual face shape — eyes/mouth
 *   positions, head turn, mouth opening. With Delaunay warping, each
 *   triangle in the user's face is independently transformed to match the
 *   corresponding triangle on the dancer's face, so the user's mouth moves
 *   with the dancer's mouth, eyes track the gaze, etc.
 *
 * Anchor set:
 *   We don't use all 478 landmarks — that would be too many tiny triangles
 *   for the visual gain. We pick 16 stable points (face contour extremes,
 *   eyes, brows, nose, mouth, cheeks) and let Delaunator triangulate them.
 *   The triangles are then triangulated ONCE per (user-photo, dancer-frame)
 *   pair; affine coefficients get cached and re-applied per RAF tick.
 *
 *   The triangulation is computed in user-space. The triangle vertex
 *   indices are reused as-is on the dancer face (same MediaPipe canonical
 *   mesh → same indices).
 */

import Delaunator from 'delaunator'

export type Point = { x: number; y: number }

/** 16 stable landmarks, hand-picked from MediaPipe's 478-point face mesh. */
export const FACE_ANCHOR_INDICES = [
  10,   // forehead top center
  152,  // chin
  234,  // left tragion (subject's left)
  454,  // right tragion
  33,   // right eye outer corner (subject's right)
  263,  // left eye outer corner
  1,    // nose tip
  4,    // nose bridge upper
  13,   // upper lip top center
  14,   // lower lip bottom center
  78,   // mouth left corner
  308,  // mouth right corner
  105,  // right brow inner
  334,  // left brow inner
  21,   // left cheek
  251,  // right cheek
] as const

/**
 * Closed face contour (jaw + brow arch). Drives the mask clip — anything
 * outside this polygon never gets drawn. Index list is hand-curated from
 * MediaPipe's canonical mesh and goes around the face once.
 */
export const FACE_CONTOUR_INDICES = [
  10,    // top of forehead (already an anchor)
  338, 297, 332, 284, 251, 389, 356, 454,  // right brow → right cheek → right side
  323, 361, 288, 397, 365, 379, 378, 400, 377,  // right jaw
  152,  // chin (already an anchor)
  148, 176, 149, 150, 136, 172, 58, 132, 93, 234,  // left jaw
  127, 162, 21, 54, 103, 67, 109,  // left cheek → left brow
  // back to 10 to close the loop
] as const

/**
 * Compute the affine transform that maps the source triangle to the
 * destination triangle. The returned [a, b, c, d, e, f] can be passed
 * directly to ctx.setTransform(a, b, c, d, e, f).
 */
export function computeAffine(src: Point[], dst: Point[]): [number, number, number, number, number, number] {
  const [s0, s1, s2] = src
  const [d0, d1, d2] = dst

  // Edge vectors in source space
  const sx1 = s1.x - s0.x
  const sy1 = s1.y - s0.y
  const sx2 = s2.x - s0.x
  const sy2 = s2.y - s0.y

  // Edge vectors in destination space
  const dx1 = d1.x - d0.x
  const dy1 = d1.y - d0.y
  const dx2 = d2.x - d0.x
  const dy2 = d2.y - d0.y

  // Determinant of the 2x2 source-to-destination mapping for the linear part.
  const det = sx1 * sy2 - sx2 * sy1
  if (Math.abs(det) < 1e-9) {
    // Degenerate triangle (collinear points). Bail out with a translate-only
    // transform — the triangle draws to a degenerate region anyway.
    return [1, 0, 0, 1, d0.x - s0.x, d0.y - s0.y]
  }
  const invDet = 1 / det

  // Solve: linear_part * [sx1 sy1; sx2 sy2] = [dx1 dy1; dx2 dy2]
  // → linear_part = [dx1 dy1; dx2 dy2] * inv([sx1 sy1; sx2 sy2])
  const a = (sy2 * dx1 - sy1 * dx2) * invDet
  const b = (sy2 * dy1 - sy1 * dy2) * invDet
  const c = (-sx2 * dx1 + sx1 * dx2) * invDet
  const d = (-sx2 * dy1 + sx1 * dy2) * invDet

  // Translation: dst_0 = M * src_0 + (e, f)  →  (e, f) = dst_0 - M * src_0
  const e = d0.x - (a * s0.x + c * s0.y)
  const f = d0.y - (b * s0.x + d * s0.y)
  return [a, b, c, d, e, f]
}

/**
 * Build the triangle list (each entry = [idxA, idxB, idxC] into the
 * 478-landmark array) by Delaunay-triangulating the anchor subset.
 * Computed once on user-space landmarks — the resulting indices apply
 * equally to the destination because MediaPipe's landmark ordering is canonical.
 */
export function buildTriangleList(landmarks: readonly Point[]): number[][] {
  const n = FACE_ANCHOR_INDICES.length
  const coords = new Float64Array(n * 2)
  for (let i = 0; i < n; i++) {
    const lm = landmarks[FACE_ANCHOR_INDICES[i]]
    coords[i * 2] = lm.x
    coords[i * 2 + 1] = lm.y
  }
  const d = new Delaunator(coords)
  const tris = []
  for (let i = 0; i < d.triangles.length; i += 3) {
    tris.push([
      FACE_ANCHOR_INDICES[d.triangles[i]],
      FACE_ANCHOR_INDICES[d.triangles[i + 1]],
      FACE_ANCHOR_INDICES[d.triangles[i + 2]],
    ])
  }
  return tris
}

/**
 * Render the warped user face onto `ctx` so the user's face conforms to the
 * dancer's pose.
 *
 * `userLandmarks` and `dancerLandmarks` are the SAME indices (canonical
 * MediaPipe mesh) but in different coordinate systems:
 *   - userLandmarks: pixel coords on the user's source photo
 *   - dancerLandmarks: pixel coords on the 1280×720 dancer canvas
 *
 * `sourceImage` is the full user photo (HTMLImageElement or
 * HTMLCanvasElement). The dancer's face contour acts as the mask clip.
 *
 * `frontness` ∈ [0, 1] fades the patch out as the dancer turns away
 * (matches the old `headYaw` system so back-of-head frames still skip the
 * draw).
 */
export function drawWarpedFace(
  ctx: CanvasRenderingContext2D,
  userLandmarks: readonly Point[],
  dancerLandmarks: readonly Point[],
  sourceImage: CanvasImageSource,
  frontness: number,
): void {
  if (frontness < 0.01) return

  // 1. Outer clip: the dancer's face contour polygon. This is what gives the
  //    swapped face its actual face-shaped boundary, not a generic ellipse.
  ctx.save()
  ctx.beginPath()
  for (let i = 0; i < FACE_CONTOUR_INDICES.length; i++) {
    const p = dancerLandmarks[FACE_CONTOUR_INDICES[i]]
    if (i === 0) ctx.moveTo(p.x, p.y)
    else ctx.lineTo(p.x, p.y)
  }
  ctx.closePath()
  ctx.clip()

  // 2. Per-triangle warp. Triangulation is built once per call (cheap for 16
  //    points), then each triangle is rendered independently with its own
  //    affine transform — the user's face deforms so each triangle's
  //    vertices land exactly on the corresponding dancer-face vertices.
  const triangles = buildTriangleList(userLandmarks)
  ctx.globalAlpha *= frontness

  for (const tri of triangles) {
    const [i0, i1, i2] = tri
    const srcPts: Point[] = [
      userLandmarks[i0],
      userLandmarks[i1],
      userLandmarks[i2],
    ]
    const dstPts: Point[] = [
      dancerLandmarks[i0],
      dancerLandmarks[i1],
      dancerLandmarks[i2],
    ]

    // Inner per-triangle clip — ensures triangles don't bleed into each
    // other at edges where rounding errors in the affine would leave seams.
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(dstPts[0].x, dstPts[0].y)
    ctx.lineTo(dstPts[1].x, dstPts[1].y)
    ctx.lineTo(dstPts[2].x, dstPts[2].y)
    ctx.closePath()
    ctx.clip()

    // Apply the affine + draw. setTransform replaces the current transform;
    // we restore() right after, so each triangle starts from a clean state.
    const [a, b, c, d, e, f] = computeAffine(srcPts, dstPts)
    ctx.setTransform(a, b, c, d, e, f)
    ctx.drawImage(sourceImage, 0, 0)

    ctx.restore()
  }

  ctx.restore()
}