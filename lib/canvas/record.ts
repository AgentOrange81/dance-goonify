export type RecordResult = {
  blob: Blob
  url: string   // object URL, valid for blob lifetime
  mimeType: string
  ext: string   // file extension without dot
}

const PREFERRED_MIME_CHAIN: { mime: string; ext: string }[] = [
  // WebM with VP9 (best quality, ~30% smaller than VP8, broad support)
  { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { mime: 'video/webm;codecs=vp9', ext: 'webm' },
  // WebM with VP8 (universal support, slightly larger)
  { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8', ext: 'webm' },
  // H.264 in MP4 (Safari/iOS native — fallback for cross-platform sharing)
  { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' },
  { mime: 'video/mp4', ext: 'mp4' },
  // Plain WebM (last resort)
  { mime: 'video/webm', ext: 'webm' },
]

export function pickRecorderMime(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const opt of PREFERRED_MIME_CHAIN) {
    if (MediaRecorder.isTypeSupported(opt.mime)) return opt
  }
  return null
}

export async function recordCanvas(
  canvas: HTMLCanvasElement,
  durationMs: number
): Promise<RecordResult> {
  const picked = pickRecorderMime()
  if (!picked) throw new Error('No supported MediaRecorder MIME type')

  const stream = (canvas as HTMLCanvasElement).captureStream(30)
  const recorder = new MediaRecorder(stream, { mimeType: picked.mime })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data) }

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })

  recorder.start()
  await new Promise((r) => setTimeout(r, durationMs))
  recorder.stop()
  // Stop all tracks to release the captureStream
  stream.getTracks().forEach((t) => t.stop())
  await stopped

  const blob = new Blob(chunks, { type: picked.mime })
  const url = URL.createObjectURL(blob)
  return { blob, url, mimeType: picked.mime, ext: picked.ext }
}

/**
 * Seek the video to t=0, wait for the seek to land and for the canvas RAF
 * to paint the new frame, then record exactly one full loop. Use this when
 * the recording should start on a loop boundary so the clip is always
 * loop-aligned and looks the same on every take.
 */
export async function recordOneLoop(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
): Promise<RecordResult> {
  const dur = video.duration
  if (!isFinite(dur) || dur <= 0) {
    throw new Error('video has no duration yet; wait for it to load')
  }
  // Snap to loop start and wait for the browser to paint the new frame.
  video.currentTime = 0
  await new Promise<void>((resolve) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked)
      resolve()
    }
    video.addEventListener('seeked', onSeeked, { once: true })
    // Safety: if the seek event never fires (already at 0, or browser quirks),
    // resolve after 250ms so we don't deadlock.
    setTimeout(resolve, 250)
  })
  // The `seeked` event fires when the browser has the new frame data for the
  // <video>, but the canvas RAF hasn't necessarily painted it yet. Wait two
  // RAFs so the captureStream's first frame is the real frame 0, not a
  // seek-in-progress artifact.
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
  // Record one full loop plus a 0.5s tail so the last frame is fully captured.
  return recordCanvas(canvas, Math.ceil(dur * 1000) + 500)
}

export function downloadBlob(result: RecordResult, filename: string): void {
  const a = document.createElement('a')
  a.href = result.url
  a.download = `${filename}.${result.ext}`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
