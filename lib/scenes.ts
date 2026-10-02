/**
 * Scene definitions for dance.goonify.fun.
 *
 * Each scene references a pre-rendered H3 dancer plate (a ping-pong webm that
 * loops seamlessly) and a keyframe track describing where the dancer's face
 * oval is in CANVAS pixel coords (1280×720) at evenly-spaced t values in
 * [0..1]. `faceHoleAt(scene, t)` linearly interpolates between keyframes.
 *
 * Keyframes were measured from the actual shipped plates by extracting frames
 * at the loop's 6 evenly-spaced timestamps, finding the smooth face-oval
 * placeholder by low-local-variance skin detection, and correcting by eye.
 *
 * - The "front" plate is a slow vertical bob with a tiny horizontal sway. The
 *   dancer's head extends past the top edge of the frame; the oval radii cover
 *   the entire visible face area (cheekbones → chin, hairline → past frame top).
 * - The "side" plate shows the dancer doing a 360° spin around the pole. The
 *   oval stays roughly in the upper-center of the frame but its position and
 *   radii shift as she turns (largest when facing camera, smallest in profile).
 */

export type FaceHoleKeyframe = {
  t: number
  cx: number
  cy: number
  rx: number
  ry: number
  rotation: number  // degrees; positive = clockwise
}

export type Scene = {
  id: string
  title: string
  dancer: string
  /** Keyframes evenly spaced across t ∈ [0..1]; first and last share values
   *  so the loop wraps invisibly. */
  track: FaceHoleKeyframe[]
}

// Canvas resolution — kept in sync with SceneCanvas.tsx and drawScene.ts.
export const CANVAS_W = 1280
export const CANVAS_H = 720

export const SCENES: Scene[] = [
  {
    id: 'club-front-grind',
    title: 'front',
    dancer: '/templates/scenes/dancer-front-grind.webm',
    track: [
      // The face oval is large; the head extends past the top of the frame.
      // Slow vertical bob (~25 px peak-to-peak) + tiny horizontal sway.
      // cx values tuned by overlaying the keyframe onto the actual frames and
      // checking it lines up with the smooth face placeholder.
      { t: 0.000, cx: 820, cy: 170, rx: 265, ry: 165, rotation: 0 },
      { t: 0.166, cx: 820, cy: 180, rx: 265, ry: 165, rotation: 0 },
      { t: 0.333, cx: 810, cy: 190, rx: 265, ry: 165, rotation: 0 },
      { t: 0.500, cx: 810, cy: 192, rx: 265, ry: 168, rotation: 0 },
      { t: 0.666, cx: 810, cy: 190, rx: 265, ry: 165, rotation: 0 },
      { t: 0.833, cx: 820, cy: 180, rx: 265, ry: 165, rotation: 0 },
      { t: 1.000, cx: 820, cy: 170, rx: 265, ry: 165, rotation: 0 },
    ],
  },
  {
    id: 'club-side-grind',
    title: 'side',
    dancer: '/templates/scenes/dancer-side-grind.webm',
    track: [
      // The dancer spins around the pole. Her face oval position in screen
      // space oscillates as she rotates:
      //   t=0/1 — facing camera, oval at head-centre (upper centre of frame)
      //   t≈0.166 — 3/4 turn to her right; oval on the LEFT of head silhouette
      //   t≈0.333 — back to camera; small oval at top of head silhouette
      //   t≈0.500 — 3/4 turn to her left; oval on the RIGHT of head silhouette
      //   t≈0.666 — back to camera again (she's now past 180°)
      //   t≈0.833 — 3/4 turn to her right again (mirror of 0.166)
      // The placeholder oval is axis-aligned in screen space — rotation stays 0.
      { t: 0.000, cx: 555, cy: 158, rx: 60, ry: 58, rotation: 0 },
      { t: 0.166, cx: 445, cy: 178, rx: 48, ry: 58, rotation: 0 },
      { t: 0.333, cx: 515, cy: 142, rx: 44, ry: 46, rotation: 0 },
      { t: 0.500, cx: 620, cy: 162, rx: 56, ry: 58, rotation: 0 },
      { t: 0.666, cx: 475, cy: 142, rx: 44, ry: 46, rotation: 0 },
      { t: 0.833, cx: 445, cy: 178, rx: 48, ry: 58, rotation: 0 },
      { t: 1.000, cx: 555, cy: 158, rx: 60, ry: 58, rotation: 0 },
    ],
  },
]

export function getScene(id: string): Scene | undefined {
  return SCENES.find((s) => s.id === id)
}

/**
 * Linearly interpolate between keyframes for the current video time t (0..1).
 * t=0 and t=1 share values, so the loop wraps invisibly.
 */
export function faceHoleAt(scene: Scene, t: number): FaceHoleKeyframe {
  const k = scene.track
  if (k.length === 0) {
    return { t: 0, cx: CANVAS_W / 2, cy: CANVAS_H / 2, rx: 80, ry: 90, rotation: 0 }
  }
  if (k.length === 1 || t <= k[0].t) return k[0]
  if (t >= k[k.length - 1].t) return k[k.length - 1]

  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i], b = k[i + 1]
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t
      const u = span === 0 ? 0 : (t - a.t) / span
      return {
        t,
        cx: a.cx + (b.cx - a.cx) * u,
        cy: a.cy + (b.cy - a.cy) * u,
        rx: a.rx + (b.rx - a.rx) * u,
        ry: a.ry + (b.ry - a.ry) * u,
        rotation: a.rotation + (b.rotation - a.rotation) * u,
      }
    }
  }
  return k[k.length - 1]
}
