# dance.goonify.fun

Lap dance PFP compositor. Drop a headshot, your face becomes the dancer in a GTA-IV-feeling VIP club scene. Browser-side compositor, no generative AI per user, no server GPU.

## Stack

- Next.js 16 (TypeScript, pnpm)
- Tailwind (dark UI, gold + teal accents — matches goonify.fun)
- face-api.js for face detection (TinyFaceDetector + 5-pt landmarks)
- Native `<canvas>` 2D + `MediaRecorder` for the compositor + recording
- Cloudflare Pages for hosting, R2 for static assets

## Local dev

```bash
pnpm install
pnpm dev
# open http://localhost:3000
```

## Build & deploy

```bash
pnpm build
pnpm deploy  # wrangler pages deploy
```

## Architecture

```
app/page.tsx                    # landing + 18+ gate + dropzone
app/lapdance/page.tsx           # redirect to /
public/api/health.json          # static smoke endpoint (200 OK)
public/api/lapdance.json        # static 501 stub for Path B forward-compat
components/
  AgeGate.tsx                   # click-through 18+ modal
  DropZone.tsx                  # file → face crop
  ScenePicker.tsx               # 2-4 scene cards
  SceneCanvas.tsx               # the canvas, RAF loop
  CalibratePanel.tsx            # X/Y/rx/ry/roll sliders
  RecordButton.tsx              # record + download
lib/
  face/detector.ts              # face-api.js loader + fallback
  face/crop.ts                  # square crop + ellipse mask
  face/colorMatch.ts            # Reinhard color transfer
  canvas/drawScene.ts           # compositor
  canvas/motion.ts              # per-frame transforms
  canvas/record.ts              # MediaRecorder + fallback
  scenes.ts                     # Scene[] hardcoded
public/templates/
  scenes/*.webp                 # pre-rendered plates (H3-generated, ComfyUI-cleaned)
  models/                       # face-api.js weights
```

Path A is fully browser-side. The whole product runs in the user's browser — no server
computation. The `/api/lapdance` endpoint is a static JSON stub documenting what the
future Path B (GPU worker) would do, when/if we ever stand one up.

## Adding a new scene

1. Drop the plate asset into `public/templates/scenes/<id>.webp`
2. Add a Scene entry to `lib/scenes.ts`:
   - `dancer`, `background` paths
   - `dancerLayout` (px in 1280x720 canvas)
   - `faceHole` (normalized 0–1 of dancer)
   - `motion` params (swayHz ≈ 0.5 for slow GTA grind)
3. Done — no canvas code change needed

## Generating plates

See `/home/dirk/.hermes/profiles/glitch/plans/2026-10-01_120000-dance-goonify-spec.md` §8.

H3 budget cap: **$25**. Plates cost ~$0.48 each (768P × 6s).

## 18+ posture

Click-through gate. No card verification, no third-party age service. Legal exposure is on the operator — the TOS explicitly disclaims age verification.

## Abuse

Report to `abuse@dance.goonify.fun`. R2 lifecycle rule auto-purges `dance/*` after 7 days.
