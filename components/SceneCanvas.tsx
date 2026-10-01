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
      return
    }
    sceneRef.current = scene
    setAssetsError(null)

    let cancelled = false
    Promise.all([
      loadImage(scene.background),
      loadImage(scene.dancer),
      scene.hairOverlay ? loadImage(scene.hairOverlay) : Promise.resolve(null),
    ]).then(([bg, dancer, hair]) => {
      if (cancelled) return
      // We don't have a face patch yet — set assets with a placeholder so the loop can run
      setAssets((prev) => ({
        background: bg!,
        dancer: dancer!,
        hairOverlay: hair ?? undefined,
        facePatch: prev?.facePatch ?? makePlaceholderPatch(),
      }))
    }).catch((err) => {
      if (cancelled) return
      setAssetsError(`failed to load scene assets: ${err instanceof Error ? err.message : err}`)
    })

    return () => { cancelled = true }
  }, [sceneId])

  // Whenever the face patch changes, re-run color transfer and update assets
  useEffect(() => {
    if (!assets || !facePatch) return
    const scene = sceneRef.current
    if (!scene) return

    // Sample a forehead ellipse from the dancer's face region (top center of dancerLayout)
    const dancerCtx = document.createElement('canvas')
    dancerCtx.width = assets.dancer.naturalWidth
    dancerCtx.height = assets.dancer.naturalHeight
    const dctx = dancerCtx.getContext('2d')
    if (!dctx) return
    dctx.drawImage(assets.dancer, 0, 0)

    // The dancer's face region in dancer-local coords: dancerLayout.x + faceHole.cx*w, similar for y
    const dl = scene.dancerLayout
    const fh = scene.faceHole
    const dancerFaceCx = dl.x + fh.cx * dl.w
    const dancerFaceCy = dl.y + fh.cy * dl.h
    const dancerFaceRx = fh.rx * dl.w * 0.4   // sample a small inner ellipse
    const dancerFaceRy = fh.ry * dl.h * 0.4

    let targetStats
    try {
      targetStats = sampleEllipse(dctx, dancerFaceCx, dancerFaceCy, dancerFaceRx, dancerFaceRy)
    } catch {
      // Sample area out of bounds; skip transfer
      setAssets((prev) => prev ? { ...prev, facePatch } : prev)
      return
    }

    // Sample source stats from the face patch (forehead area, top-center)
    const patchCtx = facePatch.canvas.getContext('2d', { willReadFrequently: true })
    if (!patchCtx) return
    const patchSize = facePatch.canvas.width
    const sourceStats = sampleEllipse(patchCtx, patchSize / 2, patchSize * 0.35, patchSize * 0.18, patchSize * 0.18)

    applyColorTransfer(patchCtx, sourceStats, targetStats, patchSize, patchSize)

    setAssets((prev) => prev ? { ...prev, facePatch } : prev)
  }, [facePatch])

  // RAF render loop
  useEffect(() => {
    if (!assets) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    startRef.current = performance.now()

    const loop = (now: number) => {
      const scene = sceneRef.current
      if (!scene) return
      const t = (now - startRef.current) / 1000
      const motion = computeMotion(scene, t)
      drawScene(ctx, scene, assets, motion, calRef.current)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [assets])

  // Expose the calibration state setter via a custom event so CalibratePanel can drive it
  // (Cleaner than prop-drilling through ScenePicker; App composition handles it.)
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

// Helper: load an HTMLImageElement from a URL, returns promise
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`failed to load ${src}`))
    img.src = src
  })
}

// Helper: placeholder 1x1 transparent canvas so the RAF loop has something to draw
// before the user uploads a photo
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
