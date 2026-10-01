// Sample two small ellipses from canvases (dancer's forehead + user's forehead area),
// compute per-channel mean and stddev, then write a new canvas where the source
// patch's statistics are remapped to match the target's.

export type ColorStats = {
  mean: [number, number, number]
  std: [number, number, number]
}

export function sampleEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, rx: number, ry: number
): ColorStats {
  const img = ctx.getImageData(Math.max(0, cx - rx), Math.max(0, cy - ry), rx * 2, ry * 2)
  let r = 0, g = 0, b = 0, n = 0
  for (let i = 0; i < img.data.length; i += 4) {
    r += img.data[i]
    g += img.data[i + 1]
    b += img.data[i + 2]
    n++
  }
  r /= n; g /= n; b /= n
  let vr = 0, vg = 0, vb = 0
  for (let i = 0; i < img.data.length; i += 4) {
    vr += (img.data[i] - r) ** 2
    vg += (img.data[i + 1] - g) ** 2
    vb += (img.data[i + 2] - b) ** 2
  }
  return {
    mean: [r, g, b],
    std: [Math.sqrt(vr / n) || 1, Math.sqrt(vg / n) || 1, Math.sqrt(vb / n) || 1],
  }
}

export function applyColorTransfer(
  sourceCtx: CanvasRenderingContext2D,
  sourceStats: ColorStats,
  targetStats: ColorStats,
  width: number,
  height: number
): void {
  // Per-channel: out = ((src - srcMean) / srcStd) * targetStd + targetMean
  // Clamp to [0, 255]. Standard deviation clamping prevents extreme amplification
  // when source has very low variance (e.g. a uniform skin patch).
  const STD_FLOOR = 8
  const out = sourceCtx.getImageData(0, 0, width, height)
  const d = out.data
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const sv = sourceStats.std[c]
      const tv = targetStats.std[c]
      const safeSv = Math.max(sv, STD_FLOOR)
      const v = (d[i + c] - sourceStats.mean[c]) / safeSv
      const out_v = v * Math.max(tv, STD_FLOOR) + targetStats.mean[c]
      d[i + c] = Math.max(0, Math.min(255, Math.round(out_v)))
    }
  }
  sourceCtx.putImageData(out, 0, 0)
}
