/**
 * Lab-space colour transfer (Reinhard-style mean/std matching).
 *
 * Goal: when the user drops a headshot, their face is shot under arbitrary
 * lighting (warm indoor, cool outdoor, flash, etc.). The dancer plate has its
 * own lighting (warm teal rim light on beige skin). Without colour matching,
 * the composite reads as "sticker pasted on head" — there's a sharp seam and
 * the face looks pasted-on.
 *
 * Approach:
 *  1. Compute the patch's mean and stddev per channel in Lab space, considering
 *     only opaque pixels (the actual face, not the alpha-zero border).
 *  2. Sample the destination oval's mean and stddev per channel (the dancer's
 *     skin tone, sampled before the patch is drawn on top).
 *  3. Apply a linear transform per channel:
 *       out = (src - srcMean) * (k * dstStd / srcStd) + (srcMean + k * (dstMean - srcMean))
 *     k controls how strongly we shift toward the destination. k=1 is a full
 *     transfer; k=0.5 is a mild nudge that keeps the user's identity intact
 *     while softening the seam. We default to 0.7 — enough to remove the
 *     obvious seam, not enough to wash out the user's skin tone.
 *
 * This runs ONCE per (patch, scene) pair — not per frame. The dancer's
 * lighting is consistent across the loop, so a static transform is enough for
 * meme-grade results.
 */

const SRGB_TO_XYZ = [
  // Row-major, linear-RGB → XYZ (D65).
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.0721750],
  [0.0193339, 0.1191920, 0.9503041],
]

// Reference white (D65).
const XN = 0.95047, YN = 1.00000, ZN = 1.08883

function srgbToLinear(c: number): number {
  const x = c / 255
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
}

function linearToSrgb(c: number): number {
  c = Math.max(0, Math.min(1, c))
  return c <= 0.0031308 ? c * 12.92 * 255 : (1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255
}

function rgbToXyz(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b)
  return [
    lr * SRGB_TO_XYZ[0][0] + lg * SRGB_TO_XYZ[0][1] + lb * SRGB_TO_XYZ[0][2],
    lr * SRGB_TO_XYZ[1][0] + lg * SRGB_TO_XYZ[1][1] + lb * SRGB_TO_XYZ[1][2],
    lr * SRGB_TO_XYZ[2][0] + lg * SRGB_TO_XYZ[2][1] + lb * SRGB_TO_XYZ[2][2],
  ]
}

function xyzToRgb(x: number, y: number, z: number): [number, number, number] {
  const lr = x * 3.2404542 + y * -1.5371385 + z * -0.4985314
  const lg = x * -0.9692660 + y * 1.8760108 + z * 0.0415560
  const lb = x * 0.0556434 + y * -0.2040259 + z * 1.0572252
  return [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb)]
}

const LAB_DELTA = 6 / 29
function labF(t: number): number {
  return t > LAB_DELTA ** 3 ? Math.cbrt(t) : t / (3 * LAB_DELTA * LAB_DELTA) + 4 / 29
}
function labFInv(t: number): number {
  return t > LAB_DELTA ? t ** 3 : 3 * LAB_DELTA * LAB_DELTA * (t - 4 / 29)
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const [x, y, z] = rgbToXyz(r, g, b)
  const fx = labF(x / XN), fy = labF(y / YN), fz = labF(z / ZN)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116
  const fx = a / 500 + fy
  const fz = fy - b / 200
  const x = XN * labFInv(fx)
  const y = YN * labFInv(fy)
  const z = ZN * labFInv(fz)
  return xyzToRgb(x, y, z)
}

/** Per-channel Lab triple — used as both mean and std shape so the transfer
 *  math can be written generically. */
export type LabTriple = { L: number; a: number; b: number }

/** Per-channel Lab mean and stddev of opaque pixels. */
export type LabStats = {
  mean: LabTriple
  std: LabTriple
}

/**
 * Compute mean and stddev of opaque pixels of an RGBA buffer in Lab space.
 * `alphaThreshold` skips pixels below this alpha (the transparent border of
 * the oval-masked patch). Returns null if there are too few opaque pixels.
 */
export function labStatsOfImage(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold = 128,
): LabStats | null {
  let sumL = 0, sumA = 0, sumB = 0
  let sumL2 = 0, sumA2 = 0, sumB2 = 0
  let n = 0
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a < alphaThreshold) continue
    const [L, ab, bb] = rgbToLab(data[i], data[i + 1], data[i + 2])
    sumL += L; sumA += ab; sumB += bb
    sumL2 += L * L; sumA2 += ab * ab; sumB2 += bb * bb
    n++
  }
  if (n < 16) return null
  const mean: LabTriple = {
    L: sumL / n,
    a: sumA / n,
    b: sumB / n,
  }
  // stddev = sqrt(E[X²] − E[X]²); clamp at 1 to avoid div-by-zero when src
  // is monochromatic (e.g. a sepia passport photo).
  const std: LabTriple = {
    L: Math.max(1, Math.sqrt(sumL2 / n - mean.L * mean.L)),
    a: Math.max(1, Math.sqrt(sumA2 / n - mean.a * mean.a)),
    b: Math.max(1, Math.sqrt(sumB2 / n - mean.b * mean.b)),
  }
  return { mean, std }
}

