'use client'

import { forwardRef, useEffect, useRef, useState } from 'react'
import { getScene, faceHoleAt, CANVAS_W, CANVAS_H } from '@/lib/scenes'
import { drawScene, type DrawAssets } from '@/lib/canvas/drawScene'
import type { FacePatch } from '@/lib/face/crop'

type Props = {
  sceneId: string
  facePatch: FacePatch | null
}

/**
 * Plays the dancer plate on a hidden <video>, then composites it onto a canvas
 * each RAF tick. The parent owns the canvas element via forwardRef so the
 * RecordButton can grab the same canvas for captureStream().
 */
export const SceneCanvas = forwardRef<HTMLCanvasElement, Props>(function SceneCanvas(
  { sceneId, facePatch },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [cropTightness, setCropTightness] = useState<number>(1.0)
  const [error, setError] = useState<string | null>(null)
  const rafRef = useRef<number | null>(null)
  // Refs mirror props so the RAF closure always reads fresh values.
  const facePatchRef = useRef<FacePatch | null>(null)
  const sceneIdRef = useRef(sceneId)
  const tightnessRef = useRef(cropTightness)

  useEffect(() => { facePatchRef.current = facePatch }, [facePatch])
  useEffect(() => { sceneIdRef.current = sceneId }, [sceneId])
  useEffect(() => { tightnessRef.current = cropTightness }, [cropTightness])

  // Swap the dancer plate when the scene changes. The video element is mounted
  // in the JSX, so the browser handles decoding; we just swap src and play().
  useEffect(() => {
    const scene = getScene(sceneId)
    const vid = videoRef.current
    if (!scene || !vid) return
    vid.src = scene.dancer
    vid.load()
    vid.play().catch((err) => {
      console.warn('[SceneCanvas] video play() rejected:', err)
    })
  }, [sceneId])

  // RAF loop — draws the current video frame + face patch every tick.
  useEffect(() => {
    const loop = () => {
      const video = videoRef.current
      const canvas = ref && 'current' in (ref as React.RefObject<HTMLCanvasElement>)
        ? (ref as React.RefObject<HTMLCanvasElement>).current
        : null
      const ctx = canvas?.getContext('2d')
      if (!ctx) {
        rafRef.current = requestAnimationFrame(loop)
        return
      }
      const scene = getScene(sceneIdRef.current)
      if (scene && video && video.readyState >= 2) {
        const dur = video.duration > 0 ? video.duration : 1
        const t = (video.currentTime % dur) / dur
        const fh = faceHoleAt(scene, t)
        try {
          drawScene(ctx, scene, fh, {
            dancer: video,
            facePatch: facePatchRef.current,
            cropTightness: tightnessRef.current,
          } as DrawAssets)
        } catch (err) {
          // drawScene can throw if the canvas is tainted or video state is
          // bad. Skip this tick; the next RAF retries. Never crash the loop.
          console.warn('[SceneCanvas] drawScene failed, skipping frame:', err)
        }
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [ref])

  return (
    <div
      className="relative w-full bg-black rounded-lg overflow-hidden"
      style={{ aspectRatio: `${CANVAS_W}/${CANVAS_H}` }}
    >
      <canvas
        ref={ref}
        width={CANVAS_W}
        height={CANVAS_H}
        className="w-full h-full block"
      />
      {/* Hidden video — must be in the DOM for the browser to decode frames. */}
      <video
        ref={videoRef}
        loop
        muted
        playsInline
        preload="auto"
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
})
