#!/usr/bin/env node
/**
 * Patches a lottie-web 5.13 bug: the canvas renderer's `assetLoader` reads `lumaLoader.load`
 * from the (never invoked) factory function, so luma track mattes (tt 3/4) throw
 * "assetLoader.loadLumaCanvas is not a function" in the canvas renderer (preview + exports).
 * Idempotent; runs on `npm install` (postinstall).
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(process.cwd(), 'node_modules', 'lottie-web', 'build', 'player')
if (!existsSync(dir)) process.exit(0)

const BUGGY = /loadLumaCanvas:\s*lumaLoader\.load,\s*getLumaCanvas:\s*lumaLoader\.get,/
// Minified builds: create one instance lazily and share it between load and get.
const FIXED =
  'loadLumaCanvas: (lumaLoader.__le || (lumaLoader.__le = lumaLoader())).load, /* le-patched */' +
  ' getLumaCanvas: (lumaLoader.__le || (lumaLoader.__le = lumaLoader())).get,'

let patched = 0
for (const name of readdirSync(dir)) {
  if (!name.endsWith('.js')) continue
  const file = join(dir, name)
  let code = readFileSync(file, 'utf8')
  if (code.includes('le-patched') || !BUGGY.test(code)) continue
  // Invoke the factory once and share the instance for load + get.
  code = code.replace(
    /var assetLoader = function \(\) \{\s*return \{\s*loadLumaCanvas: lumaLoader\.load,\s*getLumaCanvas: lumaLoader\.get,/,
    'var assetLoader = function () {\n    var luma = lumaLoader(); /* le-patched */\n    return {\n      loadLumaCanvas: luma.load,\n      getLumaCanvas: luma.get,',
  )
  if (!code.includes('le-patched')) code = code.replace(BUGGY, FIXED)
  writeFileSync(file, code)
  patched++
}
if (patched) console.log(`patched lottie-web luma loader in ${patched} file(s)`)
