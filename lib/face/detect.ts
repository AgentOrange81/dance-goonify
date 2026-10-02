/**
 * Browser-side face detection via MediaPipe tasks-vision FaceDetector.
 *
 * Lazy-loads the WASM runtime (from /templates/mediapipe/wasm/) and the
 * BlazeFace short-range TFLite model (from /templates/mediapipe/) on first
 * use, then caches the detector for subsequent calls.
 *
 * Returns a bounding box in the source image's pixel coordinates, suitable
 * for initialising the FacePicker oval. The oval is intentionally slightly
 * tighter than the raw bbox: faces are usually narrower than their detection
 * boxes (the box includes hair, ears, neck shadow).
 */

import { FaceDetector, FilesetResolver, type Detection } from '@mediapipe/tasks-vision'

const WASM_BASE = '/templates/mediapipe/wasm'
const MODEL_URL = '/templates/mediapipe/blaze_face_short_range.tflite'

let detectorPromise: Promise<FaceDetector> | null = null

function getDetector(): Promise<FaceDetector> {
  if (detectorPromise) return detectorPromise
  detectorPromise = (async () => {
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE)
    return await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.5,
    })
  })()
  return detectorPromise
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