/** Pure-RGB stats for the destination sample (faster than full Lab). */
export type RgbStats = { mean: [number, number, number]; std: [number, number, number] }

export function rgbStatsOfImage(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): RgbStats | null {
  let sr = 0, sg = 0, sb = 0
  let sr2 = 0, sg2 = 0, sb2 = 0
  let n = 0
  for (let i = 0; i < data.length; i += 4) {
    sr += data[i]
    sg += data[i + 1]
    sb += data[i + 2]
    sr2 += data[i] * data[i]
    sg2 += data[i + 1] * data[i + 1]
    sb2 += data[i + 2] * data[i + 2]
    n++
  }
  if (n < 16) return null
  const mean: [number, number, number] = [sr / n, sg / n, sb / n]
  const std: [number, number, number] = [
    Math.max(1, Math.sqrt(sr2 / n - mean[0] * mean[0])),
    Math.max(1, Math.sqrt(sg2 / n - mean[1] * mean[1])),
    Math.max(1, Math.sqrt(sb2 / n - mean[2] * mean[2])),
  ]
  return { mean, std }
}

/**
 * Apply a Reinhard-style mean/std transfer in Lab space to the patch's
 * pixels in-place. `mix` ∈ [0..1] — 0 leaves the patch unchanged, 1 fully
 * transfers to the destination's colour profile.
 */
export function transferPatch(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  src: LabStats,
  dst: LabStats,
  mix = 0.7,
  alphaThreshold = 128,
): void {
  // Effective per-channel mean and std: lerp between src (no transfer) and
  // dst (full transfer) by `mix`.
  const mL = mix, mA = mix, mB = mix
  const effMeanL = src.mean.L + mL * (dst.mean.L - src.mean.L)
  const effMeanA = src.mean.a + mA * (dst.mean.a - src.mean.a)
  const effMeanB = src.mean.b + mB * (dst.mean.b - src.mean.b)
  const effStdL = src.std.L + mL * (dst.std.L - src.std.L)
  const effStdA = src.std.a + mA * (dst.std.a - src.std.a)
  const effStdB = src.std.b + mB * (dst.std.b - src.std.b)

  const sL = src.std.L, sA = src.std.a, sB = src.std.b
  const kL = effStdL / sL
  const kA = effStdA / sA
  const kB = effStdB / sB

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < alphaThreshold) continue
    const [L, a, b] = rgbToLab(data[i], data[i + 1], data[i + 2])
    const newL = (L - src.mean.L) * kL + effMeanL
    const newA = (a - src.mean.a) * kA + effMeanA
    const newB = (b - src.mean.b) * kB + effMeanB
    const [r, g, bb] = labToRgb(newL, newA, newB)
    data[i]     = Math.max(0, Math.min(255, r))
    data[i + 1] = Math.max(0, Math.min(255, g))
    data[i + 2] = Math.max(0, Math.min(255, bb))
  }
}

/**
 * Convenience: compute stats from both sides and apply the transfer in one
 * call. Returns the destination LabStats for reuse (e.g. logging).
 */
export function transferPatchToMatch(
  patchCanvas: HTMLCanvasElement,
  dstImageData: ImageData,
  mix = 0.7,
): LabStats | null {
  const patchCtx = patchCanvas.getContext('2d', { willReadFrequently: true })
  if (!patchCtx) return null
  const patchData = patchCtx.getImageData(0, 0, patchCanvas.width, patchCanvas.height)
  const src = labStatsOfImage(patchData.data, patchCanvas.width, patchCanvas.height)
  if (!src) return null
  const dstRgb = rgbStatsOfImage(dstImageData.data, dstImageData.width, dstImageData.height)
  if (!dstRgb) return null
  // We need Lab stats for the destination too. Sample once into Lab.
  let sumL = 0, sumA = 0, sumB = 0
  let sumL2 = 0, sumA2 = 0, sumB2 = 0
  let n = 0
  for (let i = 0; i < dstImageData.data.length; i += 4) {
    const [L, a, b] = rgbToLab(dstImageData.data[i], dstImageData.data[i + 1], dstImageData.data[i + 2])
    sumL += L; sumA += a; sumB += b
    sumL2 += L * L; sumA2 += a * a; sumB2 += b * b
    n++
  }
  if (n < 16) return null
  const dst: LabStats = {
    mean: { L: sumL / n, a: sumA / n, b: sumB / n },
    std: {
      L: Math.max(1, Math.sqrt(sumL2 / n - (sumL / n) * (sumL / n))),
      a: Math.max(1, Math.sqrt(sumA2 / n - (sumA / n) * (sumA / n))),
      b: Math.max(1, Math.sqrt(sumB2 / n - (sumB / n) * (sumB / n))),
    },
  }
  transferPatch(patchData.data, patchCanvas.width, patchCanvas.height, src, dst, mix)
  patchCtx.putImageData(patchData, 0, 0)
  return dst
}
