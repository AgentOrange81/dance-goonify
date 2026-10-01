# Head tracking research — dance.goonify.fun

**Question:** Between "4 hand-measured keyframes, linear interp" and "60+ hand-measured
keyframes per scene", is there a tractable middle ground? And is rotation worth implementing?

**Working notes (live facts about the current code):**

- `Scene.track` is `FaceHoleKeyframe[]` (lib/scenes.ts:1-8) with `t, cx, cy, rx, ry, rotation`.
- `faceHoleAt(scene, t)` does pure linear interpolation between adjacent keyframes (lib/scenes.ts:63-87).
- `drawScene` ALREADY applies `ctx.rotate(rot)` and clips with a rotated ellipse (lib/canvas/drawScene.ts:29, 41-48). So rotation math is wired — the user's claim that rotation is "currently ignored" is slightly out of date; it's the rotation in the **keyframes** that's constant per scene (all -8° or all -25°), so it doesn't *move* per frame. The code path is exercised.
- Video is 1344×768 @ 24fps, ~158 frames per loop, rendered to 1280×720 canvas. Dancer head moves ~30 px vertically per loop.
- No OpenCV / tracking libs installed in node_modules. Only deps are next/react/tailwind/gif.js/wrangler.

---

## Part 1 — Tracking alternatives

### 1.1 Template matching (canvas-native cross-correlation) — RECOMMENDED for v1.5

