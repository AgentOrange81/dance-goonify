'use client'

import { useState } from 'react'
import { recordOneLoop, downloadBlob, pickRecorderMime } from '@/lib/canvas/record'

type Props = {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  videoRef: React.RefObject<HTMLVideoElement | null>
}

export function RecordButton({ canvasRef, videoRef }: Props) {
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supported = pickRecorderMime() !== null

  const onClick = async () => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video || recording) return
    setError(null)
    setRecording(true)
    try {
      // Snap the video to t=0, then record exactly one full loop. This way
      // every take starts at the same loop boundary so the clip is identical
      // on every capture (no mid-loop glitchy frames).
      const result = await recordOneLoop(canvas, video)
      downloadBlob(result, `dance-${Date.now()}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'record failed')
    } finally {
      setRecording(false)
    }
  }

  return (
    <div>
      <button
        onClick={onClick}
        disabled={!supported || recording}
        className={`
          w-full py-3 px-4 rounded font-medium lowercase transition-colors
          ${!supported
            ? 'bg-ink-700 text-gray-500 cursor-not-allowed'
            : recording
              ? 'bg-gold text-ink-900 animate-pulse'
              : 'bg-gold hover:bg-gold/80 text-ink-900'}
        `}
      >
        {recording ? '◉ recording one loop…' : '⏺ record & download'}
      </button>
      {!supported && (
        <p className="text-xs text-gray-500 mt-2 lowercase text-center">
          your browser doesn't support canvas recording
        </p>
      )}
      {error && (
        <p className="text-xs text-red-400 mt-2 lowercase text-center">
          {error}
        </p>
      )}
    </div>
  )
}
