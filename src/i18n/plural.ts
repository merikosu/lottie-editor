/** English plural: 1 layer, 2 layers. */
export function pluralEn(n: number, one: string, other: string): string {
  return `${n} ${Math.abs(n) === 1 ? one : other}`
}

/** Russian plural: 1 слой, 2 слоя, 5 слоёв (21 слой, 22 слоя, 25 слоёв, 11–14 слоёв). */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100
  const last = abs % 10
  let form = many
  if (abs < 11 || abs > 14) {
    if (last === 1) form = one
    else if (last >= 2 && last <= 4) form = few
  }
  return `${n} ${form}`
}
