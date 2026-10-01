// Minimal face-api.js type declarations for the subset we use.
// face-api.js does not ship .d.ts files; we declare just enough to catch API drift.

declare module 'face-api.js' {
  export interface Box {
    x: number
    y: number
    width: number
    height: number
  }

  export interface Point {
    x: number
    y: number
  }

  export interface TinyFaceDetectorOptions {
    inputSize?: number
    scoreThreshold?: number
  }

  export const TinyFaceDetectorOptions: new (opts?: TinyFaceDetectorOptions) => TinyFaceDetectorOptions

  export interface FaceLandmarks68 {
    positions: Point[]
  }

  export interface WithFaceLandmarks {
    withFaceLandmarks(this: unknown, useTinyModel?: boolean): Promise<Detection>
  }

  export interface WithFaceExpressions { /* unused */ }

  export interface Detection {
    detection: { box: Box; score: number }
    landmarks: FaceLandmarks68
  }

  export interface TinyFaceDetector {
    loadFromUri(uri: string): Promise<void>
  }

  export interface FaceLandmark68TinyNet {
    loadFromUri(uri: string): Promise<void>
  }

  export interface Nets {
    tinyFaceDetector: TinyFaceDetector
    faceLandmark68TinyNet: FaceLandmark68TinyNet
  }

  export const nets: Nets

  export function detectSingleFace(
    input: HTMLImageElement | HTMLCanvasElement | ImageData,
    options?: TinyFaceDetectorOptions
  ): WithFaceLandmarks
}
