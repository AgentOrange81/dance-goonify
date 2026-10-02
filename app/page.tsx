'use client'

import { useEffect, useRef, useState } from 'react'
import { FacePicker } from '@/components/FacePicker'
import { ScenePicker } from '@/components/ScenePicker'
import { SceneCanvas } from '@/components/SceneCanvas'
import { RecordButton } from '@/components/RecordButton'
import { SCENES } from '@/lib/scenes'
import type { FacePatch } from '@/lib/face/crop'
import { loadSceneId, saveSceneId } from '@/lib/storage'

export default function HomePage() {
  const [sceneId, setSceneId] = useState<string>(() => {
    const saved = loadSceneId()
    // Verify the saved id is still a known scene — guards against stale
    // localStorage entries from an older version of the app.
    return saved && SCENES.find((s) => s.id === saved) ? saved : SCENES[0].id
  })
  const [facePatch, setFacePatch] = useState<FacePatch | null>(null)
  // Owned by SceneCanvas via forwardRef so RecordButton.captureStream hits
  // the same canvas that the RAF loop paints into.
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // The hidden <video> lives inside SceneCanvas; the parent owns the ref so
  // RecordButton can poll video.currentTime for loop-aligned recording.
  const videoRef = useRef<HTMLVideoElement | null>(null)

  // Persist the active scene id so repeat visits land back on the same scene.
  useEffect(() => { saveSceneId(sceneId) }, [sceneId])

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
        <div className="lg:col-span-1 space-y-4">
          <section>
            <h2 className="text-xs uppercase tracking-widest text-gray-400 mb-2">
              1. pick your face
            </h2>
            <FacePicker onFaceReady={setFacePatch} />
          </section>

          <section>
            <h2 className="text-xs uppercase tracking-widest text-gray-400 mb-2">
              2. pick a scene
            </h2>
            <ScenePicker selectedId={sceneId} onSelect={setSceneId} />
          </section>

          <section>
            <h2 className="text-xs uppercase tracking-widest text-gray-400 mb-2">
              3. record
            </h2>
            <RecordButton canvasRef={canvasRef} videoRef={videoRef} sceneId={sceneId} />
          </section>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <SceneCanvas
            ref={canvasRef}
            externalVideoRef={videoRef}
            sceneId={sceneId}
            facePatch={facePatch}
          />
        </div>
      </div>
    </main>
  )
}
