'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { FacePatch } from '@/lib/face/crop'
import { cropOval } from '@/lib/face/crop'
import { detectFaceOval } from '@/lib/face/detect'

const ACCEPT = 'image/png,image/jpeg,image/webp'
const MAX_BYTES = 10 * 1024 * 1024

type Oval = {
  cx: number  // normalized 0..1 of source image naturalWidth
  cy: number  // normalized 0..1 of source image naturalHeight
  rx: number  // normalized 0..1 of source image naturalWidth
  ry: number  // normalized 0..1 of source image naturalHeight
}

const DEFAULT_OVAL: Oval = { cx: 0.5, cy: 0.4, rx: 0.18, ry: 0.22 }

type DragMode = 'move' | 'resize-rx' | 'resize-ry' | null

export function FacePicker({ onFaceReady }: { onFaceReady: (patch: FacePatch) => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [oval, setOval] = useState<Oval>(DEFAULT_OVAL)
  const [drag, setDrag] = useState<DragMode>(null)
  const [status, setStatus] = useState<'idle' | 'ready'>('idle')
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [autoDetectStatus, setAutoDetectStatus] = useState<'idle' | 'detecting' | 'found' | 'miss'>('idle')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const ovalRef = useRef<Oval>(DEFAULT_OVAL)
  const dragRef = useRef<{ startX: number; startY: number; startOval: Oval; mode: DragMode } | null>(null)

  useEffect(() => { ovalRef.current = oval }, [oval])

  const handleFile = useCallback(async (file: File) => {
    setErrorMsg('')
    if (file.size > MAX_BYTES) { setErrorMsg('file too large (max 10mb)'); return }
    if (!ACCEPT.split(',').includes(file.type)) { setErrorMsg('unsupported file type'); return }

    if (imgUrl) URL.revokeObjectURL(imgUrl)
    const url = URL.createObjectURL(file)
    setImgUrl(url)

    const newImg = new Image()
    newImg.crossOrigin = 'anonymous'
    newImg.src = url
    await new Promise<void>((resolve, reject) => {
      newImg.onload = () => resolve()
      newImg.onerror = () => reject(new Error('failed to load image'))
    })
    setImg(newImg)
    setOval(DEFAULT_OVAL)
    setStatus('ready')

    // Auto-detect face to seed the oval. We do this after setStatus('ready')
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

  const onConfirm = useCallback(() => {
    if (!img) return
    const W = img.naturalWidth
    const H = img.naturalHeight
    const patch = cropOval(img, {
      cx: oval.cx * W,
      cy: oval.cy * H,
      rx: oval.rx * W,
      ry: oval.ry * H,
    })
    onFaceReady(patch)
  }, [img, oval, onFaceReady])

  const onResetOval = useCallback(() => setOval(DEFAULT_OVAL), [])

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }

  if (status !== 'ready' || !img) {
    return (
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
          className="hidden"
          onChange={onInputChange}
        />
        <div className="text-gold text-4xl mb-3 lowercase">✦</div>
        <p className="text-gray-300 text-sm lowercase">drop your photo here</p>
        <p className="text-gray-500 text-xs mt-1 lowercase">or click to choose</p>
        {errorMsg && <p className="text-red-400 text-xs mt-3 lowercase">{errorMsg}</p>}
      </div>
    )
  }

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
          onClick={() => { setStatus('idle'); if (imgUrl) URL.revokeObjectURL(imgUrl); setImgUrl(null); setImg(null); setAutoDetectStatus('idle') }}
          className="bg-ink-700 hover:bg-ink-600 text-gray-300 py-2 px-3 rounded text-sm lowercase transition-colors"
        >
          change photo
        </button>
      </div>
      <p className="text-xs text-gray-500 lowercase text-center">
        {autoDetectStatus === 'detecting' && <span className="text-teal-glow">detecting face…</span>}
        {autoDetectStatus === 'found' && <span className="text-teal-glow">face auto-detected · drag to fine-tune</span>}
        {autoDetectStatus === 'miss' && 'drag the oval to position • drag the edge handles to resize'}
        {autoDetectStatus === 'idle' && 'drag the oval to position • drag the edge handles to resize'}
      </p>
    </div>
  )
}