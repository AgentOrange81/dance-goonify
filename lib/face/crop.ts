import type { FaceLandmarks } from './detector'

export type FacePatch = {
  canvas: HTMLCanvasElement   // square, sized for tight face crop (eyes-to-chin + a bit above brows)
  cropRect: { x: number; y: number; size: number }  // source-image coords that were cropped
  landmarksInPatch: {
    leftEye: { x: number; y: number }
    rightEye: { x: number; y: number }
    nose: { x: number; y: number }
    mouthLeft: { x: number; y: number }
    mouthRight: { x: number; y: number }
  }
}

// Crops a tight face patch from the source image, aligned to the eye-line.
// - The eye midpoint is placed at 40% of the patch height (chin ~25% below center, forehead ~60% above center)
// - The patch size is set so the eye-to-chin distance fills ~45% of the patch
// - Output is square, so the patch includes a bit of forehead for natural blending
//
// Returns a FacePatch with landmarks in PATCH coordinates so drawScene can position features correctly.
export function cropFace(source: HTMLImageElement, landmarks: FaceLandmarks): FacePatch {
  const { leftEye, rightEye, nose, mouthLeft, mouthRight } = landmarks.points

  // Eye-line midpoint (in source image coords)
  const eyeMidX = (leftEye.x + rightEye.x) / 2
  const eyeMidY = (leftEye.y + rightEye.y) / 2

  // Estimate "chin" as the midpoint between mouth corners. We don't have a chin point, but
  // mouth-to-chin is roughly the same as eye-to-mouth.
  const mouthMidX = (mouthLeft.x + mouthRight.x) / 2
  const mouthMidY = (mouthLeft.y + mouthRight.y) / 2

  // Eye-to-mouth distance = roughly 60% of face height. So face height ≈ eyeToMouth / 0.6.
  const eyeToMouth = Math.hypot(mouthMidX - eyeMidX, mouthMidY - eyeMidY)
  const faceHeight = eyeToMouth / 0.6

  // Patch size: scale faceHeight so it fills ~55% of the patch height, leaving room
  // for forehead + a bit of chin/neck for natural blending.
  const patchScale = 1.4
  const size = Math.round(faceHeight * patchScale)

  // Position the patch so the eye midpoint is at 40% from the top
  // (so chin at ~85% from top, forehead ~30% above the eye-line).
  const cropX = Math.round(eyeMidX - size * 0.5)
  const cropY = Math.round(eyeMidY - size * 0.4)

  // Offscreen canvas
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('cropFace: cannot get 2d context')

  ctx.drawImage(source, cropX, cropY, size, size, 0, 0, size, size)

  // Map the source landmarks into patch coordinates (subtract cropX/Y from source coords).
  // drawScene will use these to position the eye-line / mouth / nose relative to the dancer's face.
  return {
    canvas,
    cropRect: { x: cropX, y: cropY, size },
    landmarksInPatch: {
      leftEye: { x: leftEye.x - cropX, y: leftEye.y - cropY },
      rightEye: { x: rightEye.x - cropX, y: rightEye.y - cropY },
      nose: { x: nose.x - cropX, y: nose.y - cropY },
      mouthLeft: { x: mouthLeft.x - cropX, y: mouthLeft.y - cropY },
      mouthRight: { x: mouthRight.x - cropX, y: mouthRight.y - cropY },
    },
  }
}