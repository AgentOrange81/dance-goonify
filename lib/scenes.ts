export type FaceHoleKeyframe = {
  t: number       // 0..1 of the video loop
  cx: number
  cy: number
  rx: number
  ry: number
  rotation: number  // degrees
}

export type Scene = {
  id: string
  title: string
  background: string
  dancer: string
  track: FaceHoleKeyframe[]  // 3+ keyframes, linearly interpolated per draw frame
}

const CLUB_ROOM = '/templates/scenes/club-room-empty.webp'

// Keyframe data measured from the H3 videos on 2026-10-01 by overlaying a coord grid
// and reading the dancer's blank oval face position on each sampled frame.
//
// The oval moves only slightly (~30px sway, mostly vertical) because the H3 video is
// a 6-second looped clip. We track with 4 keyframes per scene — enough to capture
// the up/down motion.
//
// Front-grind: oval rotated -8° (slight head tilt). rx≈65, ry≈55 (wider than tall).
// Side-grind: oval rotated -25° (3/4 angle). rx≈40, ry≈60 (taller than wide).

export const SCENES: Scene[] = [
  {
    id: 'club-front-grind',
    title: 'front',
    background: CLUB_ROOM,
    dancer: '/templates/scenes/dancer-front-grind.webm',
    track: [
      { t: 0.00, cx: 595, cy: 185, rx: 65, ry: 55, rotation: -8 },
      { t: 0.33, cx: 605, cy: 185, rx: 65, ry: 55, rotation: -8 },
      { t: 0.66, cx: 585, cy: 185, rx: 65, ry: 55, rotation: -8 },
      { t: 1.00, cx: 615, cy: 175, rx: 65, ry: 55, rotation: -8 },
    ],
  },
  {
    id: 'club-side-grind',
    title: 'side',
    background: CLUB_ROOM,
    dancer: '/templates/scenes/dancer-side-grind.webm',
    track: [
      { t: 0.00, cx: 600, cy: 140, rx: 40, ry: 60, rotation: -25 },
      { t: 0.33, cx: 600, cy: 140, rx: 40, ry: 60, rotation: -25 },
      { t: 0.66, cx: 590, cy: 140, rx: 40, ry: 60, rotation: -25 },
      { t: 1.00, cx: 600, cy: 140, rx: 40, ry: 60, rotation: -25 },
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