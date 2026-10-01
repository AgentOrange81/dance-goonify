'use client'

import { useEffect, useRef, useState } from 'react'
import { getScene, faceHoleAt } from '@/lib/scenes'
import { drawScene, type DrawAssets } from '@/lib/canvas/drawScene'
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
  const [cropTightness, setCropTightness] = useState<number>(1.0)
  const [error, setError] = useState<string | null>(null)
  const rafRef = useRef<number | null>(null)
  const facePatchRef = useRef<FacePatch | null>(null)
  const sceneIdRef = useRef(sceneId)
  const cropTightnessRef = useRef(cropTightness)
  const bgImgRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => { facePatchRef.current = facePatch }, [facePatch])
  useEffect(() => { sceneIdRef.current = sceneId }, [sceneId])
  useEffect(() => { cropTightnessRef.current = cropTightness }, [cropTightness])
  useEffect(() => { bgImgRef.current = bgImg }, [bgImg])

  // Load background + dancer video whenever scene changes
  useEffect(() => {
    const scene = getScene(sceneId)
    if (!scene) {
      setError(`unknown scene: ${sceneId}`)
      return
    }
    setError(null)
    let cancelled = false

    const bgImgEl = new Image()
    bgImgEl.crossOrigin = 'anonymous'
    bgImgEl.onload = () => { if (!cancelled) setBgImg(bgImgEl) }
    bgImgEl.onerror = () => { if (!cancelled) setError(`failed to load bg: ${scene.background}`) }
    bgImgEl.src = scene.background

    const vid = document.createElement('video')
    vid.src = scene.dancer
    vid.crossOrigin = 'anonymous'
    vid.loop = true
    vid.muted = true
    vid.playsInline = true
    vid.preload = 'auto'
    videoRef.current = vid
    vid.onloadeddata = () => { /* video ready, RAF will pick it up */ }
    vid.onerror = () => { if (!cancelled) setError(`failed to load video: ${scene.dancer}`) }
    vid.play().catch((err) => {
      console.warn('[SceneCanvas] video play() rejected:', err)
    })

    return () => {
      cancelled = true
      vid.pause()
      vid.removeAttribute('src')
      vid.load()
    }
  }, [sceneId])

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
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
      if (bg) ctx.drawImage(bg, 0, 0, CANVAS_W, CANVAS_H)
      if (scene && video && video.readyState >= 2) {
        // Compute the face-hole position for the current video frame, so the patch tracks
        // the dancer's head across the loop.
        const dur = video.duration > 0 ? video.duration : 1
        const t = (video.currentTime % dur) / dur
        const fh = faceHoleAt(scene, t)
        drawScene(ctx, scene, fh, {
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
          <p className="text-gray-400 text-xs lowercase">drop a photo to put your face here</p>
        </div>
      )}
      {facePatch && !error && (
        <div className="absolute bottom-3 left-3 right-3 bg-ink-900/80 rounded px-3 py-2">
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 lowercase w-16">face crop</span>
            <input
              type="range"
              min={0.5}
              max={1.5}
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