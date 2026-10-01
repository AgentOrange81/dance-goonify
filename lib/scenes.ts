export type Scene = {
  id: string
  title: string
  background: string  // /templates/scenes/<bg>.webp
  dancer: string      // /templates/scenes/<dancer>.webm
  faceHole: {         // oval where user face composites, in 1280x720 CANVAS coords
    cx: number
    cy: number
    rx: number
    ry: number
    rotation: number  // degrees
  }
  // Estimated landmarks of the dancer's face, in 1344x768 video-native coords.
  // Used to affine-warp the user's face landmarks so head pose matches the dancer.
  dancerLandmarks: {
    leftEye: { x: number; y: number }
    rightEye: { x: number; y: number }
    nose: { x: number; y: number }
    mouthLeft: { x: number; y: number }
    mouthRight: { x: number; y: number }
  }
}

const CLUB_ROOM = '/templates/scenes/club-room-empty.webp'

// H3 webm video is 1344x768 native. Canvas is 1280x720.
// faceHole is in canvas coords (1280x720); dancerLandmarks are in video coords (1344x768).
// Scale from canvas→video: multiply x by 1.05, y by 1.067.

// front-grind: oval center ~ (620, 200) canvas, eye-line ~ y=180, mouth ~ y=240 (canvas)
// In video coords: eye ~ (651, 192), mouth ~ (651, 256)
// side-grind: oval center ~ (660, 175) canvas, eye-line ~ y=160, mouth ~ y=220 (canvas)
// In video coords: eye ~ (693, 171), mouth ~ (693, 235)

export const SCENES: Scene[] = [
  {
    id: 'club-front-grind',
    title: 'front',
    background: CLUB_ROOM,
    dancer: '/templates/scenes/dancer-front-grind.webm',
    faceHole: { cx: 620, cy: 200, rx: 90, ry: 100, rotation: -8 },
    dancerLandmarks: {
      leftEye:   { x: 615, y: 188 },
      rightEye:  { x: 695, y: 188 },
      nose:      { x: 655, y: 230 },
      mouthLeft: { x: 620, y: 256 },
      mouthRight:{ x: 690, y: 256 },
    },
  },
  {
    id: 'club-side-grind',
    title: 'side',
    background: CLUB_ROOM,
    dancer: '/templates/scenes/dancer-side-grind.webm',
    faceHole: { cx: 660, cy: 175, rx: 90, ry: 95, rotation: -25 },
    dancerLandmarks: {
      leftEye:   { x: 645, y: 160 },
      rightEye:  { x: 740, y: 168 },
      nose:      { x: 680, y: 210 },
      mouthLeft: { x: 640, y: 240 },
      mouthRight:{ x: 720, y: 240 },
    },
  },
]

export function getScene(id: string): Scene | undefined {
  return SCENES.find((s) => s.id === id)
}