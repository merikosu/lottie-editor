/**
 * Does an edit change the picture? (pure)
 *
 * Reloading lottie-web costs hundreds of milliseconds on big files, so edits that cannot change
 * what is drawn keep the current player: names (`nm`, unless expressions may look layers up by
 * name) and, at the root, markers and metadata. Edited documents share every unchanged subtree
 * with their previous version (immer), so the comparison only walks the changed branches; a
 * work budget keeps unrelated rewrites (JSON editor, optimizer) from walking a whole file.
 */

/** Root fields that never affect rendering. */
const ROOT_ONLY = new Set(['markers', 'meta'])

/** Values compared at most before giving up (and reloading, the safe answer). */
const BUDGET = 20_000

interface Ctx {
  namesMatter: boolean
  budget: number
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function same(a: unknown, b: unknown, root: boolean, ctx: Ctx): boolean {
  if (a === b) return true
  if (--ctx.budget < 0 || !isObject(a) || !isObject(b)) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i], false, ctx)) return false
    return true
  }
  const skip = (key: string) => (key === 'nm' && !ctx.namesMatter) || (root && ROOT_ONLY.has(key))
  // A missing key and an undefined value serialize alike.
  for (const key of Object.keys(a)) {
    if (!skip(key) && !same(a[key], b[key], false, ctx)) return false
  }
  for (const key of Object.keys(b)) {
    if (!skip(key) && !(key in a) && b[key] !== undefined) return false
  }
  return true
}

/**
 * True when `next` renders exactly like `prev`: they differ at most in names and root markers
 * or metadata. `namesMatter`: expressions run, and may look layers up by name.
 */
export function rendersSame(prev: unknown, next: unknown, namesMatter: boolean): boolean {
  return same(prev, next, true, { namesMatter, budget: BUDGET })
}
