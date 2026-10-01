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
  const [cropTightness, setCropTightness] = useState<number>(1.0)
  const [error, setError] = useState<string | null>(null)
  const rafRef = useRef<number | null>(null)
  const facePatchRef = useRef<FacePatch | null>(null)
  const sceneIdRef = useRef(sceneId)
  const cropTightnessRef = useRef(cropTightness)

  useEffect(() => { facePatchRef.current = facePatch }, [facePatch])
  useEffect(() => { sceneIdRef.current = sceneId }, [sceneId])
  useEffect(() => { cropTightnessRef.current = cropTightness }, [cropTightness])

  // Update the video's src when the scene changes. The <video> element is mounted in the JSX,
  // so the browser decodes and plays it normally. We just swap the src.
  useEffect(() => {
    const scene = getScene(sceneId)
    if (!scene) return
    const vid = videoRef.current
    if (!vid) return
    vid.src = scene.dancer
    vid.load()
    vid.play().catch((err) => {
      console.warn('[SceneCanvas] video play() rejected:', err)
    })
  }, [sceneId])

  // RAF loop — draws the current video frame + face patch (if any) every frame
  useEffect(() => {
    const loop = () => {
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
      if (scene && video && video.readyState >= 2) {
        const dur = video.duration > 0 ? video.duration : 1
        const t = (video.currentTime % dur) / dur
        const fh = faceHoleAt(scene, t)
        drawScene(ctx, scene, fh, {
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
      {/* Hidden video element — must be in DOM for browser to decode frames. */}
      <video
        ref={videoRef}
        loop
        muted
        playsInline
        crossOrigin="anonymous"
        className="absolute opacity-0 pointer-events-none w-0 h-0"
        aria-hidden="true"
      />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink-900/80">
          <p className="text-red-400 text-sm lowercase px-4 text-center">{error}</p>
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