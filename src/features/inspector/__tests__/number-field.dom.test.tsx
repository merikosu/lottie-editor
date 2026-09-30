// @vitest-environment jsdom
/**
 * The inspector's NumberField must never change the document unless the user edits the
 * value: focus + Tab, Escape and a playhead that moved while the field had focus commit
 * nothing; typed values, including the original one typed back, do.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChangeGesture } from '@/components/ui'
import { NumberField } from '@/components/ui'

afterEach(cleanup)

function setup(value: number, props: { precision?: number; min?: number; max?: number } = {}) {
  const onChange = vi.fn<(v: number, g: ChangeGesture) => void>()
  const view = render(
    <NumberField value={value} onChange={onChange} aria-label="Field" {...props} />,
  )
  const input = view.getByLabelText('Field') as HTMLInputElement
  const rerender = (next: number) =>
    view.rerender(<NumberField value={next} onChange={onChange} aria-label="Field" {...props} />)
  return { onChange, input, rerender }
}

const type = (input: HTMLInputElement, text: string) =>
  fireEvent.change(input, { target: { value: text } })

describe('inspector NumberField', () => {
  it('does not round the value when focus passes through', () => {
    const { onChange, input } = setup(-25.555, { precision: 1 })
    fireEvent.focus(input)
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not clamp a stored value outside the range when focus passes through', () => {
    const { onChange, input } = setup(150, { precision: 0, min: 0, max: 100 })
    fireEvent.focus(input)
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('commits typed values on Enter and on blur', () => {
    const { onChange, input } = setup(10, { precision: 0 })
    fireEvent.focus(input)
    type(input, '42')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toBe(42)
    type(input, '43')
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange.mock.calls[1][0]).toBe(43)
  })

  it('cancels typed text on Escape', async () => {
    const { onChange, input } = setup(10, { precision: 0 })
    input.focus()
    type(input, '99')
    fireEvent.keyDown(input, { key: 'Escape' })
    await act(() => new Promise((resolve) => setTimeout(resolve, 5)))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not key a stale value when the value changed while focused', () => {
    const { onChange, input, rerender } = setup(10, { precision: 0 })
    fireEvent.focus(input)
    // The playhead moves: the property shows another value, the draft keeps the old text.
    rerender(20)
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('accepts typing the original value back after an edit', () => {
    const { onChange, input, rerender } = setup(10, { precision: 0 })
    fireEvent.focus(input)
    type(input, '42')
    fireEvent.keyDown(input, { key: 'Enter' })
    rerender(42)
    type(input, '10')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([42, 10])
  })
})
