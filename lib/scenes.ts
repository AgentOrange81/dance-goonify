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

// Keyframes measured from the trimmed + crossfaded webm loops (see
// .hermes/measured-keyframes.json for raw data).
//
// The trimmed loops are short (~1.6s for front, ~1.75s for side). Each loop
// contains one full hip-grind cycle. Tracking the oval center frame-by-frame
// on the trimmed videos (warm-pixel filter on x:400-800, y<300) gives:
//   front: cx 722-745 (mean ~731), cy 180-210 (small head bob)
//   side:  cx 615-631 (mean ~623), cy 153-190 (small head bob)
//
// IMPORTANT: t=0 and t=1.0 keyframes MUST match exactly, because the video
// loops the dancer plate back to frame_001 every cycle. If the oval position
// at t=1.0 differs from t=0, the face patch will visually jump each loop.
// We set t=1.0 = t=0 explicitly.

export const SCENES: Scene[] = [
  {
    id: 'club-front-grind',
    title: 'front',
    background: CLUB_ROOM,
    dancer: '/templates/scenes/dancer-front-grind.webm',
    track: [
      { t: 0.00, cx: 744, cy: 206, rx: 50, ry: 60, rotation: -8 },
      { t: 0.16, cx: 743, cy: 203, rx: 50, ry: 60, rotation: -8 },
      { t: 0.32, cx: 736, cy: 195, rx: 50, ry: 60, rotation: -8 },
      { t: 0.50, cx: 728, cy: 182, rx: 50, ry: 60, rotation: -8 },
      { t: 0.68, cx: 725, cy: 189, rx: 50, ry: 60, rotation: -8 },
      { t: 0.84, cx: 722, cy: 205, rx: 50, ry: 60, rotation: -8 },
      { t: 1.00, cx: 744, cy: 206, rx: 50, ry: 60, rotation: -8 },
    ],
  },
  {
    id: 'club-side-grind',
    title: 'side',
    background: CLUB_ROOM,
    dancer: '/templates/scenes/dancer-side-grind.webm',
    track: [
      { t: 0.00, cx: 619, cy: 166, rx: 40, ry: 60, rotation: -25 },
      { t: 0.17, cx: 618, cy: 153, rx: 40, ry: 60, rotation: -25 },
      { t: 0.34, cx: 619, cy: 162, rx: 40, ry: 60, rotation: -25 },
      { t: 0.50, cx: 630, cy: 188, rx: 40, ry: 60, rotation: -25 },
      { t: 0.67, cx: 622, cy: 181, rx: 40, ry: 60, rotation: -25 },
      { t: 0.84, cx: 627, cy: 171, rx: 40, ry: 60, rotation: -25 },
      { t: 1.00, cx: 619, cy: 166, rx: 40, ry: 60, rotation: -25 },
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