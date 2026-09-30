/**
 * Icons for layer kinds and shape items, shared by the layer tree, timeline, inspector and
 * command palette.
 */
import { createElement } from 'react'
import type { LayerKind } from '@/lottie/layers'
import { cn } from '@/lib/cn'
import { LAYER_KIND_ICONS, LAYER_KIND_TEXT, shapeIcon } from './icon-maps'

export function LayerKindIcon({
  kind,
  size = 14,
  className,
}: {
  kind: LayerKind
  size?: number
  className?: string
}) {
  return createElement(LAYER_KIND_ICONS[kind], {
    size,
    className: cn('shrink-0', LAYER_KIND_TEXT[kind], className),
  })
}

export function ShapeTypeIcon({
  item,
  size = 14,
  className,
}: {
  item: { ty: string }
  size?: number
  className?: string
}) {
  return createElement(shapeIcon(item), {
    size,
    className: cn('shrink-0 text-fg-subtle', className),
  })
}
