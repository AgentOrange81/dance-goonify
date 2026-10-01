import type { Scene } from '../scenes'

export type FrameMotion = {
  dx: number      // px translate x
  dy: number      // px translate y
  dRoll: number   // degrees
  dScale: number  // multiplicative scale, 1 = no scale
}

export function computeMotion(scene: Scene, tSeconds: number): FrameMotion {
  const m = scene.motion
  // Use sin() for smooth oscillation. Each axis can have a phase offset if you want
  // them to desync, but for v1 keep them in phase.
  const phase = tSeconds * 2 * Math.PI
  return {
    dx: m.swayX * Math.sin(phase * m.swayHz) + m.lean * Math.sin(phase * m.swayHz * 2) * 0.3,
    dy: m.bounceY * Math.abs(Math.sin(phase * m.bounceHz)),  // abs() so bounce is upward only
    dRoll: m.roll * Math.sin(phase * m.swayHz * 0.5),
    dScale: 1 + m.scalePulse * Math.sin(phase * m.swayHz),
  }
}