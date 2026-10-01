'use client'

type Calibration = { dx: number; dy: number; rxMul: number; ryMul: number; rotation: number }

export function CalibratePanel({
  value,
  onChange,
}: {
  value: Calibration
  onChange: (next: Calibration) => void
}) {
  const update = (key: keyof Calibration, delta: number) => {
    onChange({ ...value, [key]: value[key] + delta })
  }

  const reset = () => {
    onChange({ dx: 0, dy: 0, rxMul: 1, ryMul: 1, rotation: 0 })
  }

  return (
    <div className="bg-ink-800 border border-teal/20 rounded-lg p-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-xs uppercase tracking-widest text-gray-400">
          calibrate hole
        </h3>
        <button
          onClick={reset}
          className="text-xs text-gray-500 hover:text-gold lowercase transition-colors"
        >
          reset
        </button>
      </div>

      <SliderRow label="x" value={value.dx} min={-80} max={80} step={1} onChange={(v) => onChange({ ...value, dx: v })} />
      <SliderRow label="y" value={value.dy} min={-80} max={80} step={1} onChange={(v) => onChange({ ...value, dy: v })} />
      <SliderRow label="rx" value={value.rxMul} min={0.5} max={1.5} step={0.01} onChange={(v) => onChange({ ...value, rxMul: v })} />
      <SliderRow label="ry" value={value.ryMul} min={0.5} max={1.5} step={0.01} onChange={(v) => onChange({ ...value, ryMul: v })} />
      <SliderRow label="roll" value={value.rotation} min={-45} max={45} step={1} onChange={(v) => onChange({ ...value, rotation: v })} />
    </div>
  )
}

function SliderRow({
  label, value, min, max, step, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-3 mb-2">
      <span className="w-8 text-xs text-gray-500 lowercase">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 accent-teal-glow"
      />
      <span className="w-12 text-xs text-gray-400 text-right tabular-nums">
        {typeof value === 'number' ? value.toFixed(step < 1 ? 2 : 0) : ''}
      </span>
    </div>
  )
}