Pick a small reference patch from frame 0 (the dancer's blank oval), then each frame
search a ~60×60 px window around the last-known position for the best normalized
cross-correlation. Update (cx, cy) per frame. Scale and rotation stay from keyframes
(interp), translation is live.

- **Browser support:** universal. Just `getImageData` + a JS inner loop. Optionally use
  a Web Worker + `OffscreenCanvas.transferToImageBitmap()` so it doesn't block render.
- **CPU cost/frame:** at 60×60 search, 30×30 search window → ~900k multiply-adds per
  frame = ~1-3 ms on a modern laptop. At 24fps target that's ~25-40% of one frame's
  budget — fine if the worker is on its own thread; tight on the main thread.
- **Accuracy:** sub-pixel via 3-point parabolic peak fit on the correlation surface.
  Easily handles ±30 px sway and matches typical H3 dancer motion (slow, smooth).
- **Code complexity:** ~150-200 LoC for a clean impl (worker + main-thread glue). The
  hot loop is the SAD/ncc inner product, written in typed-array JS — gets ~80% of C speed.

**Sketch (worker entry point, called once per video `requestVideoFrameCallback`):**

```ts
// tracking-worker.ts
type TrackState = { cx: number; cy: number; rx: number; ry: number; rot: number }
let template: Float32Array | null = null   // grayscale, size*N
let tw = 0, th = 0

self.onmessage = (e: MessageEvent) => {
  const { frame, prev, halfWin = 30 } = e.data as {
    frame: ImageData, prev: TrackState, halfWin?: number
  }
  if (!template) {
    // first call: extract template centered on prev (cx,cy)
    tw = prev.rx * 2 | 0; th = prev.ry * 2 | 0
    template = extractGray(frame, prev.cx - tw/2, prev.cy - th/2, tw, th)
    return
  }
  // search (prev.cx ± halfWin, prev.cy ± halfWin) for max NCC with template
  let best = -Infinity, bestX = prev.cx, bestY = prev.cy
  for (let dy = -halfWin; dy <= halfWin; dy += 1) {
    for (let dx = -halfWin; dx <= halfWin; dx += 1) {
      const patch = extractGray(frame, prev.cx + dx - tw/2, prev.cy + dy - th/2, tw, th)
      const ncc = normalizedCrossCorrelate(template, patch)
      if (ncc > best) { best = ncc; bestX = prev.cx + dx; bestY = prev.cy + dy }
    }
  }
  ;(self as any).postMessage({ cx: bestX, cy: bestY, score: best })
}
```

**Why this is the sweet spot for v1.5:** no AI, no extra deps, ~150 LoC, runs every frame
in a worker, hand-measured keyframes become a one-time *initial position* instead of a
per-frame interpolation. Drift is bounded (NCC fails → freeze on last good position).

**Caveats:**
- Lighting changes across the loop can hurt NCC. Use **normalized cross-correlation
  (zero-mean, divide by sqrt(var_a * var_b))** — robust to brightness offset, less so to
  multiplicative change. If you see drift, add a brightness-invariant variant (subtract
  patch mean, divide by patch stddev) or use **histogram-matching pre-filter**.
- The dancer's face oval is uniform grey/blurred in the H3 plates, so NCC may latch
  onto edges around the oval (hairline, neck). Trim the template to the inner 60% of the
  oval to avoid learning the oval *boundary* and instead learn the *inside* pattern.
- Frame-rate: should run on `requestVideoFrameCallback` (or `video.currentTime` polling
  at ~30Hz), NOT on every RAF — `<video>` plays at 24fps, and matching more often wastes
  CPU.

**Verdict:** Worth doing. Higher accuracy than 4 keyframes (any hand-measured cx/cy is
off by ±3-5 px because the eye can't see subpixel; NCC gives subpixel). Cheaper than
60+ keyframes (one-time initial frame + worker; no per-frame manual measurement).

---

### 1.2 Lucas-Kanade optical flow (sparse) — VIABLE, more code

Pick 8-16 good features to track (Shi-Tomasi corners) INSIDE the dancer's oval on frame 0.
Each subsequent frame, estimate each feature's new position via LK. Average the flow
vector → that's your head delta. Reproject onto (cx, cy).

- **Browser support:** universal. Either port OpenCV's `calcOpticalFlowPyrLK` to JS
  (~400 LoC, no deps) or use a tiny lib like `jsfeat` (~50KB) or `tracking.js`
  (deprecated, has LK). None are installed today.
- **CPU cost/frame:** ~0.5-1 ms for 16 features at single pyramid level.
- **Accuracy:** subpixel. Handles rotation/scale partially if you use image pyramid
  (default in OpenCV impl).
- **Code complexity:** ~400 LoC if porting from scratch; ~80 LoC with `jsfeat`. Adds a
  dependency.

**Sketch (jsfeat, illustrative only):**

```ts
import jsfeat from 'jsfeat'
// once, on frame 0:
const corners = []
jsfeat.fastCorners(gray, corners, threshold = 20)
const pts = corners.filter(c => isInsideOval(c.x, c.y, oval))  // keep only inside-face

// each frame:
jsfeat.optical_flow_lk(grayPrev, grayCurr, winSize=15, ptsPrev, ptsCurr)
// median(ptsCurr[i] - ptsPrev[i]) → delta. Apply to (cx, cy).
```

**Verdict:** Marginal improvement over template matching for our case. Dancer moves
slowly (~30 px / 6s = 5 px/s), so LK's small-displacement assumption is fine, but you
also have to **select good features inside the face** every loop — and the H3 plates'
faces are smooth and featureless inside the oval (which is why we have a blank oval to
begin with). LK gives you motion vectors on the hairline / neck edge, not on the face
interior, so you end up averaging hair movement, not head movement. **Template matching
is better here.**

---

### 1.3 Color segmentation — REJECT

Already tried (per the task description). Lighting on the dancer's neck/shoulders varies
across the loop; the skin-tone mask bleeds. Plus the user's face patch covers the
dancer's skin entirely, so segmenting dancer-skin is purely for tracking — when lighting
shifts the patch edges stop matching the oval and tracking falls apart.

**Verdict:** Don't.

---

### 1.4 Pre-baked dense keyframes (e.g., one per frame, 158 keyframes) — ACCURATE BUT EXPENSIVE

Measure all 158 frames by hand or via offline tool (CV-Python `cv2.matchTemplate` on a
H3-rendered plate pre-export). Bake to JSON.

- **Browser support:** trivial — just index into the array.
- **CPU cost/frame:** zero (binary search by `t`, 2-3 lerps).
- **Accuracy:** pixel-perfect (no jitter) IF measured precisely. Hand measurement has
  ±3-5 px noise per keyframe, so dense hand measurement *worsens* jitter (interp
  between two noisy points averages it out; raw nearest-frame picks the noise directly).
  Dense *automated* measurement is great; dense *manual* measurement is worse than 4-8
  well-placed keyframes.
- **Code complexity:** zero new code; 10× more keyframes. But the build pipeline needs a
  tool that walks the video and emits keyframes — that's a Python OpenCV script, ~80 LoC
  *if you build it offline* (not in-browser). Bake as JSON next to the .webm.

**Verdict:** Right answer for v2 if a Goonify team member spends an hour writing the
Python measurement tool. Beats in-browser template matching on accuracy; loses on
flexibility (can't react to new scenes without re-running the tool). For v1, template
matching is the better trade.

---

### 1.5 OpenCV.js — REJECT for this use case

`opencv.js` is ~8 MB loaded WASM. Has `matchTemplate`, `calcOpticalFlowPyrLK`,
`TrackerCSRT`, etc.

- **Browser support:** universal (WASM).
- **CPU cost/frame:** `matchTemplate` ~3-8 ms; `TrackerCSRT` ~5-15 ms. Both borderline
  for 24fps on the main thread; fine in a worker.
- **Accuracy:** excellent.
- **Code complexity:** ~80 LoC glue + 8 MB download. **Loading 8 MB to track 30 px of
  head bob is wildly disproportionate.**

**Verdict:** Don't. Only worth it if you also wanted to do face landmark detection,
background subtraction, etc. Pure overhead for this single use case.

---

## Recommended v1 upgrade path

1. **Now (no code change):** add 2-4 more keyframes per scene (8 total) at the points
   where linear interp is worst. Hand-measure those 2-4 additional frames. ~10 min of
   work, ~30% improvement on visible drift.
2. **v1.1 (in-browser template matching worker):** add `lib/tracking/templateMatch.ts`
   + a Web Worker. Initial position comes from `faceHoleAt(scene, 0)`, worker tracks from
   there. ~150-200 LoC. Falls back gracefully to keyframe interp if the worker fails to
   initialize (Safari ITP, private mode). Worth doing as soon as you have time.
3. **v2 (offline dense keyframe extraction):** Python `cv2.matchTemplate` script that
   walks every frame of the .webm, emits JSON. Bake into the static asset. ~80 LoC
   Python + a Cloudflare Pages build hook. Best accuracy, no runtime cost.

---

## Part 2 — Rotation: keep `rotation = 0` and just translate + scale

**Current drawScene already applies rotation** (lib/canvas/drawScene.ts:29, 41-48):

```ts
ctx.beginPath()
ctx.ellipse(fh.cx, fh.cy, fh.rx, fh.ry, rot, 0, Math.PI * 2)  // rotated clip
ctx.clip()
ctx.translate(fh.cx, fh.cy)
ctx.rotate(rot)                                                // rotated face patch
ctx.drawImage(facePatch, ...)
```

So the math is already there. The question is: should the keyframes carry per-frame
rotation, or is one constant rotation per scene fine?

**For head-bobbing (the front-grind and side-grind plates):** the dancer's head rotates
less than ±3° during the loop. That's below visible threshold for a face patch — the
eye can't detect a 3° rotation error on an oval that's already at -8°/-25°.

**Concrete answer:** keep `rotation` as a constant per scene (one value, same on all
keyframes — exactly what `lib/scenes.ts:37-53` does today). Don't try to track per-frame
head roll. Translation + scale is enough.

**What you lose by ignoring rotation:** the head *appears* to be glued straight up
even when the dancer tilts 3° during the bob. For ~30 px vertical bob on a 130 px tall
head, the tilt is geometrically ~2-3°. Visually imperceptible.

**What you lose by *not rotating the clip oval* (i.e., if you dropped the `ctx.rotate`
in drawScene and used an axis-aligned ellipse):** the oval clip wouldn't match the
rotated dancer's face boundary; you'd see hard edges where the clip cuts across the
face. Big visible artifact. **You must keep the rotation in the clip.**

**The math for "rotated face patch in a rotated clip oval"** is what `drawScene.ts` already
does. To restate it explicitly:

```
Let rot = fh.rotation * π / 180     // radians
Let sx, sy = scale ratios (patch oval → dancer oval), finalScale = min(sx, sy) * tightness

To composite:
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(fh.cx, fh.cy, fh.rx, fh.ry, rot, 0, 2π)   // 1. clip to rotated oval
  ctx.clip()
  ctx.translate(fh.cx, fh.cy)                           // 2. move origin to face center
  ctx.rotate(rot)                                       // 3. rotate patch to match tilt
  ctx.drawImage(patch, -w/2, -h/2, w, h)                // 4. draw centered
  ctx.restore()
```

The order matters: **clip first (in world space, using the rotated oval), then transform
the patch into the rotated frame, then draw.** Reversing 1↔2 leaves the clip in world
space but the patch already translated; reversing 3↔4 draws the patch rotated around
its own corner instead of the face center (visible shear).

**When you WOULD want per-frame rotation:** if a future scene has a dancer doing head
roll (e.g., a head-wave motion), add `rotation` to each keyframe and let `faceHoleAt`
lerp it as it already does. Zero code change — the data type already supports it.

---

## TL;DR

1. **Tracking:** template matching (canvas-native NCC in a worker) is the sweet spot.
   ~150 LoC, sub-pixel accuracy, no deps, runs at 24fps. Use `requestVideoFrameCallback`,
   not RAF. Pre-bake dense keyframes offline as the v2 plan.
2. **Rotation:** keep one constant rotation per scene. `drawScene.ts` already rotates
   the clip oval AND the patch (lines 29, 43, 46). For head-bobbing, per-frame rotation
   is sub-perceptible (<3°). Don't add roll tracking unless a future scene has it.
3. **Right now, cheapest win:** add 4 more hand-measured keyframes per scene → 8 total.
   Captures the bob inflection points that linear interp misses. ~10 min of work.
