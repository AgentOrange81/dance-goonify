import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'dance.goonify.fun',
    timestamp: new Date().toISOString(),
  })
}
