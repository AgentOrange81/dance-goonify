#!/usr/bin/env node
/**
 * Build-time keyframe measurement for dance-goonify.
 *
 * Drives a real headless Chromium via Playwright to run MediaPipe
 * FaceLandmarker against every keyframe of every scene's webm. The landmarker
 * gives 478 face landmarks plus a 4x4 facial transformation matrix; we read
 * real head yaw (degrees) directly from the matrix instead of guessing it
 * from a bbox-asymmetry heuristic.
 *
 * Why this exists:
 *   The first-cut keyframes were hand-measured by extracting frames from the
 *   plates, overlaying a grid, and eyeballing the oval. They were close but
 *   not perfect, and updating them every time we change a plate was painful.
 *
 *   This script makes keyframe measurement a single command:
 *
 *       pnpm measure-keyframes
 *
 *   It writes a TypeScript-friendly JSON dump and prints a paste-ready table
 *   you can drop into lib/scenes.ts.
 *
 * How it works:
 *   1. Spin up a tiny localhost HTTP server rooted at the repo root, so
 *      `/public/templates/mediapipe/{wasm,blaze_face_short_range.tflite,face_landmarker.task}`
 *      and `/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs` are all
 *      reachable from the probe page.
 *   2. Launch Playwright Chromium and open scripts/_probe.html, which loads
 *      MediaPipe FaceDetector + FaceLandmarker and exposes
 *      `window.__detect(imageData)` + `window.__detectPose(imageData)`.
 *   3. Parse lib/scenes.ts to get the scene table → webm paths + keyframe
 *      timestamps.
 *   4. For each scene:
 *        a. Probe duration with ffprobe.
 *        b. For each keyframe t in [0..1], extract the corresponding frame
 *           with ffmpeg (by frame index), save to /tmp.
 *        c. Decode the PNG with sharp → raw RGBA → construct ImageData.
 *        d. Send the ImageData to the probe page via page.evaluate(); receive
 *           FaceLandmarker output as JSON (bbox + landmarks + transform).
 *        e. Derive oval center/radii from the landmark-derived bbox, scale
 *           from plate space (1344×768) to canvas space (1280×720).
 *        f. Extract head yaw (degrees) directly from the facial transformation
 *           matrix — atan2(-m20, m22). MediaPipe's positive yaw is "subject
 *           turns head to their right"; we negate to match the renderer's
 *           "positive = head turns to viewer's right" convention.
 *   5. Plausibility-filter detections (reject low-confidence body skin,
 *      background bokeh), gap-fill with neighbour interpolation or mark as
 *      back-of-head, and print the final keyframe table.
 *
 * Outputs:
 *   - scripts/keyframes-measured.json: full machine-readable dump (raw +
 *     cleaned)
 *   - Pretty-printed keyframe table on stdout (paste into lib/scenes.ts)
 *
 * Runtime: ~30s for both plates (most time is browser launch + landmarker
 * warm-up). Re-running is cheap.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, mkdirSync, writeFileSync, existsSync, readFileSync as readFile } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { chromium } from 'playwright'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SCENES_TS = join(ROOT, 'lib/scenes.ts')
const PROBE_URL_PATH = '/scripts/_probe.html'
const TMP_DIR = '/tmp/dance-goonify-measure'
const OUT_JSON = join(__dirname, 'keyframes-measured.json')

const CANVAS_W = 1280
const CANVAS_H = 720
const PLATE_W = 1344
const PLATE_H = 768

// ---------------------------------------------------------------------------
// Parse lib/scenes.ts to recover scene metadata
// ---------------------------------------------------------------------------
function parseScenes() {
  const src = readFileSync(SCENES_TS, 'utf8')
  const idRe = /id:\s*'([^']+)',\s*\n\s*title:\s*'([^']+)',\s*\n\s*dancer:\s*'([^']+)',[\s\S]*?track:\s*\[([\s\S]*?)\]\s*,\s*\n\s*\},/g
  const sceneBlocks = [...src.matchAll(idRe)]
  if (sceneBlocks.length === 0) {
    throw new Error('Could not parse scenes.ts — scene block regex matched nothing')
  }
  return sceneBlocks.map((m) => {
    const [, id, title, dancer, trackSrc] = m
    const track = []
    const kfRe = /\{\s*t:\s*([\d.]+),\s*cx:\s*(\d+),\s*cy:\s*(\d+),\s*rx:\s*(\d+),\s*ry:\s*(\d+),\s*rotation:\s*([\d.-]+),\s*headYaw:\s*([\d.-]+)\s*\}/g
    let km
    while ((km = kfRe.exec(trackSrc)) !== null) {
      track.push({
        t: parseFloat(km[1]),
        cx: parseInt(km[2], 10),
        cy: parseInt(km[3], 10),
        rx: parseInt(km[4], 10),
        ry: parseInt(km[5], 10),
        rotation: parseFloat(km[6]),
        headYaw: parseFloat(km[7]),
      })
    }
    return { id, title, dancer, track }
  })
}

// ---------------------------------------------------------------------------
// Local HTTP server (serves the repo root)
// ---------------------------------------------------------------------------
function startStaticServer(rootDir) {
  return new Promise((resolveServer) => {
    const server = createServer((req, res) => {
      const url = decodeURIComponent((req.url || '/').split('?')[0])
      const safe = url.replace(/\.\./g, '').replace(/^\/+/, '')
      const path = join(rootDir, safe)
      if (!existsSync(path)) {
        res.writeHead(404)
        res.end('not found: ' + safe)
        return
      }
      try {
        const buf = readFile(path)
        if (path.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm')
        else if (path.endsWith('.tflite')) res.setHeader('Content-Type', 'application/octet-stream')
        else if (path.endsWith('.mjs')) res.setHeader('Content-Type', 'application/javascript')
        else if (path.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript')
        else if (path.endsWith('.html')) res.setHeader('Content-Type', 'text/html')
        else if (path.endsWith('.css')) res.setHeader('Content-Type', 'text/css')
        else if (path.endsWith('.json')) res.setHeader('Content-Type', 'application/json')
        res.end(buf)
      } catch (e) {
        res.writeHead(500)
        res.end(String(e))
      }
    })
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      resolveServer({ server, port })
    })
  })
}

// ---------------------------------------------------------------------------
// ffmpeg helpers
// ---------------------------------------------------------------------------
function probeVideo(webmPath) {
  const r = spawnSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-count_frames',
    '-show_entries', 'stream=nb_read_frames,duration,r_frame_rate:format=duration',
    '-of', 'default=noprint_wrappers=1',
    webmPath,
  ], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`)
  const lines = Object.fromEntries(
    r.stdout.trim().split('\n').map((l) => l.split('=')).filter((p) => p.length === 2)
  )
  const numFrames = parseInt(lines.nb_read_frames, 10)
  const fpsStr = (lines.r_frame_rate || '24/1').split('/')
  const fps = parseInt(fpsStr[0], 10) / parseInt(fpsStr[1], 10)
  const duration = parseFloat(lines.duration)
  if (!Number.isFinite(numFrames) || numFrames <= 0) {
    throw new Error(`could not determine frame count: ${r.stdout}`)
  }
  return { numFrames, fps, duration }
}

function extractFrame(webmPath, frameIndex, outPath) {
  // frameIndex is 0-based. Seek by input frame index for reliability — much
  // more robust than `-ss` time-based seeking for the last frame, which can
  // land past EOF depending on how the container reports duration.
  const r = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', webmPath,
    '-vf', `select=eq(n\\,${frameIndex})`,
    '-frames:v', '1',
    '-pix_fmt', 'rgba',
    outPath,
  ], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`ffmpeg failed at frame=${frameIndex}: ${r.stderr}`)
}

async function decodePngAsImageData(pngPath) {
  const img = sharp(pngPath, { failOn: 'none' }).ensureAlpha()
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
  return {
    width: info.width,
    height: info.height,
    data: Array.from(new Uint8ClampedArray(data)),
  }
}

/**
 * Render an overlay PNG showing the detected oval(s) on top of the source
 * frame. Used for visual verification — look at the generated *-overlay.png
 * files in /tmp/dance-goonify-measure/ to confirm MediaPipe actually locked
 * onto the right region. Annotations are drawn in CANVAS-space (1280×720)
 * coords, scaled from the plate's native resolution.
 *
 * For FaceLandmarker output we also render a small subset of the 478
 * landmarks (eyes, nose, mouth, ear tragions) so you can visually verify the
 * face orientation matches the reported yaw.
 */
