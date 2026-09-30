/**
 * Registers every feature's commands and dialogs.
 */
import { register as assets } from '@/features/assets/register'
import { register as code } from '@/features/code/register'
import { register as colors } from '@/features/colors/register'
import { register as customize } from '@/features/customize/register'
import { register as docops } from '@/features/docops/register'
import { register as exportFeature } from '@/features/export/register'
import { register as home } from '@/features/home/register'
import { register as insights } from '@/features/insights/register'
import { register as inspector } from '@/features/inspector/register'
import { register as io } from '@/features/io/register'
import { register as layers } from '@/features/layers/register'
import { register as optimizer } from '@/features/optimizer/register'
import { register as themes } from '@/features/themes/register'
import { register as timeline } from '@/features/timeline/register'
import { register as viewport } from '@/features/viewport/register'
import { register as workspace } from '@/features/workspace/register'

export function registerFeatures(): () => void {
  const disposers = [
    io,
    viewport,
    timeline,
    layers,
    inspector,
    colors,
    themes,
    exportFeature,
    insights,
    code,
    assets,
    docops,
    workspace,
    home,
    customize,
    optimizer,
  ].map((register) => register())
  return () => disposers.forEach((dispose) => dispose())
}
