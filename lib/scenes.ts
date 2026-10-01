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

// Keyframes derived from auto-detection on 7 frames per video (2026-10-01, see
// .hermes/measured-keyframes.json). Auto-detection captured the per-frame head
// position well; the only smoothing is to ignore outliers where the detector
// latched onto a non-oval blob (the body skin or neck) instead of the oval.
//
// For front-grind: 7 measurements, cx range 658-715 (mean ~700), cy range
// 154-262 with one outlier at 262 (frame 02, detector latched onto neck).
// Cleaned cy range 154-191 (mean ~173).
//
// For side-grind: auto-detection failed (0/7) because the 3/4 angle changes
// skin hue. Falling back to visual grid measurement: oval center ~(600, 140)
// for the front portion of the loop with minor vertical bob. Per-frame
// tracking on this plate is deferred to v1.5 (template matching worker).

export const SCENES: Scene[] = [
  {
    id: 'club-front-grind',
    title: 'front',
    background: CLUB_ROOM,
    dancer: '/templates/scenes/dancer-front-grind.webm',
    track: [
      { t: 0.00, cx: 700, cy: 180, rx: 50, ry: 60, rotation: -8 },
      { t: 0.17, cx: 660, cy: 185, rx: 50, ry: 60, rotation: -8 },
      { t: 0.33, cx: 715, cy: 170, rx: 50, ry: 60, rotation: -8 },
      { t: 0.50, cx: 710, cy: 165, rx: 50, ry: 60, rotation: -8 },
      { t: 0.67, cx: 710, cy: 170, rx: 50, ry: 60, rotation: -8 },
      { t: 0.83, cx: 700, cy: 185, rx: 50, ry: 60, rotation: -8 },
      { t: 1.00, cx: 705, cy: 155, rx: 50, ry: 60, rotation: -8 },
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