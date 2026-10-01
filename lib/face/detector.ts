import * as faceapi from 'face-api.js'

let modelLoaded = false
let loadPromise: Promise<void> | null = null
const MODEL_URL = '/templates/models'

export type FaceLandmarks = {
  bbox: { x: number; y: number; width: number; height: number }  // in source image px
  points: {                  // 5 points: leftEye, rightEye, nose, mouthLeft, mouthRight
    leftEye: { x: number; y: number }
    rightEye: { x: number; y: number }
    nose: { x: number; y: number }
    mouthLeft: { x: number; y: number }
    mouthRight: { x: number; y: number }
  }
  confidence: number
}

export async function loadFaceModel(timeoutMs = 5000): Promise<boolean> {
  if (modelLoaded) return true
  if (!loadPromise) {
    loadPromise = Promise.race([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL)
        .then(() => faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL))
        .then(() => { modelLoaded = true }),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('face-api model load timeout')), timeoutMs)
      ),
    ]).catch((err) => {
      loadPromise = null  // allow retry
      console.warn('[face] model load failed:', err)
      return undefined as unknown as void
    })
  }
  await loadPromise
  return modelLoaded
}

export async function detectFace(
  input: HTMLImageElement | HTMLCanvasElement
): Promise<FaceLandmarks | null> {
  const loaded = await loadFaceModel()
  if (!loaded) return null

  const detection = await faceapi
    .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks(true)  // true = use the tiny 5-pt landmark model loaded above

  if (!detection) return null

  const box = detection.detection.box
  // face-api.js 68-point model; we'll derive our 5 points from indices:
  // 36-41 = left eye, 42-47 = right eye, 30 = nose tip, 48 = mouth left, 54 = mouth right
  const lm = detection.landmarks
  const positions = lm.positions

  function avg(indices: number[]) {
    let x = 0, y = 0
    for (const i of indices) { x += positions[i].x; y += positions[i].y }
    return { x: x / indices.length, y: y / indices.length }
  }

  return {
    bbox: { x: box.x, y: box.y, width: box.width, height: box.height },
    points: {
      leftEye: avg([37, 38, 39, 40, 41, 36]),
      rightEye: avg([43, 44, 45, 46, 47, 42]),
      nose: positions[30] ? { x: positions[30].x, y: positions[30].y } : { x: box.x + box.width / 2, y: box.y + box.height * 0.55 },
      mouthLeft: positions[48] ? { x: positions[48].x, y: positions[48].y } : { x: box.x + box.width * 0.35, y: box.y + box.height * 0.8 },
      mouthRight: positions[54] ? { x: positions[54].x, y: positions[54].y } : { x: box.x + box.width * 0.65, y: box.y + box.height * 0.8 },
    },
    confidence: detection.detection.score,
  }
}

// Fallback when face-api.js fails to load — center-crop bbox estimate
export function fallbackBbox(imgW: number, imgH: number): FaceLandmarks {
  // Heuristic: head is in the upper third of a typical PFP, ~50% of min dimension
  const size = Math.min(imgW, imgH) * 0.55
  const x = (imgW - size) / 2
  const y = imgH * 0.08
  return {
    bbox: { x, y, width: size, height: size },
    points: {
      leftEye: { x: x + size * 0.32, y: y + size * 0.38 },
      rightEye: { x: x + size * 0.68, y: y + size * 0.38 },
      nose: { x: x + size * 0.5, y: y + size * 0.55 },
      mouthLeft: { x: x + size * 0.36, y: y + size * 0.78 },
      mouthRight: { x: x + size * 0.64, y: y + size * 0.78 },
    },
    confidence: 0,
  }
}