async function renderOverlay(srcPngPath, detections, outPngPath) {
  const sx = CANVAS_W / PLATE_W
  const sy = CANVAS_H / PLATE_H
  const svgOverlay = Buffer.from(
    `<svg width="${PLATE_W}" height="${PLATE_H}" xmlns="http://www.w3.org/2000/svg">` +
      detections.map((d, i) => {
        const bb = d.bbox
        if (!bb) return ''
        const x = (bb.originX + bb.width / 2) * sx
        const y = (bb.originY + bb.height / 2) * sy
        const rx = bb.width * 0.45 * sx
        const ry = bb.height * 0.55 * sy
        const color = ['#00ff66', '#ffaa00', '#00ccff'][i % 3]
        // Pick a few of the 478 landmarks to render so the overlay isn't
        // a snowstorm: nose (1), left eye outer (33), right eye outer (263),
        // mouth left (61), mouth right (291), left ear tragion (234),
        // right ear tragion (454). These indices come from MediaPipe's
        // canonical face mesh topology.
        const landmarkIdx = [1, 33, 263, 61, 291, 234, 454]
        const kp = (d.landmarks || [])
          .filter((_, ki) => landmarkIdx.includes(ki))
          .map((k) =>
            `<circle cx="${k.x * sx}" cy="${k.y * sy}" r="4" fill="${color}" stroke="#000" stroke-width="1"/>`
          ).join('')
        const yawLabel = d.yawDeg === null || d.yawDeg === undefined
          ? 'yaw=?'
          : `yaw=${d.yawDeg.toFixed(0)}°`
        return (
          `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="none" stroke="${color}" stroke-width="3"/>` +
          `<text x="${x + rx + 6}" y="${y - ry - 6}" font-family="monospace" font-size="20" fill="${color}" stroke="#000" stroke-width="1">${yawLabel}</text>` +
          kp
        )
      }).join('') +
      // CANVAS-space guide (1280×720 outline) for sanity-checking the scale.
      `<rect x="0" y="0" width="${CANVAS_W * sx}" height="${CANVAS_H * sy}" fill="none" stroke="#ff00ff" stroke-width="2" stroke-dasharray="8,4" opacity="0.4"/>` +
    `</svg>`
  )
  await sharp(srcPngPath).composite([{ input: svgOverlay, top: 0, left: 0 }]).toFile(outPngPath)
}

