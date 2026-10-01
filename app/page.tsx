'use client'

import { useEffect, useRef, useState } from 'react'
import { DropZone } from '@/components/DropZone'
import { ScenePicker } from '@/components/ScenePicker'
import { SceneCanvas, type Calibration } from '@/components/SceneCanvas'
import { CalibratePanel } from '@/components/CalibratePanel'
import { RecordButton } from '@/components/RecordButton'
import { SCENES } from '@/lib/scenes'
import type { FacePatch } from '@/lib/face/crop'

export default function HomePage() {
  const [sceneId, setSceneId] = useState<string>(SCENES[0].id)
  const [facePatch, setFacePatch] = useState<FacePatch | null>(null)
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null)
  const [calibration, setCalibration] = useState<Calibration>({ dx: 0, dy: 0, rxMul: 1, ryMul: 1, rotation: 0 })
  const recordCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // After mount, the SceneCanvas's <canvas> is in the DOM — point RecordButton at it.
  // We use a ref callback on a parent wrapper, but simpler: querySelector once on mount.
  useEffect(() => {
    recordCanvasRef.current = document.querySelector('canvas')
  }, [sceneId, facePatch])

  const handleFaceReady = (patch: FacePatch, img: HTMLImageElement) => {
    setFacePatch(patch)
    setSourceImage(img)
  }

  // Bridge CalibratePanel → SceneCanvas via a custom event so SceneCanvas's internal state can update
  const handleCalibrateChange = (next: Calibration) => {
    setCalibration(next)
    window.dispatchEvent(new CustomEvent('dance-calibrate', { detail: next }))
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
        {/* Left column: dropzone + scene picker + record */}
        <div className="lg:col-span-1 space-y-4">
          <section>
            <h2 className="text-xs uppercase tracking-widest text-gray-400 mb-2">
              1. upload
            </h2>
            <DropZone onFaceReady={handleFaceReady} />
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
              3. record
            </h2>
            <RecordButton canvasRef={recordCanvasRef} />
          </section>
        </div>

        {/* Right column: canvas + calibrate */}
        <div className="lg:col-span-2 space-y-4">
          <SceneCanvas
            sceneId={sceneId}
            facePatch={facePatch}
            sourceImage={sourceImage}
          />

          <CalibratePanel
            value={calibration}
            onChange={handleCalibrateChange}
          />

          <p className="text-xs text-gray-600 text-center lowercase">
            18+ only. by using this site you confirm you have rights to the uploaded face.
          </p>
        </div>
      </div>
    </main>
  )
}
