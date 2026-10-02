/**
 * Scene definitions for dance.goonify.fun.
 *
 * Each scene references a pre-rendered H4 dancer plate (a ping-pong webm that
 * loops seamlessly) and a keyframe track describing where the dancer's face
 * oval is in CANVAS pixel coords (1280×720) at evenly-spaced t values in
 * [0..1]. `faceHoleAt(scene, t)` linearly interpolates between keyframes.
 *
 * Keyframes are auto-measured by `pnpm measure-keyframes`, which spins up a
 * headless Chromium, runs MediaPipe BlazeFace against every keyframe of every
 * scene's webm, and converts the detector's bbox + 6 keypoints into a face
 * oval + rough head-yaw estimate. Re-run that command after regenerating a
 * plate; the script writes `scripts/keyframes-measured.json` and prints a
 * paste-ready table.
 *
 * - The "front" plate is a slow vertical bob with a tiny horizontal sway.
 *   The dancer's face sits upper-centre; cx sways 646-720 and cy bobs
 *   204-245 over the loop.
 * - The "side" plate shows the dancer doing a 360° spin around the pole.
 *   The pose-spin-pose structure means yaw = 0 at the start/end keyframes,
 *   jumps to 180° (back of head, patch invisible) for the middle keyframes,
 *   and returns to 0°. The patch fades in/out smoothly across the yaw=90°
 *   dead zone.
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
      // H4 plate: GTA Vice City cel-shaded dancer, slow vertical hip-bob
      // grind. Head fully visible in the upper-centre of the frame, dancer
      // facing camera throughout (headYaw ≈ 0). All 7 keyframes measured
      // directly by MediaPipe BlazeFace (see scripts/measure-keyframes.mjs);
      // rx/ry track the face bbox (tightened 45%/55% like the user's
      // FacePicker). cx sways ±40px horizontally and cy bobs ±25px
      // vertically across the loop.
      { t: 0.000, cx: 694, cy: 223, rx: 82, ry: 99, rotation: 0, headYaw: 1 },
      { t: 0.166, cx: 695, cy: 235, rx: 84, ry: 101, rotation: 0, headYaw: 0 },
      { t: 0.333, cx: 697, cy: 218, rx: 85, ry: 102, rotation: 0, headYaw: 1 },
      { t: 0.500, cx: 720, cy: 216, rx: 87, ry: 104, rotation: 0, headYaw: 1 },
      { t: 0.666, cx: 673, cy: 204, rx: 81, ry: 97, rotation: 0, headYaw: 0 },
      { t: 0.833, cx: 646, cy: 245, rx: 84, ry: 101, rotation: 0, headYaw: 0 },
      { t: 1.000, cx: 694, cy: 223, rx: 81, ry: 97, rotation: 0, headYaw: 1 },
    ],
  },
  {
    id: 'club-side-grind',
    title: 'side',
    dancer: '/templates/scenes/dancer-side-grind.webm',
    track: [
      // H4 plate: pose-spin-pose. First/last quarter = dancer facing camera
      // (headYaw = 0). Middle = 360° spin (headYaw = 180, patch invisible).
      // Position at the back-of-head keyframes (k2..k4) is purely cosmetic —
      // `frontness = max(0, cos(yaw)) = 0` so the patch is skipped entirely.
      // We anchor the back-of-head oval to k1's position (head tilted down,
      // closest valid detection) so the metadata is at least consistent.
      // k1 face is partially occluded by the head tilt (eyes closed) — conf
      // 0.53 but bbox is in the right place, kept.
      // k5 face is fully visible with head turned slightly — conf 0.59,
      // kept.
      // Loop wraps cleanly: t=0 and t=1 are the same front-facing pose.
      { t: 0.000, cx: 696, cy: 222, rx: 82, ry: 99, rotation: 0, headYaw: 1 },
      { t: 0.166, cx: 612, cy: 154, rx: 76, ry: 91, rotation: 0, headYaw: 0 },
      { t: 0.333, cx: 612, cy: 154, rx: 76, ry: 91, rotation: 0, headYaw: 180 },
      { t: 0.500, cx: 612, cy: 154, rx: 76, ry: 91, rotation: 0, headYaw: 180 },
      { t: 0.666, cx: 612, cy: 154, rx: 76, ry: 91, rotation: 0, headYaw: 180 },
      { t: 0.833, cx: 585, cy: 133, rx: 78, ry: 94, rotation: 0, headYaw: 0 },
      { t: 1.000, cx: 693, cy: 224, rx: 81, ry: 97, rotation: 0, headYaw: 1 },
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
