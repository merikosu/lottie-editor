/**
 * Turning preview failures into messages for people (pure).
 *
 * lottie-web does not validate its input: malformed data surfaces as internal JavaScript
 * exceptions ("Cannot read properties of null (reading 'length')"). Those say nothing to a
 * designer, so they are reported as data lottie-web cannot render, and the original text is
 * kept as the technical detail (shown on hover).
 */

/** Exceptions thrown by the JavaScript engine itself, i.e. lottie-web tripping over the data. */
const ENGINE_ERRORS = new Set([
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
])

export interface DescribedError {
  /** 'data': lottie-web crashed on the document's content; 'other': the message is meaningful as is. */
  kind: 'data' | 'other'
  /** The original message, e.g. "TypeError: Cannot read properties of null (reading 'length')". */
  detail: string
}

/** Classifies a preview failure and extracts its technical detail. */
export function describePreviewError(error: unknown): DescribedError {
  if (error instanceof Error) {
    const message = error.message.trim()
    const engine = ENGINE_ERRORS.has(error.name)
    const detail = engine ? `${error.name}: ${message}` : message
    return { kind: engine || !message ? 'data' : 'other', detail: detail || error.name }
  }
  const text = typeof error === 'string' ? error.trim() : ''
  return { kind: text ? 'other' : 'data', detail: text }
}
