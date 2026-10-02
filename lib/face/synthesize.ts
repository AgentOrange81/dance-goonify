/**
 * Synthesize the 478-pt MediaPipe FaceLandmarker mesh for a keyframe that
 * doesn't have measured landmarks (blankface plates — MediaPipe can't detect
 * facial features, so `pnpm measure-keyframes` returns empty arrays).
 *
 * Strategy: project the canonical face mesh (CANONICAL_FACE_LANDMARKS, derived
 * from a measured plate-06 reference frame) into the keyframe's
 * (cx, cy, rx, ry, rotation). The result is a face-shaped oval of landmarks
 * sized exactly to fit the destination oval, so the Delaunay-warp path
 * (`drawWarpedFace`) gets invoked with a sensible destination mesh and the
 * user's face lands properly aligned inside the oval instead of being
 * stretched by the legacy oval path.
 *
 * Quality: not as accurate as a per-frame MediaPipe measurement (which would
 * track the dancer's actual expression), but plate 05/01 are blankface so
 * there's no expression to track anyway. The result is a static face-shaped
 * patch positioned at (cx, cy) with face proportions matching the oval's
 * aspect. Good enough for the warp draw path.
 *
 * If you ever swap in a plate that DOES have a real face (e.g. regenerate
 * plate 06 with a blankface prompt constraint), keep the measured landmarks
 * — they're more accurate than this synthesis.
 */

import { CANONICAL_FACE_LANDMARKS } from './canonical'
import type { Point } from './warp'

export function synthesizeFaceLandmarks(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rotation: number,
): Point[] {
  const rot = (rotation * Math.PI) / 180
  const cosR = Math.cos(rot)
  const sinR = Math.sin(rot)
  // Pre-allocate the result so a 7-keyframe × 60-fps loop doesn't churn the GC.
  const n478 = CANONICAL_FACE_LANDMARKS.length
  const out: Point[] = new Array(n478)
  for (let i = 0; i < n478; i++) {
    const p = CANONICAL_FACE_LANDMARKS[i]
    // Scale canonical -> frame, then rotate, then translate to (cx, cy).
    // Order: scale (x*rx, y*ry), then rotate by `rotation` around origin,
    // then translate by (cx, cy).
    const sx = p.x * rx
    const sy = p.y * ry
    out[i] = {
      x: cx + cosR * sx - sinR * sy,
      y: cy + sinR * sx + cosR * sy,
    }
  }
  return out
}