'use client'

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'dance-age-confirmed'

export function AgeGate({ children }: { children: React.ReactNode }) {
  const [confirmed, setConfirmed] = useState<boolean | null>(null)

  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY)
      setConfirmed(v === 'true')
    } catch {
      setConfirmed(false)
    }
  }, [])

  // Don't flash the gate while we read localStorage
  if (confirmed === null) {
    return (
      <div className="min-h-screen bg-ink-900 flex items-center justify-center">
        <div className="text-teal-glow text-sm tracking-widest lowercase">loading…</div>
      </div>
    )
  }

  if (confirmed) return <>{children}</>

  const handleConfirm = () => {
    try { localStorage.setItem(STORAGE_KEY, 'true') } catch {}
    setConfirmed(true)
  }
  const handleDecline = () => {
    window.location.href = 'https://www.google.com'
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink-900/95 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-ink-800 border border-teal/30 rounded-lg p-8 text-center">
        <h1 className="text-2xl font-display lowercase text-gold mb-4">
          dance.goonify.fun
        </h1>
        <p className="text-gray-300 mb-2 text-sm lowercase">
          this site contains adult content.
        </p>
        <p className="text-gray-300 mb-8 text-sm lowercase">
          are you 18 or older?
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={handleConfirm}
            className="w-full bg-teal hover:bg-teal-glow text-ink-900 font-medium py-3 px-4 rounded lowercase transition-colors"
          >
            yes, i am 18+
          </button>
          <button
            onClick={handleDecline}
            className="w-full bg-transparent hover:bg-ink-700 text-gray-400 hover:text-white py-3 px-4 rounded lowercase transition-colors text-sm"
          >
            no, take me away
          </button>
        </div>
        <p className="text-gray-600 text-xs mt-6 lowercase">
          by continuing you confirm you are a legal adult in your jurisdiction.
          the operator does not verify age.
        </p>
      </div>
    </div>
  )
}