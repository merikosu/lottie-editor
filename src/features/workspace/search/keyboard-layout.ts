/**
 * Text typed with the wrong keyboard layout: "pfuheprf" was meant as "загрузка", "ызуув" as
 * "speed". The palette searches the converted query too, so switching layouts is never needed.
 * Only the standard US QWERTY ↔ Russian ЙЦУКЕН layouts are mapped.
 */

const LATIN = "`qwertyuiop[]asdfghjkl;'zxcvbnm,./"
const CYRILLIC = 'ёйцукенгшщзхъфывапролджэячсмитьбю.'

const toCyrillic = new Map<string, string>()
const toLatin = new Map<string, string>()
for (let i = 0; i < LATIN.length; i++) {
  toCyrillic.set(LATIN[i], CYRILLIC[i])
  toLatin.set(CYRILLIC[i], LATIN[i])
}

/**
 * Converts `text` as if it had been typed in the other layout. The direction follows the
 * letters in the text (more Latin letters → to Cyrillic). Returns null when nothing changes
 * or the text has no letters.
 */
export function switchLayout(text: string): string | null {
  const lower = text.toLowerCase()
  let latin = 0
  let cyrillic = 0
  for (const ch of lower) {
    if (ch >= 'a' && ch <= 'z') latin++
    else if ((ch >= 'а' && ch <= 'я') || ch === 'ё') cyrillic++
  }
  if (latin === 0 && cyrillic === 0) return null
  const map = latin >= cyrillic ? toCyrillic : toLatin
  let out = ''
  for (const ch of lower) out += map.get(ch) ?? ch
  return out === lower ? null : out
}
