'use client'

import { useCallback, useRef, useState } from 'react'
import { detectFace, fallbackBbox } from '@/lib/face/detector'
import { cropFace, type FacePatch } from '@/lib/face/crop'

const MAX_BYTES = 10 * 1024 * 1024
const ACCEPT = 'image/png,image/jpeg,image/webp'

export function DropZone({ onFaceReady }: { onFaceReady: (patch: FacePatch, source: HTMLImageElement) => void }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'no-face' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string>('')
  const inputRef = useRef<HTMLInputElement>(null)
  const dragOverRef = useRef(false)

  const handleFile = useCallback(async (file: File) => {
    setErrorMsg('')
    if (file.size > MAX_BYTES) {
      setStatus('error')
      setErrorMsg('file too large (max 10mb)')
      return
    }
    if (!ACCEPT.split(',').includes(file.type)) {
      setStatus('error')
      setErrorMsg('unsupported file type')
      return
    }

    setStatus('loading')

    const url = URL.createObjectURL(file)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = url

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('failed to load image'))
    })

    try {
      let landmarks = await detectFace(img)
      if (!landmarks) {
        console.warn('[dropzone] no face detected, using center-crop fallback')
        landmarks = fallbackBbox(img.naturalWidth, img.naturalHeight)
        if (landmarks.confidence === 0) {
          // fallback bbox has 0 confidence — warn the user
          setStatus('no-face')
          // still continue with the fallback so the tool is usable
        }
      }
      const patch = cropFace(img, landmarks)
      // TODO: color transfer to dancer reference happens in SceneCanvas once scene is loaded
      setStatus('ready')
      onFaceReady(patch, img)
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'unknown error')
      URL.revokeObjectURL(url)
    }
  }, [onFaceReady])

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    dragOverRef.current = false
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); dragOverRef.current = true }}
      onDragLeave={() => { dragOverRef.current = false }}
      onDrop={onDrop}
      className={`
        relative w-full aspect-video
        border-2 border-dashed rounded-lg
        flex flex-col items-center justify-center
        transition-colors cursor-pointer
        ${dragOverRef.current ? 'border-teal-glow bg-teal-dim/30' : 'border-teal/40 bg-ink-800 hover:border-teal-glow/60'}
      `}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={onInputChange}
      />

      {status === 'idle' && (
        <>
          <div className="text-gold text-4xl mb-3 lowercase">✦</div>
          <p className="text-gray-300 text-sm lowercase">
            drop your photo here
          </p>
          <p className="text-gray-500 text-xs mt-1 lowercase">
            or click to choose. front-facing headshot works best.
          </p>
        </>
      )}

      {status === 'loading' && (
        <p className="text-teal-glow text-sm lowercase animate-pulse">
          detecting face…
        </p>
      )}

      {status === 'no-face' && (
        <div className="text-center px-4">
          <p className="text-yellow-400 text-sm lowercase">
            no face detected — using center crop
          </p>
          <p className="text-gray-500 text-xs mt-1 lowercase">
            calibrate sliders below to position it
          </p>
        </div>
      )}

      {status === 'error' && (
        <div className="text-center px-4">
          <p className="text-red-400 text-sm lowercase">error</p>
          <p className="text-gray-500 text-xs mt-1 lowercase">{errorMsg}</p>
        </div>
      )}

      {status === 'ready' && (
        <p className="text-teal-glow text-sm lowercase">face ready ✦</p>
      )}
    </div>
  )
}