// User-drawn oval face picker. The user drags/resizes an oval on their photo,
// we extract whatever is inside that oval and pass it to drawScene as the face patch.

export type FacePatch = {
  canvas: HTMLCanvasElement   // square, sized to fit the user's oval
  oval: {
    cx: number; cy: number; rx: number; ry: number; rotation: number  // patch-local coords
  }
  sourceCropRect: { x: number; y: number; size: number }  // source-image coords
}

// Extracts the pixels inside the user-drawn oval from the source image.
// The oval is in SOURCE IMAGE pixel coordinates. We crop a square region around the oval
// (size = max(rx, ry) * 2, padded a bit so the full oval fits), then render the source
// pixels into the patch with the oval masked to a clean ellipse — outside the oval is transparent.
// The output canvas is square; oval coords inside it are patch-local.
export function cropOval(
  source: HTMLImageElement,
  newOll: { cx: number; cy: number; rx: number; ry: number },
): FacePatch {
  const W = source.naturalWidth
  const H = source.naturalHeight

  // Square patch, sized to the larger oval dim with a 10% pad so the alpha edge fades nicely.
  const size = Math.round(Math.max(newOll.rx, newOll.ry) * 2 * 1.1)
  const cropX = Math.round(newOll.cx - size / 2)
  const cropY = Math.round(newOll.cy - size / 2)

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('cropOval: cannot get 2d context')

  // Draw the source region
  ctx.drawImage(source, cropX, cropY, size, size, 0, 0, size, size)

  // Mask everything outside the oval to transparent (in patch-local coords, the oval is
  // centered with the same rx/ry as in source, since the patch is axis-aligned).
  const cx = size / 2
  const cy = size / 2
  const rx = newOll.rx
  const ry = newOll.ry
  const featherPx = Math.max(2, size * 0.03)

  const img = ctx.getImageData(0, 0, size, size)
  const d = img.data
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / rx
      const dy = (y - cy) / ry
      const dist = Math.sqrt(dx * dx + dy * dy)
      let a: number
      if (dist <= 1) {
        a = 255
      } else if (dist >= 1 + featherPx / Math.min(rx, ry)) {
        a = 0
      } else {
        a = Math.round(255 * (1 - (dist - 1) * Math.min(rx, ry) / featherPx))
      }
      d[(y * size + x) * 4 + 3] = a
    }
  }
  ctx.putImageData(img, 0, 0)

  return {
    canvas,
    oval: { cx, cy, rx, ry, rotation: 0 },
    sourceCropRect: { x: cropX, y: cropY, size },
  }
}