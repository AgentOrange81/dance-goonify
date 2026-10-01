'use client'

import { SCENES } from '@/lib/scenes'

export function ScenePicker({
  selectedId,
  onSelect,
}: {
  selectedId: string | null
  onSelect: (sceneId: string) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {SCENES.map((scene) => {
        const isSelected = scene.id === selectedId
        return (
          <button
            key={scene.id}
            onClick={() => onSelect(scene.id)}
            className={`
              text-left p-3 rounded-lg border transition-colors
              ${isSelected
                ? 'border-gold bg-teal-dim/40'
                : 'border-teal/30 bg-ink-800 hover:border-teal/60'}
            `}
          >
            <div className="text-sm text-gray-200 lowercase">{scene.title}</div>
          </button>
        )
      })}
    </div>
  )
}
