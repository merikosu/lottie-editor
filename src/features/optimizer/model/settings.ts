/**
 * Optimizer preferences, remembered in this browser: the queue's settings (preset or custom
 * options, output format, the visual guarantee) and how the detail view looks.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  DEFAULT_PRESET,
  PRESETS,
  matchPreset,
  resolveOptions,
  type OptimizeOptions,
  type PresetId,
} from '@/lottie/optimizer'
import type { OutputChoice } from './types'

export type CompareMode = 'side' | 'swipe' | 'difference'
export type StageBackground = 'checker' | 'dark' | 'light'
export type DetailTab = 'savings' | 'settings' | 'details'
/** Frames the visual check renders: a sample spread over the animation, or every frame. */
export type VerifyFrames = 'sampled' | 'all'

export interface OptimizerSettings {
  /** Options for every file without its own settings. */
  options: OptimizeOptions
  output: OutputChoice
  /** Relax the settings of a file until the visual check finds no difference. */
  guarantee: boolean
  verifyFrames: VerifyFrames
  compareMode: CompareMode
  background: StageBackground
  /** Amplify the difference view (small differences become visible). */
  amplify: boolean
  detailTab: DetailTab
}

export const DEFAULT_SETTINGS: OptimizerSettings = {
  options: resolveOptions(DEFAULT_PRESET),
  output: 'same',
  guarantee: true,
  verifyFrames: 'sampled',
  compareMode: 'side',
  background: 'checker',
  amplify: false,
  detailTab: 'savings',
}

export const useOptimizerSettings = create<OptimizerSettings>()(
  persist(() => DEFAULT_SETTINGS, {
    name: 'lottie-editor:optimizer',
    version: 1,
    // Stored options may predate a technique or field: resolve them over the defaults.
    merge: (persisted, current) => {
      const p = (persisted ?? {}) as Partial<OptimizerSettings>
      return {
        ...current,
        ...p,
        options: p.options ? resolveOptions({ ...p.options, preset: 'balanced' }) : current.options,
      }
    },
  }),
)

export function setOptimizerSettings(patch: Partial<OptimizerSettings>): void {
  useOptimizerSettings.setState(patch)
}

/** The preset the options match, or 'custom'. */
export function presetOf(options: OptimizeOptions): PresetId | 'custom' {
  return matchPreset(options) ?? 'custom'
}

/** A fresh copy of a preset's options. */
export function presetOptions(id: PresetId): OptimizeOptions {
  return resolveOptions(PRESETS[id] ? id : DEFAULT_PRESET)
}
