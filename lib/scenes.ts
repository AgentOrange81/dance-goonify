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

// Keyframes measured from the PING-PONG webm loops.
//
// Each plate is constructed by playing frames 1..N forward then N..1 in reverse.
// This produces a perfectly seamless loop: the last frame matches the first
// frame exactly, so the browser's natural looping shows no visible jump.
//
// Trajectory (warm-pixel detector on x:400-800, y<300):
//   front: cx 735-747, cy 179-206 (smooth head bob: down then back up)
//   side:  cx ~618-630, cy ~150-190 (similar smooth ping-pong)
//
// IMPORTANT: t=0 and t=1.0 keyframes MUST match exactly, because the video
// loops back to frame_001 every cycle. Set t=1.0 = t=0 explicitly.

export const SCENES: Scene[] = [
  {
    id: 'club-front-grind',
    title: 'front',
    background: CLUB_ROOM,
    dancer: '/templates/scenes/dancer-front-grind.webm',
    track: [
      { t: 0.000, cx: 744, cy: 206, rx: 50, ry: 60, rotation: -8 },
      { t: 0.158, cx: 744, cy: 203, rx: 50, ry: 60, rotation: -8 },
      { t: 0.316, cx: 737, cy: 196, rx: 50, ry: 60, rotation: -8 },
      { t: 0.474, cx: 735, cy: 180, rx: 50, ry: 60, rotation: -8 },
      { t: 0.526, cx: 735, cy: 179, rx: 50, ry: 60, rotation: -8 },
      { t: 0.684, cx: 737, cy: 195, rx: 50, ry: 60, rotation: -8 },
      { t: 0.842, cx: 744, cy: 202, rx: 50, ry: 60, rotation: -8 },
      { t: 1.000, cx: 744, cy: 206, rx: 50, ry: 60, rotation: -8 },
    ],
  },
  {
    id: 'club-side-grind',
    title: 'side',
    background: CLUB_ROOM,
    dancer: '/templates/scenes/dancer-side-grind.webm',
    track: [
      { t: 0.000, cx: 619, cy: 166, rx: 40, ry: 60, rotation: -25 },
      { t: 0.167, cx: 618, cy: 153, rx: 40, ry: 60, rotation: -25 },
      { t: 0.333, cx: 619, cy: 162, rx: 40, ry: 60, rotation: -25 },
      { t: 0.500, cx: 630, cy: 188, rx: 40, ry: 60, rotation: -25 },
      { t: 0.667, cx: 622, cy: 181, rx: 40, ry: 60, rotation: -25 },
      { t: 0.833, cx: 627, cy: 171, rx: 40, ry: 60, rotation: -25 },
      { t: 1.000, cx: 619, cy: 166, rx: 40, ry: 60, rotation: -25 },
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