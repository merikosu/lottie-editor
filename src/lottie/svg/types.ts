/**
 * Public types of the SVG → Lottie importer.
 */
import type { Box } from '../bounds'
import type { ShapeItem } from '../types'

/**
 * Machine-readable warning codes (the UI translates them):
 *  - `text` — `<text>` is skipped; the SVG should be exported with text converted to outlines
 *  - `image` — embedded raster `<image>` is skipped
 *  - `clip-path` / `mask` / `filter` — the effect is ignored, the content is imported unclipped
 *  - `pattern` — a pattern paint is replaced by its fallback color (or nothing)
 *  - `marker` — markers (arrow heads…) are not drawn
 *  - `gradient` — a gradient was approximated (elliptical radial, focal radius, reflect/repeat)
 *  - `stroke` — a stroke under non-uniform scaling was approximated with a uniform width
 *  - `use` — a `<use>` reference is missing, external or circular
 *  - `animation` — SMIL animation is ignored (the static state is imported)
 *  - `css` — a CSS rule or selector could not be applied
 *  - `path-data` — malformed path data; the part before the error is imported
 *  - `unsupported` — another element that cannot be converted (`foreignObject`, …)
 */
export type SvgWarningCode =
  | 'text'
  | 'image'
  | 'clip-path'
  | 'mask'
  | 'filter'
  | 'pattern'
  | 'marker'
  | 'gradient'
  | 'stroke'
  | 'use'
  | 'animation'
  | 'css'
  | 'path-data'
  | 'unsupported'

export interface SvgWarning {
  code: SvgWarningCode
  /** `id` of the element concerned, when it has one. */
  id?: string
  /** Tag name of the element concerned. */
  element?: string
  /** English description for logs and tooltips. */
  message: string
  /** How many times this warning occurred (same code and element id). */
  count: number
}

export interface SvgImportOptions {
  /** Name of the root group (default: the SVG `<title>`, else "SVG"). */
  name?: string
}

export interface SvgImportResult {
  /** Imported content: one root group (content groups nested inside, SVG paint order kept). */
  shapes: ShapeItem[]
  /** Artboard size in output units: the viewBox size (or width/height without a viewBox). */
  width: number
  height: number
  /** The SVG viewBox `[minX, minY, width, height]`; output coordinates are relative to its top-left. */
  viewBox: [number, number, number, number]
  /** Visual bounds of `shapes` (strokes included), in output coordinates. */
  bounds: Box
  warnings: SvgWarning[]
}

export type SvgImportErrorCode =
  /** Not parseable as XML or HTML. */
  | 'invalid'
  /** Parsed, but there is no `<svg>` root. */
  | 'not-svg'
  /** The SVG contains nothing that can be converted (see `warnings` for why). */
  | 'empty'
  /** No DOMParser in this environment. */
  | 'unsupported-environment'

/** Fatal import failure with a code the UI can translate. */
export class SvgImportError extends Error {
  readonly code: SvgImportErrorCode
  readonly warnings: SvgWarning[]
  constructor(code: SvgImportErrorCode, message: string, warnings: SvgWarning[] = []) {
    super(message)
    this.name = 'SvgImportError'
    this.code = code
    this.warnings = warnings
  }
}
