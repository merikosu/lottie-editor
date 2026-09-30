// @vitest-environment jsdom
/**
 * The Effects section: friendly parameters for an effect exported from a Russian After Effects,
 * scaled values (drop shadow opacity is stored 0–255, shown in %), the on/off switch and the
 * parameters no player reads tucked away.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui'
import { createEffect } from '@/lottie/effects'
import type { Animation, Effect, Layer } from '@/lottie/types'
import { getDoc, loadDocument } from '@/store/document'
import type { CompTime } from '../model/time'
import { EffectsSection } from '../sections/effects/EffectsSection'

const time: CompTime = {
  frame: 0,
  assetIndex: null,
  chain: [],
  instances: 0,
  orphan: false,
  remapped: false,
  toRoot: (t) => t,
  fromRoot: (f) => f,
}

function russianShadow(): Effect {
  const effect = createEffect('dropShadow', { name: 'Тень' })
  const ru = ['Цвет тени', 'Непрозрачность', 'Направление', 'Расстояние', 'Мягкость', 'Только тень']
  effect.ef!.forEach((c, i) => (c.nm = ru[i]))
  return effect
}

function load(effects: Effect[]) {
  const doc: Animation = {
    v: '5.12.0',
    fr: 30,
    ip: 0,
    op: 60,
    w: 100,
    h: 100,
    layers: [{ ty: 4, ind: 1, nm: 'Shape', ip: 0, op: 60, st: 0, ks: {}, shapes: [], ef: effects }],
  } as unknown as Animation
  loadDocument(doc, { fileName: 'fx.json' })
}

const PATH = ['layers', 0]
const stored = (effect: number, control: number) =>
  ((getDoc()!.layers[0] as Layer).ef![effect].ef![control].v as { k: unknown }).k

function renderSection() {
  return render(
    <TooltipProvider>
      <EffectsSection path={PATH} time={time} />
    </TooltipProvider>,
  )
}

beforeAll(() => {
  // Radix measures switches with ResizeObserver, which jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
beforeEach(() => load([russianShadow()]))
afterEach(cleanup)

describe('EffectsSection', () => {
  it('shows friendly parameters for an effect exported from a Russian After Effects', () => {
    renderSection()
    expect(screen.getByText('Тень')).toBeTruthy()
    // The type follows a name that doesn't say it.
    expect(screen.getByText('Drop shadow')).toBeTruthy()
    for (const label of ['Color', 'Opacity', 'Direction', 'Distance', 'Softness', 'Shadow only'])
      expect(screen.getByText(label)).toBeTruthy()
  })

  it('edits the 0–255 opacity in percent', () => {
    renderSection()
    const input = screen.getByLabelText('Opacity') as HTMLInputElement
    expect(input.value).toBe('50')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '60' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(stored(0, 1)).toBe(153)
  })

  it('turns the effect off with its switch', () => {
    renderSection()
    const toggle = screen.getByRole('switch', { name: 'Enabled' })
    // The switch keeps its own state attribute (a tooltip trigger must not replace it).
    expect(toggle.getAttribute('data-state')).toBe('checked')
    fireEvent.click(toggle)
    expect((getDoc()!.layers[0] as Layer).ef![0].en).toBe(0)
  })

  it('tucks away the parameters players ignore', () => {
    load([createEffect('fill')])
    renderSection()
    expect(screen.queryByText('Horizontal feather')).toBeNull()
    fireEvent.click(screen.getByText('Unused by players'))
    expect(screen.getByText('Horizontal feather')).toBeTruthy()
  })

  it('keeps an empty section with the add button for layers without effects', () => {
    load([])
    renderSection()
    expect(screen.getByText('Effects')).toBeTruthy()
    expect(screen.getByLabelText('Add effect')).toBeTruthy()
    expect(screen.queryByTestId('effects-list')).toBeNull()
  })
})