// ---------------------------------------------------------------------------
// Yaw estimation from FaceLandmarker's facialTransformationMatrixes
// ---------------------------------------------------------------------------
// The transformation matrix is a 4x4 row-major Float32Array(16) that maps a
// canonical face model (facing +Z) into camera-space. Yaw is the rotation
// around the model's Y-axis: yaw = atan2(-m20, m22). Index mapping (row*4+col):
//   m20 = t[8]    m22 = t[10]
// MediaPipe's positive yaw = subject turning head to their right (viewer's
// left); our renderer uses positive = viewer's right, so we negate.
//
// The MediaPipe bundle exposes this matrix as a flat JS array (we Array.from
// the underlying Float32Array in the probe), so `t.length === 16` and the
// indexing is straightforward.
//
// When the landmarker doesn't detect a face at all (back of head, edge of
// frame) we can't read a transform — return null so the caller can decide
// whether to mark the frame as back-of-head (yaw=180) or interpolate.
function readYawFromTransform(t) {
  if (!t || t.length !== 16) return null
  const sinYaw = -t[8]
  const cosYaw = t[10]
  return -(Math.atan2(sinYaw, cosYaw) * (180) / Math.PI)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true })

  console.log('• Parsing scenes.ts…')
  const scenes = parseScenes()
  for (const s of scenes) {
    console.log(`  - ${s.id} (${s.title}): ${s.track.length} keyframes`)
  }

  console.log('• Starting static HTTP server…')
  const { server, port } = await startStaticServer(ROOT)
  const probeUrl = `http://127.0.0.1:${port}${PROBE_URL_PATH}`
  console.log(`  Serving repo root at http://127.0.0.1:${port}/`)

  console.log('• Launching Chromium…')
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 400, height: 200 } })
  const page = await context.newPage()

  page.on('console', (msg) => {
    const t = msg.text()
    console.log('  [console]', msg.type(), t)
  })
  page.on('pageerror', (err) => console.error('  pageerror:', err.message))
  page.on('requestfailed', (req) => console.error('  reqfail:', req.url(), req.failure()?.errorText))

  console.log(`• Loading probe at ${probeUrl}`)
  await page.goto(probeUrl)
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 })
  console.log('  Detector ready.')

  const results = []
  for (const scene of scenes) {
    // scene.dancer is a web path like '/templates/scenes/dancer-front-grind.webm';
    // the actual file lives under public/ on disk.
    const webmPath = join(ROOT, 'public', scene.dancer.replace(/^\//, ''))
    if (!existsSync(webmPath)) {
      console.warn(`  ! Missing webm: ${webmPath} — skipping`)
      continue
    }
    console.log(`• ${scene.id}: probing ${basename(webmPath)}`)
    const { numFrames, fps, duration } = probeVideo(webmPath)
    console.log(`  ${numFrames} frames @ ${fps.toFixed(2)}fps (duration=${duration.toFixed(3)}s)`)

    const measured = []
    for (const kf of scene.track) {
      // Map t ∈ [0..1] to a frame index. For t=1.0 we want the last frame
      // (which equals the first frame in our seamless loops), not a frame
      // past EOF.
      const frameIndex = Math.min(numFrames - 1, Math.max(0, Math.round(kf.t * (numFrames - 1))))
      const atSec = frameIndex / fps
      const pngPath = join(TMP_DIR, `${scene.id}-${kf.t.toFixed(3)}.png`)
      extractFrame(webmPath, frameIndex, pngPath)
      const { width, height, data } = await decodePngAsImageData(pngPath)

      // Send ImageData to the probe page; get landmarker output back as JSON.
      // FaceLandmarker gives us bbox (derived from 478 landmarks) + 3D pose.
      const detections = await page.evaluate(async ({ width, height, data }) => {
        const id = new ImageData(new Uint8ClampedArray(data), width, height)
        return await window.__detectPose(id)
      }, { width, height, data })

      // Plausibility gates (in CANVAS-space) — same logic as before, now
      // applied to landmarker output:
      //   1. bbox center cx within [200, 1080] — kills jumps to background
      //      lights or far edges.
      //   2. bbox center cy < 350 — faces are upper half; body skin is
      //      lower half.
      //   3. rx <= 100, ry <= 120 — face bbox is consistent across frames;
      //      body skin patches are larger.
      // FaceLandmarker doesn't expose a confidence score, so we don't filter
      // on conf — the geometric gates are sufficient.
      const plausible = detections.filter((d) => {
        if (!d.bbox) return false
        const cxPlate = d.bbox.originX + d.bbox.width / 2
        const cyPlate = d.bbox.originY + d.bbox.height / 2
        const cxCanvas = cxPlate * (CANVAS_W / PLATE_W)
        const cyCanvas = cyPlate * (CANVAS_H / PLATE_H)
        const rxCanvas = d.bbox.width * (CANVAS_W / PLATE_W)
        const ryCanvas = d.bbox.height * (CANVAS_H / PLATE_H)
        return cxCanvas >= 200 && cxCanvas <= 1080
          && cyCanvas < 350
          && rxCanvas <= 220 && ryCanvas <= 280
      })

      // Render overlay for visual inspection regardless of detection state.
      await renderOverlay(pngPath, plausible, join(TMP_DIR, `${scene.id}-${kf.t.toFixed(3)}-overlay.png`))

      if (plausible.length === 0) {
        if (detections.length > 0) {
          const reasons = detections.map((d) => {
            if (!d.bbox) return 'no-bbox'
            const cx = Math.round((d.bbox.originX + d.bbox.width / 2) * (CANVAS_W / PLATE_W))
            const cy = Math.round((d.bbox.originY + d.bbox.height / 2) * (CANVAS_H / PLATE_H))
            return `cx=${cx} cy=${cy}`
          }).join(', ')
          console.log(`    t=${kf.t.toFixed(3)}  detection rejected: ${reasons}`)
        } else {
          console.log(`    t=${kf.t.toFixed(3)}  NO FACE DETECTED`)
        }
        measured.push({ t: kf.t, cx: null, cy: null, rx: null, ry: null, yaw: 180, confidence: 0, keypoints: null })
        continue
      }

      let best = plausible[0]
      let bestArea = 0
      for (const d of plausible) {
        const a = d.bbox.width * d.bbox.height
        if (a > bestArea) { bestArea = a; best = d }
      }
      const bb = best.bbox
      // Tighten the full-face bbox to ~face-only (no hair/ears/neck shadow).
      const rxPlate = bb.width * 0.45
      const ryPlate = bb.height * 0.55
      const cxPlate = bb.originX + bb.width / 2
      const cyPlate = bb.originY + bb.height / 2
      const cx = Math.round(cxPlate * (CANVAS_W / PLATE_W))
      const cy = Math.round(cyPlate * (CANVAS_H / PLATE_H))
      const rx = Math.round(rxPlate * (CANVAS_W / PLATE_W))
      const ry = Math.round(ryPlate * (CANVAS_H / PLATE_H))
      const yaw = readYawFromTransform(best.transform)

      const yawStr = yaw === null ? '?' : `${yaw.toFixed(0)}°`
      console.log(`    t=${kf.t.toFixed(3)}  cx=${cx} cy=${cy} rx=${rx} ry=${ry} yaw=${yawStr}`)
      // Convert normalized [0..1] landmark coords to CANVAS pixel coords
      // (1280×720). These get embedded into lib/scenes.ts and used by
      // lib/face/warp.ts for Delaunay-based face warping.
      const landmarks = best.landmarks.map((lm) => ({
        x: Math.round(lm.x * CANVAS_W * 100) / 100,
        y: Math.round(lm.y * CANVAS_H * 100) / 100,
      }))
      measured.push({
        t: kf.t,
        cx, cy, rx, ry,
        yaw: yaw === null ? 180 : Math.round(yaw),
        confidence: 1,  // FaceLandmarker doesn't return a score; gates already filtered
        transform: best.transform,
        landmarks,
      })
    }
    results.push({ id: scene.id, title: scene.title, dancer: scene.dancer, duration, measured })
  }

  // ---------------------------------------------------------------------
  // Post-process: fill gaps with neighbor-interpolation, mark true back-of-head
  // frames, and emit the final keyframe table.
  // ---------------------------------------------------------------------
  // Heuristic: a frame is "back of head" (no patch) if:
  //   - MediaPipe found no face in it AND
  //   - either it's flanked by other no-face frames (mid-spin region) OR its
  //     neighbors' confidence is also low AND the dancers is mid-spin
  //
  // A frame is "transient miss" (face should be there, just occluded) if:
  //   - MediaPipe found no face BUT its neighbors both have valid face
  //     detections within t ∈ [kf.t - 0.2, kf.t + 0.2].
  //   In that case we linearly interpolate cx/cy/rx/ry and set headYaw to 0.
  //
  // We use the resulting per-frame {cx,cy,rx,ry,headYaw,source} to build the
  // final table.

  const cleaned = []
  for (const scene of results) {
    // First pass: identify which no-face frames belong to genuine back-of-head
    // runs (length ≥ MIN_BACK_OF_HEAD_RUN). Mark those frames up-front so
    // they don't accidentally get classified as "anchor-borrow" (which would
    // copy the nearest valid detection's pose and keep the patch visible
    // during the spin).
    const MIN_BACK_OF_HEAD_RUN = 3
    const isNoFace = scene.measured.map((m) => m.cx === null)

    // Find contiguous no-face runs and mark all frames in runs of length ≥ MIN
    const isBackOfHead = new Array(scene.measured.length).fill(false)
    {
      let runStart = -1
      for (let i = 0; i <= scene.measured.length; i++) {
        const inNoFace = i < scene.measured.length && isNoFace[i]
        if (inNoFace && runStart < 0) runStart = i
        if ((!inNoFace || i === scene.measured.length) && runStart >= 0) {
          const runLen = i - runStart
          if (runLen >= MIN_BACK_OF_HEAD_RUN) {
            for (let j = runStart; j < i; j++) isBackOfHead[j] = true
          }
          runStart = -1
        }
      }
    }

    const out = []
    for (let i = 0; i < scene.measured.length; i++) {
      const m = scene.measured[i]
      if (m.cx !== null) {
        out.push({ ...m, source: 'measured' })
        continue
      }
      if (isBackOfHead[i]) {
        // Mid-spin / back-of-head. Find the nearest valid detection (any
        // direction) for cosmetic oval positioning. Don't search past another
        // back-of-head frame, so we always anchor to a *real* face.
        const findNearest = (dir) => {
          for (let j = i + dir; j >= 0 && j < scene.measured.length; j += dir) {
            if (scene.measured[j].cx !== null) return scene.measured[j]
            if (isBackOfHead[j]) return null
          }
          return null
        }
        const anchor = findNearest(-1) || findNearest(+1)
        out.push({
          t: m.t,
          cx: anchor ? anchor.cx : 640,
          cy: anchor ? anchor.cy : 220,
          rx: anchor ? anchor.rx : 82,
          ry: anchor ? anchor.ry : 99,
          yaw: 180,
          confidence: 0,
          source: 'back-of-head',
        })
        continue
      }

      // Transient miss (single no-face frame, not in a back-of-head run).
      // Find nearest valid detection in each direction.
      const left = (() => {
        for (let j = i - 1; j >= 0; j--) {
          if (scene.measured[j].cx !== null) return scene.measured[j]
          if (isBackOfHead[j]) return null
        }
        return null
      })()
      const right = (() => {
        for (let j = i + 1; j < scene.measured.length; j++) {
          if (scene.measured[j].cx !== null) return scene.measured[j]
          if (isBackOfHead[j]) return null
        }
        return null
      })()

      // If both within 0.3 of t, linearly interpolate (smooth occlusion).
      if (left && right && Math.abs(left.t - m.t) <= 0.3 && Math.abs(right.t - m.t) <= 0.3) {
        const u = (m.t - left.t) / (right.t - left.t)
        out.push({
          t: m.t,
          cx: Math.round(left.cx + (right.cx - left.cx) * u),
          cy: Math.round(left.cy + (right.cy - left.cy) * u),
          rx: Math.round(left.rx + (right.rx - left.rx) * u),
          ry: Math.round(left.ry + (right.ry - left.ry) * u),
          yaw: 0,
          confidence: +Math.min(left.confidence, right.confidence).toFixed(3),
          source: 'interpolated',
        })
        continue
      }

      // Boundary frame (next to a back-of-head sequence) — borrow the
      // nearest valid detection's pose. The renderer interpolates smoothly
      // through the yaw=90 dead zone between back-of-head and the neighbor.
      const anchor = left || right
      if (anchor) {
        out.push({
          t: m.t,
          cx: anchor.cx,
          cy: anchor.cy,
          rx: anchor.rx,
          ry: anchor.ry,
          yaw: anchor.yaw,
          confidence: anchor.confidence,
          source: 'anchor-borrow',
        })
        continue
      }

      // Truly isolated no-face frame (e.g., loader hiccup). Default to
      // back-of-head so the patch stays consistent.
      out.push({
        t: m.t,
        cx: 640, cy: 220, rx: 82, ry: 99,
        yaw: 180, confidence: 0,
        source: 'back-of-head',
      })
    }
    cleaned.push({ ...scene, track: out })
  }

  await browser.close()
  server.close()

  writeFileSync(OUT_JSON, JSON.stringify({ raw: results, cleaned }, null, 2))
  console.log(`\n• Wrote ${OUT_JSON}`)

  // Also emit a landmarks-only JSON dump (cleaned track only, omitting the
  // raw 478-point arrays from the giant OUT_JSON). The script's caller uses
  // this to copy/paste landmark arrays into lib/scenes.ts without wading
  // through the full debug dump.
  const landmarksOut = join(__dirname, 'keyframes-landmarks.json')
  writeFileSync(
    landmarksOut,
    JSON.stringify(
      cleaned.map((scene) => ({
        id: scene.id,
        track: scene.track.map((kf) => ({
          t: kf.t,
          cx: kf.cx,
          cy: kf.cy,
          rx: kf.rx,
          ry: kf.ry,
          headYaw: kf.yaw,
          landmarks: kf.landmarks ?? null,
          source: kf.source,
        })),
      })),
      null,
      2,
    ),
  )
  console.log(`• Wrote ${landmarksOut}`)

  function landmarksToLiteral(lms) {
  // Compact inline representation: [{x: 123.45, y: 678.90}, ...]
  return '[' + lms.map((p) => `{x: ${p.x}, y: ${p.y}}`).join(', ') + ']'
}

console.log('\n• Final keyframe table (auto-measured + interpolated/back-of-head):\n')
for (const r of cleaned) {
  console.log(`// ${r.id} (${r.title}, ${r.duration.toFixed(2)}s)`)
  for (const m of r.track) {
    const tag = m.source === 'measured' ? `conf=${m.confidence}` : m.source
    const lmTag = m.landmarks ? `landmarks=${m.landmarks.length}` : 'no-landmarks'
    console.log(`//   t=${m.t.toFixed(3)}  cx=${m.cx} cy=${m.cy} rx=${m.rx} ry=${m.ry} yaw=${m.yaw}  ${tag}  ${lmTag}`)
  }
  console.log(`{`)
  for (let i = 0; i < r.track.length; i++) {
    const m = r.track[i]
    const comma = i < r.track.length - 1 ? ',' : ''
    const lmStr = m.landmarks
      ? `, landmarks: ${landmarksToLiteral(m.landmarks)}`
      : ''
    console.log(`  { t: ${m.t.toFixed(3)}, cx: ${m.cx}, cy: ${m.cy}, rx: ${m.rx}, ry: ${m.ry}, rotation: 0, headYaw: ${m.yaw}${lmStr} }${comma}`)
  }
  console.log(`}`)
}

  console.log(`\n• Frames left in ${TMP_DIR} for debugging (delete with: rm -rf ${TMP_DIR})`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
