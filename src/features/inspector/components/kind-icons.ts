/**
 * Colored layer-kind icons usable as the `icon` of Select options and menu items.
 */
import { createElement, type ComponentType } from 'react'
import type { IconProps } from '@/commands/registry'
import { LayerKindIcon } from '@/components/lottie/icons'
import type { LayerKind } from '@/lottie/layers'

const KINDS: LayerKind[] = [
  'precomp',
  'solid',
  'image',
  'null',
  'shape',
  'text',
  'audio',
  'camera',
  'adjustment',
  'other',
]

function kindIcon(kind: LayerKind): ComponentType<IconProps> {
  const Icon = ({ size = 14, className }: IconProps) =>
    createElement(LayerKindIcon, { kind, size: typeof size === 'number' ? size : 14, className })
  Icon.displayName = `KindIcon(${kind})`
  return Icon
}

export const KIND_OPTION_ICONS = Object.fromEntries(
  KINDS.map((kind) => [kind, kindIcon(kind)]),
) as Record<LayerKind, ComponentType<IconProps>>
