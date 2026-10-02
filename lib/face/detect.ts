/**
 * Browser-side face detection via MediaPipe tasks-vision.
 *
 * Two detectors live here, both backed by the same WASM runtime:
 *   - FaceDetector (BlazeFace short-range TFLite): fast bbox detection for
 *     the initial oval placement in FacePicker.
 *   - FaceLandmarker (face_landmarker.task): slower 478-point mesh used for
 *     Delaunay-based face warping at composite time.
 *
 * Both lazy-load the WASM runtime (from /templates/mediapipe/wasm/) on first
 * use and cache the detector for subsequent calls.
 */

import { FaceDetector, FaceLandmarker, FilesetResolver, type Detection } from '@mediapipe/tasks-vision'

const WASM_BASE = '/templates/mediapipe/wasm'
const FACE_MODEL_URL = '/templates/mediapipe/blaze_face_short_range.tflite'
const LANDMARK_MODEL_URL = '/templates/mediapipe/face_landmarker.task'

let visionPromise: Promise<Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>> | null = null
let detectorPromise: Promise<FaceDetector> | null = null
let landmarkerPromise: Promise<FaceLandmarker> | null = null

async function getVision() {
  if (!visionPromise) {
    visionPromise = FilesetResolver.forVisionTasks(WASM_BASE)
  }
  return visionPromise
}

async function getDetector(): Promise<FaceDetector> {
  if (detectorPromise) return detectorPromise
  detectorPromise = (async () => {
    const vision = await getVision()
    return await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: FACE_MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.5,
    })
  })()
  return detectorPromise
}

async function getLandmarker(): Promise<FaceLandmarker> {
  if (landmarkerPromise) return landmarkerPromise
  landmarkerPromise = (async () => {
    const vision = await getVision()
    return await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: LANDMARK_MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'IMAGE',
      numFaces: 1,
      // Stylized animation faces score lower than photorealistic ones the
      // model was trained on — lower thresholds so we catch tilted/occluded
      // faces in the dancer plates.
      minFaceDetectionConfidence: 0.3,
      minFacePresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
    })
  })()
  return landmarkerPromise
}

export type FaceBox = {
  /** Pixel coords on the source image. */
  cx: number
  cy: number
  rx: number
  ry: number
  /** Confidence score 0..1, useful for telemetry / debug. */
  score: number
}

/**
 * One MediaPipe FaceLandmarker landmark, normalized to the source image's
 * pixel dimensions (multiply `x` by `naturalWidth`, `y` by `naturalHeight`).
 * `z` is relative depth (smaller = closer to camera); we ignore it for
 * Delaunay warping since both source and target are 2D.
 */
export type FaceLandmark = { x: number; y: number; z: number }

/**
 * Detect the largest face in the image and return an oval that roughly
 * frames it. Tightens the box horizontally (faces are narrower than the
 * detector's bbox) and vertically (the bbox usually overshoots into the
 * neck/chin).
 */
export async function detectFaceOval(image: HTMLImageElement): Promise<FaceBox | null> {
  const detector = await getDetector()
  const results = detector.detect(image)
  if (!results.detections.length) return null
  // Pick the largest detection by bbox area.
  let best: Detection | null = null
  let bestArea = 0
  for (const d of results.detections) {
    if (!d.boundingBox) continue
    const a = d.boundingBox.width * d.boundingBox.height
    if (a > bestArea) {
      bestArea = a
      best = d
    }
  }
  if (!best || !best.boundingBox) return null
  const bb = best.boundingBox
  const cx = bb.originX + bb.width / 2
  const cy = bb.originY + bb.height / 2
  // Tighten: faces are ~70% as wide as the bbox (no hair/ears), ~80% as tall.
  // This puts the oval around the face proper, not the detection envelope.
  const rx = (bb.width * 0.45)
  const ry = (bb.height * 0.55)
  // Clamp into the image (in case bbox touches an edge).
  const ix = Math.max(rx, Math.min(image.naturalWidth - rx, cx))
  const iy = Math.max(ry, Math.min(image.naturalHeight - ry, cy))
  return {
    cx: ix,
    cy: iy,
    rx,
    ry,
    score: best.categories?.[0]?.score ?? 0,
  }
}

/**
 * Detect the largest face in the image and return 478 FaceLandmarker
 * landmarks in the source image's pixel coordinates. The landmarker is the
 * heavier of the two detectors (~3.6MB model + slower inference) — only
 * call this when you need Delaunay warping, not for the simple oval case.
 *
 * Returns `null` if no face is detected.
 */
export async function detectFaceLandmarks(image: HTMLImageElement): Promise<FaceLandmark[] | null> {
  const landmarker = await getLandmarker()
  const results = landmarker.detect(image)
  const lms = results.faceLandmarks
  if (!lms || lms.length === 0) return null
  // Single-face mode → take index 0.
  return lms[0].map((lm) => ({ x: lm.x, y: lm.y, z: lm.z }))
}
