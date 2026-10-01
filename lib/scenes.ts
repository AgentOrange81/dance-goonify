export type Scene = {
  id: string
  title: string
  background: string        // /templates/scenes/<bg>.webp
  dancer: string            // /templates/scenes/<dancer>.webp (face oval baked into asset)
  dancerLayout: { x: number; y: number; w: number; h: number }  // px in 1280x720 canvas
  faceHole: {               // oval where user face composites, NORMALIZED 0-1 of dancer bounds
    cx: number; cy: number; rx: number; ry: number; rotation: number
  }
  grade: {
    tintHex: string         // e.g. "#1a4a55"
    tintAmount: number      // 0-1 multiply strength
    contrast: number        // 0.8-1.2
    vignette: number        // 0-1
  }
  motion: {
    swayX: number           // px amplitude
    swayHz: number          // cycles per second
    bounceY: number         // px amplitude
    bounceHz: number
    roll: number            // degrees amplitude
    lean: number            // px amplitude
    scalePulse: number      // 0-0.05
  }
  hairOverlay?: string      // /templates/scenes/<hair>.webp, drawn after face
}

// All scenes share the same empty club room plate — H3-generated (2026-10-01)
// Dance plate positions are rough estimates from frame inspection. Use calibrate sliders to refine.
const CLUB_ROOM = '/templates/scenes/club-room-empty.webp'

export const SCENES: Scene[] = [
  {
    id: 'club-front-grind',
    title: 'front grind',
    background: CLUB_ROOM,
    dancer: '/templates/scenes/dancer-front-grind.webp',
    dancerLayout: { x: 240, y: 0, w: 800, h: 720 },  // dancer fills width
    faceHole: { cx: 0.5, cy: 0.28, rx: 0.11, ry: 0.17, rotation: -8 },
    grade: { tintHex: '#1a4a55', tintAmount: 0.3, contrast: 1.05, vignette: 0.4 },
    motion: { swayX: 18, swayHz: 0.5, bounceY: 12, bounceHz: 1.0, roll: 1.5, lean: 6, scalePulse: 0.015 },
  },
  {
    id: 'club-side-grind',
    title: 'side angle',
    background: CLUB_ROOM,
    dancer: '/templates/scenes/dancer-side-grind.webp',
    dancerLayout: { x: 220, y: 0, w: 820, h: 720 },
    faceHole: { cx: 0.51, cy: 0.25, rx: 0.09, ry: 0.14, rotation: -30 },
    grade: { tintHex: '#1a3a48', tintAmount: 0.35, contrast: 1.08, vignette: 0.45 },
    motion: { swayX: 22, swayHz: 0.45, bounceY: 10, bounceHz: 0.9, roll: 1.2, lean: 8, scalePulse: 0.012 },
  },
  {
    id: 'club-back-arch',
    title: 'back arch',
    background: CLUB_ROOM,
    dancer: '/templates/scenes/dancer-back-arch.webp',
    dancerLayout: { x: 240, y: 0, w: 800, h: 720 },
    faceHole: { cx: 0.48, cy: 0.24, rx: 0.10, ry: 0.15, rotation: -25 },
    grade: { tintHex: '#1a3a48', tintAmount: 0.3, contrast: 1.05, vignette: 0.5 },
    motion: { swayX: 16, swayHz: 0.55, bounceY: 14, bounceHz: 1.1, roll: 1.0, lean: 5, scalePulse: 0.018 },
  },
]

export function getScene(id: string): Scene | undefined {
  return SCENES.find((s) => s.id === id)
}
