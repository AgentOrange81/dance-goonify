# dance.goonify.fun

Lap dance PFP compositor. Drop a headshot, your face becomes the dancer in a GTA-IV-feeling VIP club scene. Browser-side compositor, no generative AI per user, no server GPU.

Live at **https://dance.goonify.fun**

## Stack

- Next.js 16 (TypeScript, pnpm)
- Tailwind (dark UI, gold + teal accents — matches goonify.fun)
- User-drawn oval face picker (no face detection — user marks the face)
- Native `<canvas>` 2D + `MediaRecorder` for the compositor + recording
- Pre-rendered H3 dancer plates (no per-user generative AI)
- Cloudflare Pages for hosting, custom domain via CNAME

## Local dev

```bash
pnpm install
pnpm dev
# open http://localhost:3000
```

## Build & deploy

```bash
pnpm build
npx wrangler pages deploy out --project-name dance-goonify --branch main
```

Wrangler config is in `wrangler.toml`. Custom domain `dance.goonify.fun` requires a CNAME record pointing to `dance-goonify.pages.dev` (Cloudflare proxy enabled).

## Files

```
app/page.tsx                    # landing + 18+ gate + dropzone + record
app/lapdance/page.tsx           # alternate full editor route
app/api/health/route.ts         # smoke endpoint (200 OK)
app/api/lapdance/route.ts       # Path B stub (501, forward-compat for GPU worker)
components/
  AgeGate.tsx                   # click-through 18+ modal
  FacePicker.tsx                # draggable/resizable oval on user photo
  ScenePicker.tsx               # 2 scene cards
  SceneCanvas.tsx               # the canvas, RAF loop, face patch composite
  RecordButton.tsx              # record + download webm/mp4
lib/
  face/crop.ts                  # extract oval region, masked with smoothstep alpha
  canvas/drawScene.ts           # compositor (video + oval clip + edge blend)
  canvas/record.ts              # MediaRecorder wrapper, MIME probe for Safari
  scenes.ts                     # Scene[] with keyframe tracks
public/templates/
  scenes/dancer-front-grind.webm   # H3-generated front plate (ping-pong loop)
  scenes/dancer-side-grind.webm    # H3-generated 3/4-angle plate
  scenes/club-room-empty.webp      # static bg plate (legacy)
docs/
  research/                         # sub-agent research artifacts (head tracking, compositing)
```

## How it works

1. User picks a face from a photo by dragging/resizing an oval over it
2. `cropOval` extracts the oval-shaped region with a smoothstep alpha feather
3. The H3-generated dancer plate (a ping-pong webm where frame_001 == frame_N, so the loop wraps invisibly) plays on a hidden `<video>` element
4. Each RAF tick:
   - Draw the current video frame to the canvas
   - Sample the destination's average chroma at the oval center
   - Clip to the rotated oval (cx, cy, rx, ry, rotation from `faceHoleAt(scene, t)`)
   - Draw the face patch inside the clip (alpha feathered by the user's oval)
   - Add a soft decontamination ring biased toward the destination chroma
5. MediaRecorder captures the canvas stream; user downloads webm (or mp4 on Safari)

## The H3 generation pipeline

See `docs/research/` for the sub-agent outputs that drove the final prompt engineering.

Each scene went through 3 H3 generations; we picked the one with the smallest first-vs-last frame pixel diff (lower = smoother loop):

| Variant | Wrap diff | Notes |
|----------|----------|-------|
| front_v1 | 20.50    | rejected |
| front_v2 | 8.46     | shipped |
| front_v3 | 14.81    | rejected |
| side_v1  | 10.24    | rejected |
| side_v2  | 9.88     | rejected |
| side_v3  | 2.29     | shipped |

Cost: $2.88 of $15 budget cap.

## Adding a new scene

1. Generate a 6s clip with H3 (`MiniMax-H3`, 768P, 16:9). Loop-prompts like "the dancer must return to the EXACT starting pose" help.
2. Pick 3, measure wrap diff (first vs last frame pixel diff), keep the smallest.
3. ffmpeg → webm: `ffmpeg -i input.mp4 -c:v libvpx-vp9 -crf 36 -pix_fmt yuv420p output.webm`
4. (Optional) Build a ping-pong: forward then reverse, so wrap is invisible regardless of source.
5. Add Scene entry to `lib/scenes.ts` with the keyframe track (cx, cy, rx, ry for the face oval at 7 evenly-spaced t values).

## 18+ posture

Click-through gate (`components/AgeGate.tsx`). No card verification, no third-party age service. Legal exposure is on the operator. The age gate stores a boolean in `localStorage` after confirmation; modal never returns unless cleared.

## License

Personal project. Not for redistribution.