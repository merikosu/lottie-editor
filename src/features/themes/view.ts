/**
 * What a row of the Themes section shows: the value a slot has in the selected theme (its own
 * value for Default), and whether that value is the theme's or inherited from Default.
 */
import type { RGBA } from '@/lib/color'
import {
  findThemeRule,
  ruleColor,
  ruleFitsKind,
  ruleKeyframeColors,
  ruleScalar,
  ruleVector,
  slotColor,
  slotKeyframeColors,
  slotScalar,
  slotVector,
  type SlotInfo,
  type SlotKind,
  type ThemeRule,
} from '@/lottie/slots'
import type { ThemeInfo } from './model'

export type SlotValue =
  | { type: 'color'; color: RGBA }
  /** Keyframed (or expression-driven) color: the colors it goes through. */
  | { type: 'animated'; colors: RGBA[] }
  | { type: 'number'; value: number }
  | { type: 'vector'; value: number[] }
  /** A value this section does not edit (gradients, images, text, paths, dynamic numbers). */
  | { type: 'other'; kind: SlotKind }

export interface SlotView {
  value: SlotValue
  /** The selected theme has a rule for the slot. */
  overridden: boolean
  /** A theme is selected but has no rule for the slot: it shows the default value. */
  inherited: boolean
  /** A theme is selected and the slot looks the same as in Default (rule or not). */
  sameAsDefault: boolean
  /** The rule of the selected theme, if any. */
  rule: ThemeRule | null
}

const to8 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255)
const sameColor = (a: RGBA, b: RGBA) =>
  to8(a.r) === to8(b.r) && to8(a.g) === to8(b.g) && to8(a.b) === to8(b.b)
const close = (a: number, b: number) => Math.abs(a - b) < 1e-6

/** True when two values look the same (colors compared as 8-bit, numbers exactly). */
export function sameValue(a: SlotValue, b: SlotValue): boolean {
  if (a.type === 'color' && b.type === 'color') return sameColor(a.color, b.color)
  if (a.type === 'animated' && b.type === 'animated')
    return (
      a.colors.length === b.colors.length && a.colors.every((c, i) => sameColor(c, b.colors[i]))
    )
  if (a.type === 'number' && b.type === 'number') return close(a.value, b.value)
  if (a.type === 'vector' && b.type === 'vector')
    return a.value.length === b.value.length && a.value.every((v, i) => close(v, b.value[i]))
  return false
}

function defaultValue(slot: SlotInfo): SlotValue {
  switch (slot.kind) {
    case 'color': {
      const color = slotColor(slot)
      if (color) return { type: 'color', color }
      const colors = slotKeyframeColors(slot)
      return colors.length ? { type: 'animated', colors } : { type: 'other', kind: slot.kind }
    }
    case 'scalar': {
      const value = slotScalar(slot)
      return value === null ? { type: 'other', kind: slot.kind } : { type: 'number', value }
    }
    case 'vector':
    case 'position': {
      const value = slotVector(slot)
      return value === null ? { type: 'other', kind: slot.kind } : { type: 'vector', value }
    }
    default:
      return { type: 'other', kind: slot.kind }
  }
}

function ruleValue(rule: ThemeRule, kind: SlotKind): SlotValue {
  switch (rule.type) {
    case 'Color': {
      const color = ruleColor(rule)
      if (color) return { type: 'color', color }
      const colors = ruleKeyframeColors(rule)
      // One keyframe is a constant color (players show it all the time).
      if (colors.length === 1 && typeof rule.expression !== 'string')
        return { type: 'color', color: colors[0] }
      return { type: 'animated', colors }
    }
    case 'Scalar': {
      const value = ruleScalar(rule)
      return value === null ? { type: 'other', kind } : { type: 'number', value }
    }
    case 'Vector':
    case 'Position': {
      const value = ruleVector(rule)
      return value === null ? { type: 'other', kind } : { type: 'vector', value }
    }
    default:
      return { type: 'other', kind }
  }
}

/** The row of `slot` for the selected theme (null: Default). */
export function slotView(
  slot: SlotInfo,
  theme: ThemeInfo | null,
  animationId: string | null,
): SlotView {
  const rule = theme ? (findThemeRule(theme.rules, slot.id, animationId) ?? null) : null
  const fallback = defaultValue(slot)
  if (rule && ruleFitsKind(rule.type, slot.kind)) {
    const value = ruleValue(rule, slot.kind)
    return {
      value,
      overridden: true,
      inherited: false,
      sameAsDefault: sameValue(value, fallback),
      rule,
    }
  }
  return {
    value: fallback,
    // A rule of the wrong type is ignored by players: the default value shows.
    overridden: !!rule,
    inherited: !!theme && !rule,
    sameAsDefault: !!theme,
    rule,
  }
}

const cssColor = (c: RGBA) =>
  `rgb(${Math.round(c.r * 255)} ${Math.round(c.g * 255)} ${Math.round(c.b * 255)})`

/** CSS background for an animated value: its colors side by side. */
export function colorsCss(colors: readonly RGBA[]): string {
  if (colors.length === 0) return 'transparent'
  if (colors.length === 1) return cssColor(colors[0])
  const step = 100 / colors.length
  const parts = colors.map((c, i) => `${cssColor(c)} ${i * step}% ${(i + 1) * step}%`)
  return `linear-gradient(90deg, ${parts.join(', ')})`
}
