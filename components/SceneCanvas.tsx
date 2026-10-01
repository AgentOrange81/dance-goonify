'use client'

import { useEffect, useRef, useState } from 'react'
import type { Scene } from '@/lib/scenes'
import { getScene } from '@/lib/scenes'
import { drawScene, type DrawAssets } from '@/lib/canvas/drawScene'
import { computeMotion } from '@/lib/canvas/motion'
import type { FacePatch } from '@/lib/face/crop'
import { applyColorTransfer, sampleEllipse } from '@/lib/face/colorMatch'

const CANVAS_W = 1280
const CANVAS_H = 720

export type Calibration = {
  dx: number
  dy: number
  rxMul: number
  ryMul: number
  rotation: number
}

const DEFAULT_CAL: Calibration = { dx: 0, dy: 0, rxMul: 1, ryMul: 1, rotation: 0 }

export function SceneCanvas({
  sceneId,
  facePatch,
  sourceImage,
}: {
  sceneId: string
  facePatch: FacePatch | null
  sourceImage: HTMLImageElement | null
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [assets, setAssets] = useState<DrawAssets | null>(null)
  const [assetsError, setAssetsError] = useState<string | null>(null)
  const [debug, setDebug] = useState<string>('init')
  const [calibration, setCalibration] = useState<Calibration>(DEFAULT_CAL)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef<number>(0)
  const sceneRef = useRef<Scene | null>(null)
  const calRef = useRef<Calibration>(DEFAULT_CAL)

  // Keep the latest calibration ref in sync without restarting the RAF loop
  useEffect(() => {
    calRef.current = calibration
  }, [calibration])

  // Load scene images whenever sceneId changes
  useEffect(() => {
    const scene = getScene(sceneId)
    if (!scene) {
      setAssetsError(`unknown scene: ${sceneId}`)
      setAssets(null)
      setDebug(`unknown scene: ${sceneId}`)
      return
    }
    sceneRef.current = scene
    setAssetsError(null)
    setDebug(`loading scene: ${sceneId}`)

    let cancelled = false
    Promise.all([
      loadImage(scene.background, `bg:${scene.background}`),
      loadImage(scene.dancer, `dancer:${scene.dancer}`),
      scene.hairOverlay ? loadImage(scene.hairOverlay, `hair:${scene.hairOverlay}`) : Promise.resolve(null),
    ]).then(([bg, dancer, hair]) => {
      if (cancelled) return
      console.log('[SceneCanvas] scene loaded', { sceneId, bg: bg?.naturalWidth, dancer: dancer?.naturalWidth, hair: hair?.naturalWidth })
      setAssets((prev) => ({
        background: bg!,
        dancer: dancer!,
        hairOverlay: hair ?? undefined,
        facePatch: prev?.facePatch ?? makePlaceholderPatch(),
      }))
      setDebug(`assets set: bg=${bg?.naturalWidth}x${bg?.naturalHeight} dancer=${dancer?.naturalWidth}x${dancer?.naturalHeight}`)
    }).catch((err) => {
      if (cancelled) return
      console.error('[SceneCanvas] scene load failed:', err)
      setAssetsError(`failed to load scene assets: ${err instanceof Error ? err.message : err}`)
      setDebug(`load error: ${err instanceof Error ? err.message : err}`)
    })

    return () => { cancelled = true }
  }, [sceneId])

  // Whenever the face patch changes, run color transfer and update assets.
  // Skip the transfer if it would throw — that path used to wipe the face patch.
  useEffect(() => {
    if (!assets || !facePatch) return
    const scene = sceneRef.current
    if (!scene) return

    // Sample a forehead ellipse from the dancer image. Use a small inner ellipse
    // sized in pixels so we never go out of bounds.
    const dl = scene.dancerLayout
    const fh = scene.faceHole
    const dancerFaceCx = dl.x + fh.cx * dl.w
    const dancerFaceCy = dl.y + fh.cy * dl.h
    // Tight inner ellipse, half the size of the face hole, never larger than the image
    const dancerFaceRx = Math.max(2, Math.min(fh.rx * dl.w * 0.35, dl.w * fh.cx - 2, (1 - fh.cx) * dl.w - 2))
    const dancerFaceRy = Math.max(2, Math.min(fh.ry * dl.h * 0.35, dl.h * fh.cy - 2, (1 - fh.cy) * dl.h - 2))

    if (dancerFaceCx - dancerFaceRx < 0 || dancerFaceCy - dancerFaceRy < 0 ||
        dancerFaceCx + dancerFaceRx > assets.dancer.naturalWidth ||
        dancerFaceCy + dancerFaceRy > assets.dancer.naturalHeight) {
      // Fallback: skip transfer, just use the unprocessed patch
      console.warn('[SceneCanvas] face region out of bounds, skipping color transfer')
      setAssets((prev) => prev ? { ...prev, facePatch } : prev)
      return
    }

    const dancerCanvas = document.createElement('canvas')
    dancerCanvas.width = assets.dancer.naturalWidth
    dancerCanvas.height = assets.dancer.naturalHeight
    const dctx = dancerCanvas.getContext('2d', { willReadFrequently: true })
    if (!dctx) {
      setAssets((prev) => prev ? { ...prev, facePatch } : prev)
      return
    }
    dctx.drawImage(assets.dancer, 0, 0)
    let targetStats
    try {
      targetStats = sampleEllipse(dctx, dancerFaceCx, dancerFaceCy, dancerFaceRx, dancerFaceRy)
    } catch (err) {
      console.warn('[SceneCanvas] sampleEllipse threw:', err)
      setAssets((prev) => prev ? { ...prev, facePatch } : prev)
      return
    }

    // Guard: if the target sample is unreasonably dark (< 40 mean luma) or has near-zero
    // variance, skip the transfer — sampling a shadow region of the plate would otherwise
    // crush the face to near-black, making the user see a dark "floating PFP".
    const targetLuma = 0.299 * targetStats.mean[0] + 0.587 * targetStats.mean[1] + 0.114 * targetStats.mean[2]
    const targetMaxStd = Math.max(...targetStats.std)
    if (targetLuma < 40 || targetMaxStd < 5) {
      console.warn('[SceneCanvas] target sample too dark/flat, skipping color transfer', { targetLuma, targetMaxStd })
      setAssets((prev) => prev ? { ...prev, facePatch } : prev)
      return
    }

    const patchCtx = facePatch.canvas.getContext('2d', { willReadFrequently: true })
    if (!patchCtx) {
      setAssets((prev) => prev ? { ...prev, facePatch } : prev)
      return
    }
    const patchSize = facePatch.canvas.width
    const sourceStats = sampleEllipse(patchCtx, patchSize / 2, patchSize * 0.35, patchSize * 0.18, patchSize * 0.18)
    applyColorTransfer(patchCtx, sourceStats, targetStats, patchSize, patchSize)

    setAssets((prev) => prev ? { ...prev, facePatch } : prev)
  }, [facePatch, assets])

  // RAF render loop
  useEffect(() => {
    if (!assets) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    console.log('[SceneCanvas] RAF loop starting, assets:', {
      bg: `${assets.background.naturalWidth}x${assets.background.naturalHeight}`,
      dancer: `${assets.dancer.naturalWidth}x${assets.dancer.naturalHeight}`,
      facePatch: `${assets.facePatch.canvas.width}x${assets.facePatch.canvas.height}`,
    })

    startRef.current = performance.now()

    let frameCount = 0
    const loop = (now: number) => {
      const scene = sceneRef.current
      if (!scene) return
      const t = (now - startRef.current) / 1000
      const motion = computeMotion(scene, t)
      drawScene(ctx, scene, assets, motion, calRef.current)
      frameCount++
      if (frameCount === 1) {
        console.log('[SceneCanvas] first frame drawn')
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [assets])

  // Custom event bridge for calibrate panel
  useEffect(() => {
    const handler = (e: Event) => {
      const next = (e as CustomEvent<Calibration>).detail
      if (next) setCalibration(next)
    }
    window.addEventListener('dance-calibrate', handler)
    return () => window.removeEventListener('dance-calibrate', handler)
  }, [])

  return (
    <div className="relative w-full bg-black rounded-lg overflow-hidden" style={{ aspectRatio: `${CANVAS_W}/${CANVAS_H}` }}>
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        className="w-full h-full block"
      />
      {/* Debug overlay (temporary) */}
      <div className="absolute top-2 left-2 text-xs text-teal-glow bg-ink-900/80 px-2 py-1 rounded pointer-events-none">
        {debug}
      </div>
      {assetsError && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink-900/80">
          <p className="text-red-400 text-sm lowercase px-4 text-center">{assetsError}</p>
        </div>
      )}
      {!sourceImage && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-gray-500 text-sm lowercase">drop a photo to begin</p>
        </div>
      )}
      {!facePatch && sourceImage && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-yellow-400 text-sm lowercase">processing face…</p>
        </div>
      )}
    </div>
  )
}

function loadImage(src: string, label: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (img.naturalWidth === 0 || img.naturalHeight === 0) {
        reject(new Error(`${label}: loaded but zero-size`))
        return
      }
      resolve(img)
    }
    img.onerror = (e) => {
      console.error('[loadImage] failed:', label, e)
      reject(new Error(`failed to load ${label}`))
    }
    img.src = src
  })
}

function makePlaceholderPatch(): FacePatch {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'rgba(0,0,0,0)'
  ctx.fillRect(0, 0, 64, 64)
  const alphaMask = ctx.createImageData(64, 64)
  return { canvas, alphaMask, cropRect: { x: 0, y: 0, size: 64 } }
}
