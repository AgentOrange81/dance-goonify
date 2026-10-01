export type Scene = {
  id: string
  title: string
  background: string  // /templates/scenes/<bg>.webp (static empty club room)
  dancer: string      // /templates/scenes/<dancer>.webm (H3-generated animated dancer, ~6s loop)
  faceHole: {         // oval where user face composites, in CANVAS pixel coords (1280x720)
    cx: number        // center x in canvas pixels
    cy: number        // center y in canvas pixels
    rx: number        // half-width in canvas pixels
    ry: number        // half-height in canvas pixels
    rotation: number  // degrees
  }
}

const CLUB_ROOM = '/templates/scenes/club-room-empty.webp'

// faceHole coords measured from each plate (2026-10-01):
//   front: oval visible at x≈540-700, y≈110-290  → cx=620, cy=200, rx=80, ry=90
//   side:  oval visible at x≈580-740, y≈90-260   → cx=660, cy=175, ry=85, slight tilt

export const SCENES: Scene[] = [
  {
    id: 'club-front-grind',
    title: 'front',
    background: CLUB_ROOM,
    dancer: '/templates/scenes/dancer-front-grind.webm',
    faceHole: { cx: 620, cy: 200, rx: 80, ry: 90, rotation: -8 },
  },
  {
    id: 'club-side-grind',
    title: 'side',
    background: CLUB_ROOM,
    dancer: '/templates/scenes/dancer-side-grind.webm',
    faceHole: { cx: 660, cy: 175, rx: 80, ry: 85, rotation: -25 },
  },
]

export function getScene(id: string): Scene | undefined {
  return SCENES.find((s) => s.id === id)
}