'use client'

import { forwardRef, useEffect, useRef, useState } from 'react'
import { getScene, faceHoleAt, CANVAS_W, CANVAS_H } from '@/lib/scenes'
import {
  drawVideoFrame,
  drawPatch,
  applyOneShotColorMatch,
} from '@/lib/canvas/drawScene'
import type { FacePatch } from '@/lib/face/crop'

type Props = {
  sceneId: string
  facePatch: FacePatch | null
  /** Optional ref the parent owns so RecordButton can poll `video.currentTime`
   *  for loop-aligned recording. If omitted, SceneCanvas owns its own ref. */
  externalVideoRef?: React.RefObject<HTMLVideoElement | null>
}

/**
 * Plays the dancer plate on a hidden <video>, then composites it onto a canvas
 * each RAF tick. The parent owns the canvas element via forwardRef so the
 * RecordButton can grab the same canvas for captureStream().
 */
export const SceneCanvas = forwardRef<HTMLCanvasElement, Props>(function SceneCanvas(
  { sceneId, facePatch, externalVideoRef },
  ref,
) {
  const internalVideoRef = useRef<HTMLVideoElement | null>(null)
  const videoRef = externalVideoRef ?? internalVideoRef
  const [cropTightness, setCropTightness] = useState<number>(1.0)
  const [error, setError] = useState<string | null>(null)
  const rafRef = useRef<number | null>(null)
  // Refs mirror props so the RAF closure always reads fresh values.
  const facePatchRef = useRef<FacePatch | null>(null)
  const sceneIdRef = useRef(sceneId)
  const tightnessRef = useRef(cropTightness)
  // Track which (scene, patch) pair the patch was last colour-matched for.
  // A patch matched against the front scene looks wrong on the side scene;
  // we re-match whenever either changes. We compare references directly —
  // a new patch object means the user picked a new face.
  const matchedSceneRef = useRef<string>('')
  const matchedPatchRef = useRef<FacePatch | null>(null)

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
  }, [sceneId, videoRef])

  // RAF loop — composes the video frame, optionally applies the one-shot
  // colour match, then draws the patch on top. The order matters: we paint
  // the video first so the colour-match sample reads pure dancer skin, not
  // the previous frame's composite.
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
        const fp = facePatchRef.current

        try {
          // 1. Paint the current video frame as the base layer.
          drawVideoFrame(ctx, video)

          // 2. One-shot Lab colour match: runs the first time we composite
          //    this (scene, patch) pair, and any time either changes. Must
          //    happen AFTER the video draw and BEFORE the patch so the
          //    sample reads pure dancer skin. `applyOneShotColorMatch`
          //    resets the working canvas from `patch.originalCanvas`, so a
          //    scene switch never re-transforms an already-transformed
          //    patch.
          if (fp && (matchedPatchRef.current !== fp || matchedSceneRef.current !== scene.id)) {
            applyOneShotColorMatch(ctx, fh, fp, 0.7)
            matchedPatchRef.current = fp
            matchedSceneRef.current = scene.id
          }

          // 3. Composite the patch on top with the decontamination ring.
          if (fp) {
            drawPatch(ctx, fh, fp, tightnessRef.current)
          }
        } catch (err) {
          // drawVideoFrame / drawPatch can throw if the canvas is tainted
          // or video state is bad. Skip this tick; the next RAF retries.
          // Never crash the loop.
          console.warn('[SceneCanvas] frame draw failed, skipping:', err)
        }
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [ref, videoRef])

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
