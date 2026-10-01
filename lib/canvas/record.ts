export type RecordResult = {
  blob: Blob
  url: string   // object URL, valid for blob lifetime
  mimeType: string
  ext: string   // file extension without dot
}

const PREFERRED_MIME_CHAIN: { mime: string; ext: string }[] = [
  { mime: 'video/webm;codecs=vp9', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
  { mime: 'video/mp4', ext: 'mp4' },
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

export function downloadBlob(result: RecordResult, filename: string): void {
  const a = document.createElement('a')
  a.href = result.url
  a.download = `${filename}.${result.ext}`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
