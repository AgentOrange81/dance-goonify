import type { FaceLandmarks } from './detector'

export type FacePatch = {
  canvas: HTMLCanvasElement   // square, size = expanded bbox dim
  // Pre-computed alpha mask (one value per pixel, 0-255). Cached here so drawScene doesn't recompute.
  alphaMask: ImageData
  // Source crop rect (for diagnostics)
  cropRect: { x: number; y: number; size: number }
}

export function cropFace(source: HTMLImageElement, landmarks: FaceLandmarks): FacePatch {
  // Expand bbox 30%
  const pad = 0.3
  const paddedW = landmarks.bbox.width * (1 + pad * 2)
  const paddedH = landmarks.bbox.height * (1 + pad * 2)
  const size = Math.max(paddedW, paddedH)  // square
  const cx = landmarks.bbox.x + landmarks.bbox.width / 2
  const cy = landmarks.bbox.y + landmarks.bbox.height / 2
  const cropX = cx - size / 2
  const cropY = cy - size / 2

  // Offscreen canvas for the crop
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('cropFace: cannot get 2d context')

  ctx.drawImage(source, cropX, cropY, size, size, 0, 0, size, size)

  // Build soft elliptical alpha mask — center fully opaque, edges feathered
  const mask = ctx.createImageData(size, size)
  const cx2 = size / 2
  const cy2 = size / 2
  const rx = size * 0.46   // slightly inside the canvas for feather
  const ry = size * 0.50
  const featherPx = 14     // soft edge width

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx2) / rx
      const dy = (y - cy2) / ry
      const d = Math.sqrt(dx * dx + dy * dy)
      let a: number
      if (d <= 1) a = 255
      else if (d >= 1 + featherPx / Math.min(rx, ry)) a = 0
      else a = Math.round(255 * (1 - (d - 1) * Math.min(rx, ry) / featherPx))
      const idx = (y * size + x) * 4
      mask.data[idx + 3] = a
    }
  }

  return {
    canvas,
    alphaMask: mask,
    cropRect: { x: cropX, y: cropY, size },
  }
}
