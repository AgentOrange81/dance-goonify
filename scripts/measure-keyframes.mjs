#!/usr/bin/env node
/**
 * Build-time keyframe measurement for dance-goonify.
 *
 * Drives a real headless Chromium via Playwright to run MediaPipe BlazeFace
 * against every keyframe of every scene's webm. Converts the detector's
 * bounding box + 6 keypoints into a face oval in CANVAS pixel coords
 * (1280×720) and a rough head-yaw estimate in degrees.
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
 *      `/public/templates/mediapipe/{wasm,blaze_face_short_range.tflite}` and
 *      `/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs` are all
 *      reachable from the probe page.
 *   2. Launch Playwright Chromium and open scripts/_probe.html, which loads
 *      MediaPipe FaceDetector and exposes a `window.__detect(imageData)`
 *      function for sending frames and getting back detections.
 *   3. Parse lib/scenes.ts to get the scene table → webm paths + keyframe
 *      timestamps.
 *   4. For each scene:
 *        a. Probe duration with ffprobe.
 *        b. For each keyframe t in [0..1], extract the corresponding frame
 *           with ffmpeg at `t * duration` seconds, save to /tmp.
 *        c. Decode the PNG with sharp → raw RGBA → construct ImageData.
 *        d. Send the ImageData to the probe page via page.evaluate(); receive
 *           detections as JSON.
 *        e. Derive oval center/radii from the bbox (tightened to ~45% width /
 *           55% height, same heuristic as the browser-side FacePicker), scale
 *           from plate space (1344×768) to canvas space (1280×720).
 *        f. Estimate yaw from the 6 BlazeFace keypoints (eyes/nose/ears):
 *             - If no face detected → yaw = 180 (back of head)
 *             - If face detected → use nose-off-centerline ratio relative to
 *               inter-eye distance, scaled empirically to degrees
 *   5. Print results and dump JSON for diffing/inspection.
 *
 * Yaw estimation note:
 *   BlazeFace doesn't return pose directly; we infer yaw from how far the
 *   nose is offset from the line connecting the two eyes. In front view the
 *   nose is centered; in 90° profile the nose aligns with one eye. The
 *   scaling is empirical — it's accurate enough to drive the renderer
 *   (`frontness = max(0, cos(yawRad))`) for visibility/squash decisions.
 *
 * Outputs:
 *   - scripts/keyframes-measured.json: full machine-readable dump
 *   - Pretty-printed keyframe table on stdout (paste into lib/scenes.ts)
 *
 * Runtime: ~20s for both plates (most time is browser launch + detector
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
 * Render an overlay PNG showing the detected oval(s) and 6 BlazeFace keypoints
 * on top of the source frame. Used for visual verification — look at the
 * generated *-overlay.png files in /tmp/dance-goonify-measure/ to confirm
 * MediaPipe actually locked onto the right region.
 *
 * Annotations are drawn in CANVAS-space (1280×720) coordinates, scaled from
 * the plate's native resolution.
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
        const kp = (d.keypoints || []).map((k, ki) =>
          `<circle cx="${k.x * sx}" cy="${k.y * sy}" r="4" fill="${color}" stroke="#000" stroke-width="1"/>` +
          `<text x="${k.x * sx + 6}" y="${k.y * sy + 4}" font-family="monospace" font-size="14" fill="${color}" stroke="#000" stroke-width="0.5">${ki}</text>`
        ).join('')
        return (
          `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="none" stroke="${color}" stroke-width="3"/>` +
          `<text x="${x + rx + 6}" y="${y - ry - 6}" font-family="monospace" font-size="20" fill="${color}" stroke="#000" stroke-width="1">conf=${d.score?.toFixed(2) ?? '?'}</text>` +
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
// Yaw estimation from BlazeFace's 6 keypoints
// ---------------------------------------------------------------------------
function estimateYaw(kp) {
  if (!kp || kp.length < 6) return null
  const has = (i) => kp[i] && (kp[i].x !== 0 || kp[i].y !== 0)
  if (!has(2)) return null
  const eyeRight = has(0) ? kp[0] : null
  const eyeLeft = has(1) ? kp[1] : null
  const nose = kp[2]
  const earRight = has(4) ? kp[4] : null
  const earLeft = has(5) ? kp[5] : null

  const eyeCount = (eyeRight ? 1 : 0) + (eyeLeft ? 1 : 0)
  const earCount = (earRight ? 1 : 0) + (earLeft ? 1 : 0)
  if (eyeCount === 0 && earCount === 0) return 180
  if (eyeCount < 1) return 90

  let eyeMidX, eyeMidY, eyeDist
  if (eyeCount === 2) {
    eyeMidX = (eyeRight.x + eyeLeft.x) / 2
    eyeMidY = (eyeRight.y + eyeLeft.y) / 2
    eyeDist = Math.hypot(eyeLeft.x - eyeRight.x, eyeLeft.y - eyeRight.y)
  } else {
    const only = eyeRight || eyeLeft
    eyeMidX = only.x
    eyeMidY = only.y
    eyeDist = Math.max(1, only.x * 0.05)
  }

  const noseOffsetX = (nose.x - eyeMidX) / Math.max(1, eyeDist)
  let yawMag = (Math.atan(Math.abs(noseOffsetX) * 3) * 180) / Math.PI

  if (earCount === 1) {
    const ear = earRight || earLeft
    const earDist = Math.hypot(ear.x - eyeMidX, ear.y - eyeMidY) / Math.max(1, eyeDist)
    if (earDist > 1.0) yawMag = Math.max(yawMag, 50)
    else if (earDist > 0.6) yawMag = Math.max(yawMag, 30)
  }

  const yawSign = noseOffsetX > 0 ? -1 : +1
  return Math.max(0, Math.min(90, yawMag * yawSign))
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

      // Send ImageData to the probe page; get detections back as JSON.
      const detections = await page.evaluate(async ({ width, height, data }) => {
        const id = new ImageData(new Uint8ClampedArray(data), width, height)
        return await window.__detect(id)
      }, { width, height, data })

      // Filter to detections that look plausibly like the dancer's face.
      // Plausibility gates (in CANVAS-space):
      //   1. confidence >= MIN_CONF (0.5): below that MediaPipe often latches
      //      onto skin patches in arms/torso/bokeh balls.
      //   2. bbox center cx within [200, 1080] — catches jumps like the
      //      t=0.166 front-grind frame where MediaPipe locked onto a
      //      background light at cx=1151 while every other frame is around
      //      cx=700.
      //   3. bbox center cy < 350 — faces are in the upper half of the frame;
      //      the dance plate has arms/torso/hips in the lower half. Kills
      //      false positives on bare midriff/arms (we had a 0.58 conf one
      //      at cy=435 that slipped past conf+cx alone).
      //   4. rx <= 100, ry <= 120 — faces are consistent in size across the
      //      loop; skin-on-body detections often have a larger bbox.
      const MIN_CONF = 0.5
      const confident = detections.filter((d) => (d.score ?? 0) >= MIN_CONF)
      const plausible = confident.filter((d) => {
        if (!d.bbox) return false
        const cxPlate = d.bbox.originX + d.bbox.width / 2
        const cyPlate = d.bbox.originY + d.bbox.height / 2
        const cxCanvas = cxPlate * (CANVAS_W / PLATE_W)
        const cyCanvas = cyPlate * (CANVAS_H / PLATE_H)
        const rxCanvas = d.bbox.width * 0.45 * (CANVAS_W / PLATE_W)
        const ryCanvas = d.bbox.height * 0.55 * (CANVAS_H / PLATE_H)
        return cxCanvas >= 200 && cxCanvas <= 1080
          && cyCanvas < 350
          && rxCanvas <= 100 && ryCanvas <= 120
      })

      // Render overlay for visual inspection regardless of detection state.
      await renderOverlay(pngPath, plausible, join(TMP_DIR, `${scene.id}-${kf.t.toFixed(3)}-overlay.png`))

      if (plausible.length === 0) {
        if (confident.length > 0) {
          console.log(`    t=${kf.t.toFixed(3)}  detection rejected (off-frame): ${confident.map((d) => `cx=${Math.round((d.bbox.originX + d.bbox.width / 2) * (CANVAS_W / PLATE_W))}`).join(', ')}`)
        } else if (detections.length > 0) {
          console.log(`    t=${kf.t.toFixed(3)}  low-confidence detection(s): ${detections.map((d) => `conf=${d.score?.toFixed(2)}`).join(', ')}`)
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
      const rxPlate = bb.width * 0.45
      const ryPlate = bb.height * 0.55
      const cxPlate = bb.originX + bb.width / 2
      const cyPlate = bb.originY + bb.height / 2
      const cx = Math.round(cxPlate * (CANVAS_W / PLATE_W))
      const cy = Math.round(cyPlate * (CANVAS_H / PLATE_H))
      const rx = Math.round(rxPlate * (CANVAS_W / PLATE_W))
      const ry = Math.round(ryPlate * (CANVAS_H / PLATE_H))
      const yaw = estimateYaw(best.keypoints) ?? 180

      console.log(`    t=${kf.t.toFixed(3)}  cx=${cx} cy=${cy} rx=${rx} ry=${ry} yaw=${yaw}° conf=${best.score.toFixed(2)}`)
      measured.push({
        t: kf.t,
        cx, cy, rx, ry,
        yaw: Math.round(yaw),
        confidence: +best.score.toFixed(3),
        keypoints: best.keypoints?.map((k) => ({ x: Math.round(k.x * 10) / 10, y: Math.round(k.y * 10) / 10 })) || null,
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
    const out = []
    for (let i = 0; i < scene.measured.length; i++) {
      const m = scene.measured[i]
      const prev = i > 0 ? scene.measured[i - 1] : null
      const next = i < scene.measured.length - 1 ? scene.measured[i + 1] : null
      const hasPrevFace = prev && prev.cx !== null
      const hasNextFace = next && next.cx !== null
      if (m.cx !== null) {
        out.push({ ...m, source: 'measured' })
        continue
      }
      // No face — could be transient miss or back-of-head.
      // Find nearest frames with valid detections (any direction).
      const findNearest = (dir) => {
        for (let j = i + dir; j >= 0 && j < scene.measured.length; j += dir) {
          if (scene.measured[j].cx !== null) return scene.measured[j]
        }
        return null
      }
      const left = findNearest(-1)
      const right = findNearest(+1)

      if (left && right && Math.abs(left.t - m.t) <= 0.25 && Math.abs(right.t - m.t) <= 0.25) {
        // Transient miss — both sides have valid faces within ~0.25 in t.
        // Interpolate.
        const u = (m.t - left.t) / (right.t - left.t)
        out.push({
          t: m.t,
          cx: Math.round(left.cx + (right.cx - left.cx) * u),
          cy: Math.round(left.cy + (right.cy - left.cy) * u),
          rx: Math.round(left.rx + (right.rx - left.rx) * u),
          ry: Math.round(left.ry + (right.ry - left.ry) * u),
          yaw: 0,  // assume front-facing (the gap is likely occlusion)
          confidence: +Math.min(left.confidence, right.confidence).toFixed(3),
          source: 'interpolated',
        })
        continue
      }

      // No neighbors with face → back of head mid-spin.
      // Use the nearest valid detection's position as placeholder so the oval
      // sits somewhere on the head silhouette (the patch is invisible at
      // yaw=180 anyway, but the placement helps future debug).
      const anchor = left || right
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
    }
    cleaned.push({ ...scene, track: out })
  }

  await browser.close()
  server.close()

  writeFileSync(OUT_JSON, JSON.stringify({ raw: results, cleaned }, null, 2))
  console.log(`\n• Wrote ${OUT_JSON}`)

  console.log('\n• Final keyframe table (auto-measured + interpolated/back-of-head):\n')
  for (const r of cleaned) {
    console.log(`// ${r.id} (${r.title}, ${r.duration.toFixed(2)}s)`)
    for (const m of r.track) {
      const tag = m.source === 'measured' ? `conf=${m.confidence}` : m.source
      console.log(`//   t=${m.t.toFixed(3)}  cx=${m.cx} cy=${m.cy} rx=${m.rx} ry=${m.ry} yaw=${m.yaw}  ${tag}`)
    }
    console.log(`{`)
    for (let i = 0; i < r.track.length; i++) {
      const m = r.track[i]
      const comma = i < r.track.length - 1 ? ',' : ''
      console.log(`  { t: ${m.t.toFixed(3)}, cx: ${m.cx}, cy: ${m.cy}, rx: ${m.rx}, ry: ${m.ry}, rotation: 0, headYaw: ${m.yaw} }${comma}`)
    }
    console.log(`}`)
  }

  console.log(`\n• Frames left in ${TMP_DIR} for debugging (delete with: rm -rf ${TMP_DIR})`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
