'use client'

import { useState } from 'react'
import { recordCanvas, downloadBlob, pickRecorderMime } from '@/lib/canvas/record'

export function RecordButton({ canvasRef }: { canvasRef: React.RefObject<HTMLCanvasElement | null> }) {
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supported = pickRecorderMime() !== null

  const onClick = async () => {
    const canvas = canvasRef.current
    if (!canvas || recording) return
    setError(null)
    setRecording(true)
    try {
      const result = await recordCanvas(canvas, 6000)
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
        {recording ? '◉ recording 6s…' : '⏺ record & download'}
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
