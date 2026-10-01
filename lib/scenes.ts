export type FaceHoleKeyframe = {
  t: number
  cx: number
  cy: number
  rx: number
  ry: number
  rotation: number
}

export type Scene = {
  id: string
  title: string
  background: string
  dancer: string
  track: FaceHoleKeyframe[]
}

const CLUB_ROOM = '/templates/scenes/club-room-empty.webp'

// Keyframes measured from the NEW H3-regenerated plates (batch2).
//
// Front v2 (best loop of 3 variants, wrap diff = 8.46):
//   - Cinematic front close-up, head and shoulders framing
//   - Dancer's body is on the right side of the frame
//   - Face oval: cx=950, cy=185, rx=170, ry=200 (almost circular, near full head)
//   - Small head bob through the cycle (cx varies 920-960, cy varies 165-200)
//
// Side v3 (best loop of 3 variants, wrap diff = 2.29 — perfect loop):
//   - Full body 3/4 angle, dancer positioned left of frame
//   - Face oval: cx=460, cy=170, rx=60, ry=85 (tall narrow oval)
//   - Minimal head motion through cycle (oval stays roughly in place)
//
// IMPORTANT: t=0 and t=1.0 keyframes MUST match exactly for loop closure.
// We set them to the same values explicitly.
//
// Source: H3 generations batch2 (front_v2, side_v3). Cost: $2.88 of $15 cap.
// Measurements: native 1344x768 video frames scaled to 1280x720 canvas coords.

export const SCENES: Scene[] = [
  {
    id: 'club-front-grind',
    title: 'front',
    background: CLUB_ROOM,
    dancer: '/templates/scenes/dancer-front-grind.webm',
    track: [
      { t: 0.000, cx: 950, cy: 185, rx: 170, ry: 200, rotation: 0 },
      { t: 0.166, cx: 945, cy: 180, rx: 170, ry: 200, rotation: 0 },
      { t: 0.333, cx: 935, cy: 195, rx: 170, ry: 200, rotation: 0 },
      { t: 0.500, cx: 925, cy: 200, rx: 170, ry: 200, rotation: 0 },
      { t: 0.666, cx: 935, cy: 195, rx: 170, ry: 200, rotation: 0 },
      { t: 0.833, cx: 945, cy: 185, rx: 170, ry: 200, rotation: 0 },
      { t: 1.000, cx: 950, cy: 185, rx: 170, ry: 200, rotation: 0 },
    ],
  },
  {
    id: 'club-side-grind',
    title: 'side',
    background: CLUB_ROOM,
    dancer: '/templates/scenes/dancer-side-grind.webm',
    track: [
      { t: 0.000, cx: 460, cy: 170, rx: 60, ry: 85, rotation: -10 },
      { t: 0.166, cx: 458, cy: 165, rx: 60, ry: 85, rotation: -10 },
      { t: 0.333, cx: 462, cy: 175, rx: 60, ry: 85, rotation: -10 },
      { t: 0.500, cx: 460, cy: 170, rx: 60, ry: 85, rotation: -10 },
      { t: 0.666, cx: 458, cy: 168, rx: 60, ry: 85, rotation: -10 },
      { t: 0.833, cx: 460, cy: 172, rx: 60, ry: 85, rotation: -10 },
      { t: 1.000, cx: 460, cy: 170, rx: 60, ry: 85, rotation: -10 },
    ],
  },
]

export function getScene(id: string): Scene | undefined {
  return SCENES.find((s) => s.id === id)
}

// Linearly interpolate between keyframes for the current video time t (0..1).
// Wraps around the loop: t=0 and t=1 are the same point.
export function faceHoleAt(scene: Scene, t: number): FaceHoleKeyframe {
  const k = scene.track
  if (k.length === 0) {
    return { t: 0, cx: 640, cy: 360, rx: 80, ry: 90, rotation: 0 }
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