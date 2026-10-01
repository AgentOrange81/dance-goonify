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
  track: FaceHoleKeyframe[]  // 3+ keyframes, linearly interpolated per frame
}

const CLUB_ROOM = '/templates/scenes/club-room-empty.webp'

// Keyframe data was sampled from the H3-generated videos on 2026-10-01.
// Each scene has 3 keyframes (0%, 50%, 100%) interpolated linearly per draw. If the face
// drifts visibly off the dancer's face in any scene, add more keyframes here.

// front-grind: dancer's head bobs vertically by ~20px over 6s. Side-to-side motion is small.
export const SCENES: Scene[] = [
  {
    id: 'club-front-grind',
    title: 'front',
    background: CLUB_ROOM,
    dancer: '/templates/scenes/dancer-front-grind.webm',
    track: [
      { t: 0.00, cx: 620, cy: 180, rx: 85, ry: 110, rotation: -8 },
      { t: 0.50, cx: 615, cy: 195, rx: 85, ry: 112, rotation: -8 },
      { t: 1.00, cx: 625, cy: 175, rx: 85, ry: 112, rotation: -8 },
    ],
  },
  {
    id: 'club-side-grind',
    title: 'side',
    background: CLUB_ROOM,
    dancer: '/templates/scenes/dancer-side-grind.webm',
    track: [
      { t: 0.00, cx: 660, cy: 165, rx: 85, ry: 100, rotation: -25 },
      { t: 0.50, cx: 658, cy: 178, rx: 85, ry: 102, rotation: -25 },
      { t: 1.00, cx: 662, cy: 170, rx: 85, ry: 100, rotation: -25 },
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

  // Find the two surrounding keyframes
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