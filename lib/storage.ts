/**
 * localStorage-backed persistence for the bits we want to remember between
 * visits: the active scene id, the user's last face-oval coordinates, and the
 * last uploaded face image (as a data URL so it survives page reloads).
 *
 * Image persistence caveats:
 *   - The image lives as a `data:image/...;base64,...` URL in localStorage.
 *     A 1.5MB JPEG becomes ~2MB base64. Most browsers allow 5MB+ per origin,
 *     which covers typical selfies but not phone-original HEIC files.
 *   - On quota exceeded we silently drop the image (the metadata — oval +
 *     sceneId — still persists). The user just has to re-upload the photo and
 *     the oval/scene restores on top of it.
 *   - We persist at most ONE image; storing many would blow the quota and
 *     isn't a use case we have yet.
 */

const KEY_SCENE = 'dance.sceneId'
const KEY_OVAL = 'dance.oval'
const KEY_IMAGE = 'dance.lastFaceImage'

export type Oval = {
  cx: number
  cy: number
  rx: number
  ry: number
}

const OVAL_VALIDATION = (o: unknown): o is Oval =>
  !!o && typeof o === 'object'
  && Number.isFinite((o as Oval).cx)
  && Number.isFinite((o as Oval).cy)
  && Number.isFinite((o as Oval).rx)
  && Number.isFinite((o as Oval).ry)

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    // localStorage can throw in private mode / sandboxed iframes / disabled
    // storage. Treat as "not present" rather than crashing the page.
    return null
  }
}

function safeSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    // QuotaExceededError or security error. Caller decides what to do.
    return false
  }
}

export function loadSceneId(): string | null {
  return safeGet(KEY_SCENE)
}

export function saveSceneId(id: string): void {
  safeSet(KEY_SCENE, id)
}

export function loadOval(): Oval | null {
  const raw = safeGet(KEY_OVAL)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return OVAL_VALIDATION(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveOval(o: Oval): void {
  safeSet(KEY_OVAL, JSON.stringify(o))
}

/**
 * Load the persisted face image as a data URL. Caller should check the
 * result and convert to an HTMLImageElement if present.
 */
export function loadFaceImage(): string | null {
  return safeGet(KEY_IMAGE)
}

/**
 * Persist the face image as a data URL. Returns false if the browser can't
 * fit it (quota exceeded) — caller can fall back to "this session only".
 */
export function saveFaceImage(dataUrl: string): boolean {
  return safeSet(KEY_IMAGE, dataUrl)
}

/**
 * Wipe persisted state. Useful for tests + the "change photo" reset path
 * (so the next upload replaces the stored image rather than accumulating).
 */
export function clearPersistedFace(): void {
  try {
    localStorage.removeItem(KEY_IMAGE)
    localStorage.removeItem(KEY_OVAL)
  } catch {
    // best-effort
  }
}