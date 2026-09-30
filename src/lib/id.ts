let counter = 0

/** Short unique id for editor-internal purposes (not persisted into Lottie files). */
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1_000_000
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`
}
