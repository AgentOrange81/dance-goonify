'use client'

import { useEffect, useRef, useState } from 'react'
import { FacePicker } from '@/components/FacePicker'
import { ScenePicker } from '@/components/ScenePicker'
import { SceneCanvas } from '@/components/SceneCanvas'
import { RecordButton } from '@/components/RecordButton'
import { SCENES } from '@/lib/scenes'
import type { FacePatch } from '@/lib/face/crop'

export default function HomePage() {
  const [sceneId, setSceneId] = useState<string>(SCENES[0].id)
  const [facePatch, setFacePatch] = useState<FacePatch | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    canvasRef.current = document.querySelector('canvas')
  }, [sceneId, facePatch])

  const handleFaceReady = (patch: FacePatch) => {
    setFacePatch(patch)
  }

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-6xl mx-auto">
      <header className="mb-8 text-center">
        <h1 className="text-3xl md:text-4xl font-display lowercase text-gold tracking-tight">
          dance.goonify.fun
        </h1>
        <p className="text-gray-400 text-sm mt-2 lowercase">
          your pfp + click or drop ✦ become the dance
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: face picker + scene picker + record */}
        <div className="lg:col-span-1 space-y-4">
          <section>
            <h2 className="text-xs uppercase tracking-widest text-gray-400 mb-2">
              1. pick your face
            </h2>
            <FacePicker onFaceReady={handleFaceReady} />
          </section>

          <section>
            <h2 className="text-xs uppercase tracking-widest text-gray-400 mb-2">
              2. pick a scene
            </h2>
            <ScenePicker
              selectedId={sceneId}
              onSelect={(id) => setSceneId(id)}
            />
          </section>

          <section>
            <h2 className="text-xs uppercase tracking-widest text-gray-400 mb-2">
              3. download
            </h2>
            <RecordButton canvasRef={canvasRef} />
          </section>
        </div>

        {/* Right column: canvas */}
        <div className="lg:col-span-2 space-y-4">
          <SceneCanvas sceneId={sceneId} facePatch={facePatch} />
        </div>
      </div>
    </main>
  )
}