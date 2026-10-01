import './globals.css'
import type { Metadata } from 'next'
import { AgeGate } from '@/components/AgeGate'

export const metadata: Metadata = {
  title: 'dance.goonify.fun',
  description: 'your pfp + click or drop ✦ become the dance',
  robots: 'noindex, nofollow',  // 18+ content, no search indexing
  openGraph: {
    title: 'dance.goonify.fun',
    description: 'your pfp + click or drop ✦ become the dance',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-body bg-ink-900">
        <AgeGate>
          {children}
        </AgeGate>
      </body>
    </html>
  )
}
