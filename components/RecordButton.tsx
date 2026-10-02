'use client'

import { useEffect, useState } from 'react'
import { recordOneLoop, pickRecorderMime, type RecordResult } from '@/lib/canvas/record'

type Props = {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  videoRef: React.RefObject<HTMLVideoElement | null>
  /** Active scene id; threaded into the saved filename so users can tell
   *  their front-grind and side-grind recordings apart in Downloads. */
  sceneId: string
}

type Phase = 'idle' | 'recording' | 'ready' | 'sharing'

function filenameForScene(sceneId: string, ext: string): string {
  const safe = sceneId.replace(/[^a-z0-9_-]/gi, '-').toLowerCase()
  return `dance-${safe}-${Date.now()}.${ext}`
}

function blobToFile(result: RecordResult): File {
  // The recorder's blob is untyped in the OS sense; wrap as a File so the
  // Web Share API can attach a real filename + MIME type. Used by `share()`.
  return new File([result.blob], filenameForScene('clip', result.ext), {
    type: result.mimeType,
  })
}

export function RecordButton({ canvasRef, videoRef, sceneId }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RecordResult | null>(null)
  const supported = pickRecorderMime() !== null

  // Clean up the object URL when the result is replaced or unmounted.
  useEffect(() => {
    return () => {
      if (result) URL.revokeObjectURL(result.url)
    }
  }, [result])

  const onClickRecord = async () => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video || phase === 'recording') return
    setError(null)
    setPhase('recording')
    try {
      // Snap the video to t=0, then record exactly one full loop. This way
      // every take starts at the same loop boundary so the clip is identical
      // on every capture (no mid-loop glitchy frames).
      const r = await recordOneLoop(canvas, video)
      // Replace any prior result (revoke old URL so we don't leak).
      setResult((prev) => {
        if (prev) URL.revokeObjectURL(prev.url)
        return r
      })
      setPhase('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'record failed')
      setPhase('idle')
    }
  }

  const onDownload = () => {
    if (!result) return
    const a = document.createElement('a')
    a.href = result.url
    a.download = filenameForScene(sceneId, result.ext)
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const onShare = async () => {
    if (!result) return
    // Web Share API requires a File (not just Blob) so the OS share sheet
    // shows a real filename and MIME. Browsers without it (most desktops)
    // fall through to the download button — that's fine, we keep both.
    const navAny = navigator as Navigator & { canShare?: (data: ShareData) => boolean; share?: (data: ShareData) => Promise<void> }
    if (typeof navAny.share !== 'function') return
    const file = blobToFile(result)
    const data: ShareData = {
      files: [file],
      title: 'dance.goonify',
      text: 'i made this — try it yourself',
    }
    if (typeof navAny.canShare === 'function' && !navAny.canShare(data)) {
      // OS can't accept the file (e.g., Safari without video share support).
      // Fall back to download.
      onDownload()
      return
    }
    setPhase('sharing')
    try {
      await navAny.share!(data)
    } catch (e) {
      // User-cancelled share shows up as AbortError; ignore silently.
      const msg = e instanceof Error ? e.message : String(e)
      if (!/abort/i.test(msg)) throw e
    } finally {
      setPhase('ready')
    }
  }

  const onDiscard = () => {
    setResult((prev) => {
      if (prev) URL.revokeObjectURL(prev.url)
      return null
    })
    setPhase('idle')
  }

  const onCopy = async () => {
    // Desktop fallback for sharing when Web Share API is unavailable: copy
    // a short message to clipboard so they can paste it anywhere.
    try {
      await navigator.clipboard.writeText('made this on dance.goonify.fun ✦ try it yourself')
    } catch {
      // Clipboard API blocked (insecure context, permission denied) — silently
      // skip. The download button is still available.
    }
  }

  // ---- Phase: ready -- post-recording preview + actions -------------------
  if (phase === 'ready' || phase === 'sharing') {
    return (
      <div className="space-y-2">
        <video
          src={result?.url}
          controls
          playsInline
          loop
          muted
          autoPlay
          className="w-full rounded border border-teal/30 bg-black"
        />
        <div className="flex gap-2">
          <button
            onClick={onDownload}
            className="flex-1 bg-gold hover:bg-gold/80 text-ink-900 font-medium py-2 px-3 rounded text-sm lowercase transition-colors"
          >
            ⤓ save
          </button>
          <button
            onClick={onShare}
            disabled={phase === 'sharing'}
            className="flex-1 bg-teal/20 hover:bg-teal/30 border border-teal/40 text-teal-glow font-medium py-2 px-3 rounded text-sm lowercase disabled:opacity-50 transition-colors"
          >
            {phase === 'sharing' ? 'sharing…' : '↗ share'}
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCopy}
            className="flex-1 bg-ink-700 hover:bg-ink-600 text-gray-300 py-2 px-3 rounded text-sm lowercase transition-colors"
            title="copy a short message to clipboard"
          >
            ✎ copy blurb
          </button>
          <button
            onClick={onClickRecord}
            className="flex-1 bg-ink-700 hover:bg-ink-600 text-gray-300 py-2 px-3 rounded text-sm lowercase transition-colors"
          >
            ⏺ record another
          </button>
          <button
            onClick={onDiscard}
            className="bg-ink-700 hover:bg-ink-600 text-gray-300 py-2 px-3 rounded text-sm lowercase transition-colors"
          >
            × discard
          </button>
        </div>
      </div>
    )
  }

  // ---- Phase: idle (no result yet) ---------------------------------------
  return (
    <div className="space-y-2">
      <button
        onClick={onClickRecord}
        disabled={!supported || phase === 'recording'}
        className={`
          w-full py-3 px-4 rounded font-medium lowercase transition-colors
          ${!supported
            ? 'bg-ink-700 text-gray-500 cursor-not-allowed'
            : phase === 'recording'
              ? 'bg-gold text-ink-900 animate-pulse'
              : 'bg-gold hover:bg-gold/80 text-ink-900'}
        `}
      >
        {phase === 'recording' ? '◉ recording one loop…' : '⏺ record one loop'}
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