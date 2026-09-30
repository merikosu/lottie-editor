/**
 * SVG → Lottie import (public API).
 */
export { importSvg, viewBoxTransform } from './import'
export { parseColor } from './color'
export {
  parsePathData,
  svgPathToBeziers,
  subpathToBezier,
  type AbsSubpath,
  type AbsVertex,
} from './path-data'
export { parseTransform } from './transform'
export {
  SvgImportError,
  type SvgImportErrorCode,
  type SvgImportOptions,
  type SvgImportResult,
  type SvgWarning,
  type SvgWarningCode,
} from './types'
