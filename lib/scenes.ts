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
//   - Cinematic front close-up; dancer's head extends beyond the top and right edges
//   - Visible face oval: center ~ (1000, 160) in native 1344x768
//   - Scaled to canvas (1280x720): cx ~ 953, cy ~ 150, rx ~ 238 (huge — face fills most of frame), ry ~ 150
//   - The oval is large and CLOSE; user-drawn face needs to match this scale
//
// Side v3 (best loop of 3 variants, wrap diff = 2.29 — perfect loop):
//   - Full body 3/4 angle, dancer positioned left of frame
//   - Face oval: native ~ (560, 270) in 1344x768; ~ (560, 240) in 1280x720
//   - Smaller oval due to wider framing: rx ~ 70, ry ~ 95
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
      // The face oval in the source MP4 (1344×768) spans approximately:
      //   left edge: x=550, right edge: x=1300+ (extends past frame)
      //   top edge: y=10 (almost off top), bottom edge: y=440 (chin)
      // Center: native ~(925, 225) — but visible region center is shifted left
      // since right portion is off-frame. Effective center ≈ (1110, 230) accounting
      // for the truncation, but rendered canvas center stays around x=880-900
      // because of how drawImage scales the 1344→1280.
      // The oval is huge: rx≈280, ry≈200 (visible) — extending past right edge.
      // rx_canvas ≈ 280 * (1280/1344) = 267
      // ry_canvas ≈ 200 * (720/768) = 187
      { t: 0.000, cx: 880, cy: 210, rx: 270, ry: 187, rotation: 0 },
      { t: 0.166, cx: 875, cy: 205, rx: 270, ry: 187, rotation: 0 },
      { t: 0.333, cx: 868, cy: 218, rx: 270, ry: 187, rotation: 0 },
      { t: 0.500, cx: 862, cy: 225, rx: 270, ry: 187, rotation: 0 },
      { t: 0.666, cx: 868, cy: 218, rx: 270, ry: 187, rotation: 0 },
      { t: 0.833, cx: 875, cy: 205, rx: 270, ry: 187, rotation: 0 },
      { t: 1.000, cx: 880, cy: 210, rx: 270, ry: 187, rotation: 0 },
    ],
  },
  {
    id: 'club-side-grind',
    title: 'side',
    background: CLUB_ROOM,
    dancer: '/templates/scenes/dancer-side-grind.webm',
    track: [
      { t: 0.000, cx: 560, cy: 240, rx: 70, ry: 95, rotation: -10 },
      { t: 0.166, cx: 558, cy: 235, rx: 70, ry: 95, rotation: -10 },
      { t: 0.333, cx: 562, cy: 245, rx: 70, ry: 95, rotation: -10 },
      { t: 0.500, cx: 560, cy: 240, rx: 70, ry: 95, rotation: -10 },
      { t: 0.666, cx: 558, cy: 238, rx: 70, ry: 95, rotation: -10 },
      { t: 0.833, cx: 560, cy: 242, rx: 70, ry: 95, rotation: -10 },
      { t: 1.000, cx: 560, cy: 240, rx: 70, ry: 95, rotation: -10 },
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