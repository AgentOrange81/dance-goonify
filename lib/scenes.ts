/**
 * Scene definitions for dance.goonify.fun.
 *
 * Each scene references a pre-rendered H4 dancer plate (a ping-pong webm that
 * loops seamlessly) and a keyframe track describing where the dancer's face
 * oval is in CANVAS pixel coords (1280×720) at evenly-spaced t values in
 * [0..1]. `faceHoleAt(scene, t)` linearly interpolates between keyframes.
 *
 * Keyframes are auto-measured by `pnpm measure-keyframes`, which spins up a
 * headless Chromium, runs MediaPipe FaceLandmarker against every keyframe of
 * every scene's webm, and extracts (a) a face-only bbox from the 478
 * landmarks and (b) real head yaw (0..180°) from the 4×4 facial transformation
 * matrix. Re-run that command after regenerating a plate; the script writes
 * `scripts/keyframes-measured.json` and prints a paste-ready table.
 *
 * - The "front" plate is a slow vertical bob with a tiny horizontal sway.
 *   The dancer's face sits upper-centre; cx sways 655-711 and cy bobs
 *   206-235 over the loop, with consistent ~16-29° yaw (real head angle,
 *   not a heuristic — she's leaning into a 3/4 stance throughout).
 * - The "side" plate shows the dancer doing a 360° spin around the pole.
 *   Pose-spin-pose: yaw = 17 → 34 → 180 → 180 → 180 → 39 → 19. The patch
 *   fades out smoothly through the yaw=90° dead zone between k1 and k2, and
 *   fades back in between k4 and k5. Back-of-head keyframes (k2-k4) are
 *   where no face is detectable at all.
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
      // grind. Head fully visible in the upper-centre of the frame; dancer
      // roughly faces camera with the body turned slightly to her right
      // (subject's right, viewer's left). MediaPipe FaceLandmarker reports
      // a consistent ~20° baseline yaw on these frames, which is the real
      // head pose — the dancer is leaning into a 3/4 stance throughout.
      // cx sways ±40px horizontally and cy bobs ±25px vertically across
      // the loop; rx/ry track the face bbox (tightened to face-only).
      { t: 0.000, cx: 697, cy: 210, rx: 76, ry: 101, rotation: 0, headYaw: 16 },
      { t: 0.166, cx: 701, cy: 230, rx: 73, ry: 97, rotation: 0, headYaw: 18 },
      { t: 0.333, cx: 690, cy: 223, rx: 83, ry: 102, rotation: 0, headYaw: 22 },
      { t: 0.500, cx: 711, cy: 216, rx: 77, ry: 101, rotation: 0, headYaw: 22 },
      { t: 0.666, cx: 676, cy: 206, rx: 67, ry: 98, rotation: 0, headYaw: 29 },
      { t: 0.833, cx: 655, cy: 235, rx: 74, ry: 97, rotation: 0, headYaw: 19 },
      { t: 1.000, cx: 696, cy: 210, rx: 76, ry: 101, rotation: 0, headYaw: 17 },
    ],
  },
  {
    id: 'club-side-grind',
    title: 'side',
    dancer: '/templates/scenes/dancer-side-grind.webm',
    track: [
      // H4 plate: pose-spin-pose. k0/k1 = dancer facing camera with chin
      // tucked (yaw 17-34°). k2/k3/k4 = mid-spin, back of head (FaceLandmarker
      // can't find a face; yaw = 180 → patch invisible). k5 = dancer facing
      // camera again with head turned slightly to viewer's right (yaw 39°).
      // k6 = front-facing, matches k0 for clean loop wrap.
      //
      // Linear yaw interpolation across the k1→k2 and k4→k5 transitions
      // gives the patch a smooth fade-out / fade-in through the yaw=90°
      // dead zone — better than the old hand-tuned 0/0/180/180/0/60/0.
      // Back-of-head keyframes use k1's coords as a placeholder (cosmetic
      // only — patch is invisible at yaw=180).
      { t: 0.000, cx: 696, cy: 210, rx: 75, ry: 101, rotation: 0, headYaw: 17 },
      { t: 0.166, cx: 622, cy: 143, rx: 76, ry: 99, rotation: 0, headYaw: 34 },
      { t: 0.333, cx: 622, cy: 143, rx: 76, ry: 99, rotation: 0, headYaw: 180 },
      { t: 0.500, cx: 640, cy: 220, rx: 82, ry: 99, rotation: 0, headYaw: 180 },
      { t: 0.666, cx: 589, cy: 130, rx: 64, ry: 101, rotation: 0, headYaw: 180 },
      { t: 0.833, cx: 589, cy: 130, rx: 64, ry: 101, rotation: 0, headYaw: 39 },
      { t: 1.000, cx: 695, cy: 210, rx: 75, ry: 100, rotation: 0, headYaw: 19 },
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
