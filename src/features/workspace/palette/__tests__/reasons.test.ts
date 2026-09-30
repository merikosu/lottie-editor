import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en'
import ru from '@/i18n/locales/ru'
import type { CommandCategory } from '@/commands/registry'
import { disabledReason, type ReasonContext } from '../reasons'

const base: ReasonContext = {
  hasDocument: true,
  hasNodes: false,
  hasKeyframes: false,
  hasWorkArea: false,
}
const reason = (id: string, category: CommandCategory, ctx: Partial<ReasonContext> = {}, t = en) =>
  disabledReason({ id, category }, { ...base, ...ctx }, t)

describe('disabledReason', () => {
  it('asks to open an animation when none is open', () => {
    expect(reason('layer.rename', 'layer', { hasDocument: false })).toBe('Open an animation first')
    expect(reason('keyframes.delete', 'edit', { hasDocument: false })).toBe(
      'Open an animation first',
    )
  })

  it('does not blame the missing document for commands that never need one', () => {
    expect(reason('file.open', 'file', { hasDocument: false })).toBeUndefined()
    expect(reason('help.about', 'help', { hasDocument: false })).toBeUndefined()
    expect(reason('file.clearRecents', 'file', { hasDocument: false })).toBe('No recent files')
    // The optimizer works on its own files ("Download all" waits for results, not for a document).
    expect(reason('optimizer.downloadAll', 'file', { hasDocument: false })).toBeUndefined()
    expect(reason('customize.replace', 'layer', { hasDocument: false })).toBeUndefined()
  })

  it('explains undo and redo with the app wording', () => {
    expect(reason('edit.undo', 'edit')).toBe('Nothing to undo')
    expect(reason('edit.redo', 'edit', {}, ru)).toBe('Нечего повторять')
  })

  it('asks for the missing selection', () => {
    expect(reason('keyframes.easyEase', 'edit')).toBe('Select keyframes first')
    expect(reason('layer.toggleLock', 'layer')).toBe('Select a layer first')
    expect(reason('timeline.moveInPoint', 'layer')).toBe('Select a layer first')
    expect(reason('edit.delete', 'edit')).toBe('Nothing is selected')
    expect(reason('view.zoomSelection', 'view')).toBe('Select a layer first')
  })

  it('stays silent when the obvious cause is not the real one', () => {
    expect(reason('keyframes.easyEase', 'edit', { hasKeyframes: true })).toBeUndefined()
    expect(reason('layer.selectParent', 'layer', { hasNodes: true })).toBeUndefined()
    expect(reason('edit.delete', 'edit', { hasNodes: true })).toBeUndefined()
    expect(reason('code.apply', 'edit')).toBeUndefined()
    expect(reason('anim.trim', 'animation', { hasWorkArea: true })).toBeUndefined()
  })

  it('explains work-area commands', () => {
    expect(reason('anim.trim', 'animation')).toBe('Set a work area first')
    expect(reason('playback.clearWorkArea', 'playback')).toBe('Set a work area first')
  })
})
