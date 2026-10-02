'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { FacePatch } from '@/lib/face/crop'
import { cropOval } from '@/lib/face/crop'
import { detectFaceOval, detectFaceLandmarks } from '@/lib/face/detect'
import { loadOval, saveOval, loadFaceImage, saveFaceImage, clearPersistedFace } from '@/lib/storage'

const ACCEPT = 'image/png,image/jpeg,image/webp'
const MAX_BYTES = 10 * 1024 * 1024

/**
 * Encode a Uint8Array as base64 in chunks. The browser's built-in
 * `btoa(String.fromCharCode(...))` blows up for >~4MB inputs because of
 * argument-count limits, so we feed it in 4kB at a time.
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x1000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
  }
  return btoa(binary)
}

type Oval = {
  cx: number  // normalized 0..1 of source image naturalWidth
  cy: number  // normalized 0..1 of source image naturalHeight
  rx: number  // normalized 0..1 of source image naturalWidth
  ry: number  // normalized 0..1 of source image naturalHeight
}

const DEFAULT_OVAL: Oval = { cx: 0.5, cy: 0.4, rx: 0.18, ry: 0.22 }

type DragMode = 'move' | 'resize-rx' | 'resize-ry' | null

type View = 'idle' | 'camera' | 'ready'

export function FacePicker({ onFaceReady }: { onFaceReady: (patch: FacePatch) => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [oval, setOval] = useState<Oval>(() => loadOval() ?? DEFAULT_OVAL)
  const [drag, setDrag] = useState<DragMode>(null)
  const [view, setView] = useState<View>('idle')
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [autoDetectStatus, setAutoDetectStatus] = useState<'idle' | 'detecting' | 'found' | 'miss'>('idle')
  // Camera capture state
  const [cameraError, setCameraError] = useState<string>('')
  const [cameraStarting, setCameraStarting] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const ovalRef = useRef<Oval>(oval)
  const dragRef = useRef<{ startX: number; startY: number; startOval: Oval; mode: DragMode } | null>(null)

  useEffect(() => { ovalRef.current = oval }, [oval])

  // Persist the oval whenever it changes (debounced via the same render
  // path; saves are sync localStorage writes so no perf concern).
  useEffect(() => { saveOval(oval) }, [oval])

  // On mount: if we have a persisted face image, load it so the user lands
  // back where they left off (face already in the picker, oval already
  // positioned). We skip auto-detect because the saved oval takes priority —
  // the user explicitly dragged it last time.
  useEffect(() => {
    const persisted = loadFaceImage()
    if (!persisted) return
    let cancelled = false
    const newImg = new Image()
    newImg.crossOrigin = 'anonymous'
    newImg.src = persisted
    newImg.onload = () => {
      if (cancelled) return
      setImgUrl(persisted)
      setImg(newImg)
      setView('ready')
      setAutoDetectStatus('found')  // pretend auto-detect worked; the user already positioned the oval last time
    }
    newImg.onerror = () => {
      // Persisted image is corrupt or quota was wiped. Drop it.
      clearPersistedFace()
    }
    return () => { cancelled = true }
  }, [])

  // Stop any active camera stream when leaving the camera view or unmounting.
  useEffect(() => {
    if (view !== 'camera') {
      const s = cameraStreamRef.current
      if (s) {
        s.getTracks().forEach((t) => t.stop())
        cameraStreamRef.current = null
      }
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [view])

  useEffect(() => () => {
    const s = cameraStreamRef.current
    if (s) s.getTracks().forEach((t) => t.stop())
  }, [])

  const handleFile = useCallback(async (file: File) => {
    setErrorMsg('')
    if (file.size > MAX_BYTES) { setErrorMsg('file too large (max 10mb)'); return }
    if (!ACCEPT.split(',').includes(file.type)) { setErrorMsg('unsupported file type'); return }

    if (imgUrl) URL.revokeObjectURL(imgUrl)
    const url = URL.createObjectURL(file)
    setImgUrl(url)

    // Try to persist the image too — only worth it if it'll fit in localStorage.
    // Read the blob as a data URL and attempt to save; if saveFaceImage
    // returns false (quota exceeded), we silently continue without persistence.
    // We do this in parallel with the <img> decode so it doesn't add latency.
    file.arrayBuffer().then((buf) => {
      // Detect the right MIME-prefix for the data URL — the blob's MIME may
      // have been normalised by the OS (e.g., camera snaps land as image/jpeg).
      const mime = file.type || 'image/jpeg'
      const b64 = bytesToBase64(new Uint8Array(buf))
      saveFaceImage(`data:${mime};base64,${b64}`)
    }).catch(() => { /* persistence is best-effort */ })

    const newImg = new Image()
    newImg.crossOrigin = 'anonymous'
    newImg.src = url
    await new Promise<void>((resolve, reject) => {
      newImg.onload = () => resolve()
      newImg.onerror = () => reject(new Error('failed to load image'))
    })
    setImg(newImg)
    setOval(DEFAULT_OVAL)
    setView('ready')

    // Auto-detect face to seed the oval. We do this after setView('ready')
    // so the user can immediately start dragging if the detector is slow or
    // misses. Detection runs in the background; on success it snaps the oval
    // onto the detected face.
    setAutoDetectStatus('detecting')
    try {
      const face = await detectFaceOval(newImg)
      if (face) {
        const W = newImg.naturalWidth
        const H = newImg.naturalHeight
        const detected: Oval = {
          cx: face.cx / W,
          cy: face.cy / H,
          rx: face.rx / W,
          ry: face.ry / H,
        }
        setOval(detected)
        setAutoDetectStatus('found')
      } else {
        setAutoDetectStatus('miss')
      }
    } catch {
      // WASM/model load failed or model parse error — fall back silently to
      // the default oval; user can drag it into place.
      setAutoDetectStatus('miss')
    }
  }, [imgUrl])

  // ---- Camera capture ----------------------------------------------------
  const startCamera = useCallback(async () => {
    setCameraError('')
    setCameraStarting(true)
    try {
      // Prefer front-facing camera (mobile selfie default). Desktop browsers
      // fall back to whatever the default camera is.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })
      cameraStreamRef.current = stream
      setView('camera')
      // Attach stream to the <video> element after it mounts.
      requestAnimationFrame(() => {
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          v.play().catch(() => { /* autoplay restrictions, user will tap to play */ })
        }
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/denied|permission/i.test(msg)) {
        setCameraError('camera permission denied — use file upload instead')
      } else if (/NotFound|no.*camera/i.test(msg)) {
        setCameraError('no camera found — use file upload instead')
      } else {
        setCameraError(`camera error: ${msg}`)
      }
    } finally {
      setCameraStarting(false)
    }
  }, [])

  const snapPhoto = useCallback(() => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    // Mirror the snap horizontally so the captured image matches the mirrored
    // preview the user saw (front cameras are typically mirrored).
    const w = v.videoWidth
    const h = v.videoHeight
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.save()
    ctx.translate(w, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(v, 0, 0, w, h)
    ctx.restore()
    c.toBlob((blob) => {
      if (!blob) return
      const file = new File([blob], 'camera-snap.jpg', { type: 'image/jpeg' })
      void handleFile(file)
    }, 'image/jpeg', 0.92)
  }, [handleFile])

  // Render the picker: photo with oval overlay + drag handles
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = img.naturalWidth
    const H = img.naturalHeight
    canvas.width = W
    canvas.height = H

    ctx.drawImage(img, 0, 0, W, H)

    // Convert normalized oval to image pixels
    const o = ovalRef.current
    const cx = o.cx * W
    const cy = o.cy * H
    const rx = o.rx * W
    const ry = o.ry * H

    // Darken the area OUTSIDE the oval so the user can see what's selected
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, W, H)
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2, true)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.fill('evenodd')
    ctx.restore()

    // Oval outline
    ctx.save()
    ctx.lineWidth = Math.max(2, W * 0.004)
    ctx.strokeStyle = '#d4a55a'
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()

    // Resize handles (4 corners + 4 edge midpoints)
    const handleSize = Math.max(12, W * 0.018)
    ctx.fillStyle = '#d4a55a'
    const handles: [number, number][] = [
      [cx - rx, cy],          // left
      [cx + rx, cy],          // right
      [cx, cy - ry],          // top
      [cx, cy + ry],          // bottom
      [cx - rx * 0.7, cy - ry * 0.7],  // tl
      [cx + rx * 0.7, cy - ry * 0.7],  // tr
      [cx - rx * 0.7, cy + ry * 0.7],  // bl
      [cx + rx * 0.7, cy + ry * 0.7],  // br
    ]
    for (const [hx, hy] of handles) {
      ctx.beginPath()
      ctx.arc(hx, hy, handleSize / 2, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [img, oval])

  // Mouse / touch handling: convert pointer to image coords (account for canvas scaling)
  const getPointerInImage = useCallback((e: React.PointerEvent | PointerEvent) => {
    const canvas = canvasRef.current
    if (!canvas || !img) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const sx = img.naturalWidth / rect.width
    const sy = img.naturalHeight / rect.height
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy }
  }, [img])

  const pickHandle = useCallback((px: number, py: number, o: Oval, W: number, H: number): DragMode => {
    const cx = o.cx * W
    const cy = o.cy * H
    const rx = o.rx * W
    const ry = o.ry * H
    const HIT = Math.max(14, W * 0.02)
    // Right/left edges resize rx
    if (Math.abs(px - (cx + rx)) < HIT && Math.abs(py - cy) < ry) return 'resize-rx'
    if (Math.abs(px - (cx - rx)) < HIT && Math.abs(py - cy) < ry) return 'resize-rx'
    // Top/bottom edges resize ry
    if (Math.abs(py - (cy + ry)) < HIT && Math.abs(px - cx) < rx) return 'resize-ry'
    if (Math.abs(py - (cy - ry)) < HIT && Math.abs(px - cx) < rx) return 'resize-ry'
    // Inside oval = move
    const dx = (px - cx) / rx
    const dy = (py - cy) / ry
    if (dx * dx + dy * dy < 1) return 'move'
    return null
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!img) return
    e.preventDefault()
    const W = img.naturalWidth
    const H = img.naturalHeight
    const { x: px, y: py } = getPointerInImage(e)
    const mode = pickHandle(px, py, ovalRef.current, W, H)
    if (!mode) return
    setDrag(mode)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { startX: px, startY: py, startOval: { ...ovalRef.current }, mode }
  }, [img, getPointerInImage, pickHandle])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current || !img) return
    e.preventDefault()
    const W = img.naturalWidth
    const H = img.naturalHeight
    const { x: px, y: py } = getPointerInImage(e)
    const d = dragRef.current
    const start = d.startOval
    if (d.mode === 'move') {
      const dxN = (px - d.startX) / W
      const dyN = (py - d.startY) / H
      setOval({
        cx: Math.max(start.rx, Math.min(1 - start.rx, start.cx + dxN)),
        cy: Math.max(start.ry, Math.min(1 - start.ry, start.cy + dyN)),
        rx: start.rx, ry: start.ry,
      })
    } else if (d.mode === 'resize-rx') {
      const newRxPx = Math.abs(px - start.cx * W)
      const newRx = Math.max(0.04, Math.min(0.5, newRxPx / W))
      setOval({ ...start, rx: newRx })
    } else if (d.mode === 'resize-ry') {
      const newRyPx = Math.abs(py - start.cy * H)
      const newRy = Math.max(0.04, Math.min(0.5, newRyPx / H))
      setOval({ ...start, ry: newRy })
    }
  }, [img, getPointerInImage])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return
    setDrag(null)
    dragRef.current = null
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
  }, [])

  const onConfirm = useCallback(async () => {
    if (!img) return
    const W = img.naturalWidth
    const H = img.naturalHeight
    // Run FaceLandmarker on the user's photo to get 478 landmarks for
    // Delaunay warping. Best-effort — if it fails (stylized face didn't
    // pass thresholds), we still produce a patch; the renderer will fall
    // back to the legacy oval path because `sourceLandmarks` is null.
    let sourceLandmarks = null
    try {
      const rawLm = await detectFaceLandmarks(img)
      if (rawLm && rawLm.length === 478) {
        sourceLandmarks = rawLm.map((lm) => ({
          x: lm.x * W,
          y: lm.y * H,
          z: lm.z,
        }))
      }
    } catch {
      // Landmarker load failed; legacy path will be used at render time.
    }
    const patch = cropOval(img, {
      cx: oval.cx * W,
      cy: oval.cy * H,
      rx: oval.rx * W,
      ry: oval.ry * H,
      landmarks: sourceLandmarks,
    })
    onFaceReady(patch)
  }, [img, oval, onFaceReady])

  const onResetOval = useCallback(() => setOval(DEFAULT_OVAL), [])

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
    // Reset the input so picking the same file again re-triggers onChange.
    e.target.value = ''
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }

  const resetToIdle = useCallback(() => {
    setView('idle')
    if (imgUrl) URL.revokeObjectURL(imgUrl)
    setImgUrl(null)
    setImg(null)
    setAutoDetectStatus('idle')
    setErrorMsg('')
    // Clear the persisted image so the next page load starts clean. The
    // saved oval is left in place — it's normalized 0..1 coords so it's
    // harmless if the new photo has a different composition (the auto-
    // detect on next upload will overwrite it anyway).
    clearPersistedFace()
  }, [imgUrl])

  // ---- Render: idle (no image yet) ---------------------------------------
  if (view === 'idle') {
    return (
      <div className="space-y-3">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="relative w-full aspect-video border-2 border-dashed border-teal/40 bg-ink-800 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-teal-glow/60 transition-colors"
          onClick={() => document.getElementById('face-picker-input')?.click()}
        >
          <input
            id="face-picker-input"
            type="file"
            accept={ACCEPT}
            // `capture="user"` is a hint for mobile browsers — when the user
            // taps to choose a file, they're offered a camera option that
            // opens the front-facing cam. Desktop browsers ignore it. This
            // gives users a second path to camera capture without needing
            // getUserMedia permissions.
            capture="user"
            className="hidden"
            onChange={onInputChange}
          />
          <div className="text-gold text-4xl mb-3 lowercase">✦</div>
          <p className="text-gray-300 text-sm lowercase">drop your photo here</p>
          <p className="text-gray-500 text-xs mt-1 lowercase">or click to choose a file</p>
          {errorMsg && <p className="text-red-400 text-xs mt-3 lowercase">{errorMsg}</p>}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-px bg-ink-700" />
          <span className="text-gray-500 text-xs lowercase">or</span>
          <div className="flex-1 h-px bg-ink-700" />
        </div>
        <button
          onClick={startCamera}
          disabled={cameraStarting}
          className="w-full bg-teal/20 hover:bg-teal/30 border border-teal/40 text-teal-glow font-medium py-3 rounded text-sm disabled:opacity-50 lowercase transition-colors"
        >
          {cameraStarting ? 'starting camera…' : '📷 take a photo with my camera'}
        </button>
        {cameraError && <p className="text-red-400 text-xs lowercase text-center">{cameraError}</p>}
      </div>
    )
  }

  // ---- Render: camera (live preview) -------------------------------------
  if (view === 'camera') {
    return (
      <div className="space-y-2">
        <div
          className="relative w-full bg-black overflow-hidden rounded-lg border border-teal/30"
          style={{ aspectRatio: '16 / 9' }}
        >
          {/* Mirror the preview horizontally so it matches the user's
              expectation of a selfie cam (front-facing cameras are typically
              mirrored in chat apps). */}
          <video
            ref={videoRef}
            playsInline
            muted
            className="w-full h-full object-cover"
            style={{ transform: 'scaleX(-1)' }}
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={snapPhoto}
            className="flex-1 bg-gold hover:bg-gold/80 text-ink-900 font-medium py-3 rounded text-sm lowercase transition-colors"
          >
            ✦ snap
          </button>
          <button
            onClick={() => setView('idle')}
            className="bg-ink-700 hover:bg-ink-600 text-gray-300 py-3 px-4 rounded text-sm lowercase transition-colors"
          >
            cancel
          </button>
        </div>
        <p className="text-xs text-gray-500 lowercase text-center">
          hold steady · face the camera
        </p>
      </div>
    )
  }

  // ---- Render: ready (oval picker over the chosen image) -----------------
  if (view !== 'ready' || !img) return null

  return (
    <div ref={containerRef} className="space-y-2">
      <div className="relative w-full bg-black overflow-hidden rounded-lg border border-teal/30" style={{ aspectRatio: `${img.naturalWidth}/${img.naturalHeight}` }}>
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="w-full h-full block touch-none cursor-crosshair"
        />
        {/* Auto-detect overlay — shows a spinner while MediaPipe is warming
            up, fades out once the face is found (or a beat after miss).
            More visible than the old small-text hint so users see the app is
            working on their photo instead of assuming it's frozen. */}
        {autoDetectStatus === 'detecting' && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink-900/40 pointer-events-none">
            <div className="flex flex-col items-center gap-2">
              <div className="w-10 h-10 border-2 border-teal/40 border-t-teal-glow rounded-full animate-spin" />
              <p className="text-teal-glow text-xs lowercase">detecting face…</p>
            </div>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          className="flex-1 bg-gold hover:bg-gold/80 text-ink-900 font-medium py-2 px-3 rounded text-sm lowercase transition-colors"
        >
          ✦ use this face
        </button>
        <button
          onClick={onResetOval}
          className="bg-ink-700 hover:bg-ink-600 text-gray-300 py-2 px-3 rounded text-sm lowercase transition-colors"
        >
          reset oval
        </button>
        <button
          onClick={resetToIdle}
          className="bg-ink-700 hover:bg-ink-600 text-gray-300 py-2 px-3 rounded text-sm lowercase transition-colors"
        >
          change photo
        </button>
      </div>
      <p className="text-xs text-gray-500 lowercase text-center">
        {autoDetectStatus === 'found' && <span className="text-teal-glow">face auto-detected · drag to fine-tune</span>}
        {(autoDetectStatus === 'miss' || autoDetectStatus === 'idle') && 'drag the oval to position • drag the edge handles to resize'}
      </p>
    </div>
  )
}