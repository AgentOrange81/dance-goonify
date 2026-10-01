'use client'

import { useEffect, useRef, useState } from 'react'
import { getScene } from '@/lib/scenes'
import { drawScene, type DrawAssets } from '@/lib/canvas/drawScene'
import { applyColorTransfer, sampleEllipse } from '@/lib/face/colorMatch'
import type { FacePatch } from '@/lib/face/crop'

const CANVAS_W = 1280
const CANVAS_H = 720

export function SceneCanvas({
  sceneId,
  facePatch,
}: {
  sceneId: string
  facePatch: FacePatch | null
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [bgImg, setBgImg] = useState<HTMLImageElement | null>(null)
  const [dancerReady, setDancerReady] = useState(false)
  const [cropTightness, setCropTightness] = useState<number>(1.0)
  const [error, setError] = useState<string | null>(null)
  const rafRef = useRef<number | null>(null)
  const facePatchRef = useRef<FacePatch | null>(null)
  const dancerReadyRef = useRef(false)
  const sceneIdRef = useRef(sceneId)
  const cropTightnessRef = useRef(cropTightness)
  const bgImgRef = useRef<HTMLImageElement | null>(null)

  // Keep refs in sync so the RAF loop always reads latest values without restarting
  useEffect(() => { facePatchRef.current = facePatch }, [facePatch])
  useEffect(() => { dancerReadyRef.current = dancerReady }, [dancerReady])
  useEffect(() => { sceneIdRef.current = sceneId }, [sceneId])
  useEffect(() => { cropTightnessRef.current = cropTightness }, [cropTightness])
  useEffect(() => { bgImgRef.current = bgImg }, [bgImg])

  // Load background + set up the dancer video element whenever the scene changes
  useEffect(() => {
    const scene = getScene(sceneId)
    if (!scene) {
      setError(`unknown scene: ${sceneId}`)
      return
    }
    setError(null)
    setDancerReady(false)

    let cancelled = false

    // Background image
    const bgImgEl = new Image()
    bgImgEl.crossOrigin = 'anonymous'
    bgImgEl.onload = () => { if (!cancelled) setBgImg(bgImgEl) }
    bgImgEl.onerror = () => { if (!cancelled) setError(`failed to load bg: ${scene.background}`) }
    bgImgEl.src = scene.background

    // Dancer video element (hidden, plays in loop, used as canvas source)
    const vid = document.createElement('video')
    vid.src = scene.dancer
    vid.crossOrigin = 'anonymous'
    vid.loop = true
    vid.muted = true   // muted so autoplay works on all browsers
    vid.playsInline = true
    vid.preload = 'auto'
    videoRef.current = vid
    vid.onloadeddata = () => { if (!cancelled) setDancerReady(true) }
    vid.onerror = () => { if (!cancelled) setError(`failed to load video: ${scene.dancer}`) }
    vid.play().catch((err) => {
      // Autoplay can fail silently in some browsers — not fatal, video will still draw once user interacts
      console.warn('[SceneCanvas] video play() rejected:', err)
    })

    return () => {
      cancelled = true
      vid.pause()
      vid.removeAttribute('src')
      vid.load()
    }
  }, [sceneId])

  // Run color transfer once when face patch + dancer are ready
  useEffect(() => {
    if (!facePatch || !dancerReady) return
    const scene = getScene(sceneId)
    if (!scene) return
    const videoEl = videoRef.current
    if (!videoEl) return

    const fh = scene.faceHole
    // Need the video's intrinsic dimensions; H3 webm output is 1344x768
    const vw = videoEl.videoWidth || 1344
    const vh = videoEl.videoHeight || 768
    const sx = Math.max(2, Math.min(fh.rx * 0.35, Math.min(fh.cx - 2, vw - fh.cx - 2)))
    const sy = Math.max(2, Math.min(fh.ry * 0.35, Math.min(fh.cy - 2, vh - fh.cy - 2)))
    if (sx < 2 || sy < 2) return

    const dc = document.createElement('canvas')
    dc.width = vw
    dc.height = vh
    const dctx = dc.getContext('2d', { willReadFrequently: true })
    if (!dctx) return
    dctx.drawImage(videoEl, 0, 0)

    let targetStats
    try {
      targetStats = sampleEllipse(dctx, fh.cx, fh.cy, sx, sy)
    } catch {
      return
    }
    const targetLuma = 0.299 * targetStats.mean[0] + 0.587 * targetStats.mean[1] + 0.114 * targetStats.mean[2]
    if (targetLuma < 40) return

    const pctx = facePatch.canvas.getContext('2d', { willReadFrequently: true })
    if (!pctx) return
    const sz = facePatch.canvas.width
    const srcStats = sampleEllipse(pctx, sz / 2, sz * 0.35, sz * 0.18, sz * 0.18)
    applyColorTransfer(pctx, srcStats, targetStats, sz, sz)
    setCropTightness((t) => t)
  }, [facePatch, dancerReady, sceneId])

  // RAF loop — drives video frames into the canvas
  useEffect(() => {
    const loop = () => {
      const bg = bgImgRef.current
      const video = videoRef.current
      const fp = facePatchRef.current
      const scene = getScene(sceneIdRef.current)
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!ctx) {
        rafRef.current = requestAnimationFrame(loop)
        return
      }
      // Always draw the bg
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
      if (bg) ctx.drawImage(bg, 0, 0, CANVAS_W, CANVAS_H)
      // Draw the dancer only when there's a face to put on it
      if (fp && scene && video && video.readyState >= 2) {
        drawScene(ctx, scene, {
          background: bg!,
          dancer: video,
          facePatch: fp,
          cropTightness: cropTightnessRef.current,
        } as DrawAssets)
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <div className="relative w-full bg-black rounded-lg overflow-hidden" style={{ aspectRatio: `${CANVAS_W}/${CANVAS_H}` }}>
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        className="w-full h-full block"
      />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink-900/80">
          <p className="text-red-400 text-sm lowercase px-4 text-center">{error}</p>
        </div>
      )}
      {!facePatch && !error && (
        <div className="absolute bottom-3 left-3 bg-ink-900/70 rounded px-3 py-1.5 pointer-events-none">
          <p className="text-gray-400 text-xs lowercase">drop a photo to begin</p>
        </div>
      )}
      {facePatch && !error && (
        <div className="absolute bottom-3 left-3 right-3 bg-ink-900/80 rounded px-3 py-2">
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 lowercase w-16">face crop</span>
            <input
              type="range"
              min={0.5}
              max={1.3}
              step={0.01}
              value={cropTightness}
              onChange={(e) => setCropTightness(parseFloat(e.target.value))}
              className="flex-1 accent-teal-glow"
            />
            <span className="text-xs text-gray-400 tabular-nums w-10 text-right">
              {cropTightness.toFixed(2)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}