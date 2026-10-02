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
  /** Head yaw in degrees, 0 = facing camera, 90 = head turned 90° to camera's
   *  right (dancer's left if facing camera), 180 = back of head. Used to fade
   *  the face patch and squash it horizontally so it doesn't sit on the back
   *  of the dancer's head during a 360° spin. Linear interp between keyframes
   *  is fine — visibility is driven by `max(0, cos(yaw))` so the back-of-head
   *  dead zone is naturally wide enough. */
  headYaw: number
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
      // H4 plate: GTA Vice City cel-shaded dancer, slow vertical hip-bob grind.
      // Head sits upper-centre with hair extending past the top of the frame,
      // so the oval extends past the top (cy − ry < 0) — fine, the renderer
      // clamps it. cx/cy measured from extracted frames at 7 evenly-spaced
      // timestamps; headYaw = 0 throughout (no perceptible rotation in the
      // front plate, so the patch sits fully on for the whole loop).
      { t: 0.000, cx: 640, cy: 140, rx: 130, ry: 130, rotation: 0, headYaw: 0 },
      { t: 0.166, cx: 640, cy: 150, rx: 130, ry: 140, rotation: 0, headYaw: 0 },
      { t: 0.333, cx: 640, cy: 170, rx: 125, ry: 140, rotation: 0, headYaw: 0 },
      { t: 0.500, cx: 640, cy: 160, rx: 130, ry: 140, rotation: 0, headYaw: 0 },
      { t: 0.666, cx: 640, cy: 140, rx: 130, ry: 130, rotation: 0, headYaw: 0 },
      { t: 0.833, cx: 640, cy: 170, rx: 125, ry: 140, rotation: 0, headYaw: 0 },
      { t: 1.000, cx: 640, cy: 140, rx: 130, ry: 130, rotation: 0, headYaw: 0 },
    ],
  },
  {
    id: 'club-side-grind',
    title: 'side',
    dancer: '/templates/scenes/dancer-side-grind.webm',
    track: [
      // H4 plate: pose-spin-pose. First quarter + last quarter = dancer
      // facing camera (headYaw ≈ 0). Middle = 360° spin (headYaw passes
      // through 180° at k2 and k3). k3 puts the dancer's body on the right
      // side of frame as she completes the rotation; cx/cy there just keep
      // the oval attached to the head silhouette (the patch is invisible
      // anyway because yaw ∈ [90°, 270°]). Loop wraps cleanly: t=0 and t=1
      // are the same front-facing pose (≈1% pixel difference).
      { t: 0.000, cx: 640, cy: 140, rx: 140, ry: 130, rotation: 0, headYaw: 0 },
      { t: 0.166, cx: 640, cy: 140, rx: 130, ry: 140, rotation: 0, headYaw: 15 },
      { t: 0.333, cx: 700, cy: 150, rx: 110, ry: 140, rotation: 0, headYaw: 180 },
      { t: 0.500, cx: 1020, cy: 140, rx: 120, ry: 140, rotation: 0, headYaw: 180 },
      { t: 0.666, cx: 640, cy: 170, rx: 110, ry: 130, rotation: 0, headYaw: 0 },
      { t: 0.833, cx: 640, cy: 150, rx: 130, ry: 130, rotation: 0, headYaw: 60 },
      { t: 1.000, cx: 640, cy: 140, rx: 140, ry: 130, rotation: 0, headYaw: 0 },
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
    return { t: 0, cx: CANVAS_W / 2, cy: CANVAS_H / 2, rx: 80, ry: 90, rotation: 0, headYaw: 0 }
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
        headYaw: a.headYaw + (b.headYaw - a.headYaw) * u,
      }
    }
  }
  return k[k.length - 1]
}
