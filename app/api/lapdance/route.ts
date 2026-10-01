import { NextResponse } from 'next/server'

// Path A product: this endpoint is the documented contract for a future GPU worker.
// When LAPDANCE_WORKER_URL is set, we proxy the upload there. When not, we return 501
// with a `preview: true` flag so the client knows the canvas preview IS the product
// and no server-side swap ran.
//
// Why this exists: it lets us ship Path A now and Path B later without an API break.

export async function POST(request: Request) {
  const workerUrl = process.env.LAPDANCE_WORKER_URL
  if (!workerUrl) {
    return NextResponse.json(
      {
        error: 'video gen not configured',
        preview: true,
        message: 'The browser preview is the product. Path B (server-side swap) is not enabled.',
      },
      { status: 501 }
    )
  }

  // Path B: proxy the multipart upload to the worker
  try {
    const formData = await request.formData()
    const response = await fetch(workerUrl, {
      method: 'POST',
      body: formData,
    })
    if (!response.ok) {
      return NextResponse.json(
        { error: `worker returned ${response.status}` },
        { status: response.status }
      )
    }
    // Stream the worker's response back to the client
    const blob = await response.blob()
    return new Response(blob, {
      status: 200,
      headers: {
        'Content-Type': response.headers.get('Content-Type') ?? 'video/mp4',
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'worker proxy failed' },
      { status: 502 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'lapdance api online',
    path_b_enabled: !!process.env.LAPDANCE_WORKER_URL,
    timestamp: new Date().toISOString(),
  })
}
