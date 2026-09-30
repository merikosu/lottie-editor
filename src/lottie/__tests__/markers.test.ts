import { freeze, produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { createAnimation } from '../document'
import {
  addMarker,
  getMarkers,
  markerAt,
  markerDuration,
  markerEnd,
  markerName,
  moveMarker,
  nextMarkerIndex,
  nextMarkerName,
  prevMarkerIndex,
  removeMarkers,
  renameMarker,
  setMarkerDuration,
  withMarkerName,
} from '../markers'
import type { Animation, Marker } from '../types'

function docWith(markers?: Marker[]): Animation {
  const anim = createAnimation({ frames: 120 })
  if (markers) anim.markers = markers
  else delete anim.markers
  return anim
}

describe('marker names', () => {
  it('uses a plain comment as the name', () => {
    expect(markerName({ cm: 'intro' })).toBe('intro')
    expect(markerName({ cm: '' })).toBe('')
  })

  it('reads the name from a JSON payload (lottie-web markerParser)', () => {
    expect(markerName({ cm: '{"name":"hover","loop":true}' })).toBe('hover')
    // JSON without a name: lottie-web keeps the payload; the comment itself is the best label.
    expect(markerName({ cm: '{"loop":true}' })).toBe('{"loop":true}')
  })

  it('reads the name from After Effects "key: value" lines', () => {
    expect(markerName({ cm: 'name: outro\r\nduration: 12' })).toBe('outro')
    expect(markerName({ cm: 'kind: x' })).toBe('kind: x')
  })

  it('tolerates a missing comment', () => {
    expect(markerName({} as Marker)).toBe('')
  })

  it('renames while keeping the payload format', () => {
    expect(withMarkerName('intro', 'start')).toBe('start')
    expect(JSON.parse(withMarkerName('{"name":"a","loop":true}', 'b'))).toEqual({
      name: 'b',
      loop: true,
    })
    expect(withMarkerName('name: a\r\nloop: 1', 'b')).toBe('name: b\r\nloop: 1')
    expect(withMarkerName(undefined, 'x')).toBe('x')
    // A JSON payload without a name is replaced by the plain name.
    expect(withMarkerName('{"loop":true}', 'x')).toBe('x')
  })

  it('generates unique default names', () => {
    expect(nextMarkerName([], 'Marker')).toBe('Marker 1')
    expect(nextMarkerName([{ cm: 'Marker 2' }], 'Marker')).toBe('Marker 3')
    expect(nextMarkerName([{ cm: 'Marker 2' }, { cm: 'Marker 3' }], 'Marker')).toBe('Marker 4')
    expect(nextMarkerName([{ cm: '{"name":"Marker 2"}' }], 'Marker')).toBe('Marker 3')
    expect(nextMarkerName([{ cm: 'a' }], 'Маркер')).toBe('Маркер 2')
  })
})

describe('marker ranges', () => {
  it('treats missing or negative durations as point markers', () => {
    expect(markerDuration({ dr: 10 })).toBe(10)
    expect(markerDuration({ dr: -3 })).toBe(0)
    expect(markerDuration({} as Marker)).toBe(0)
    expect(markerEnd({ tm: 5, dr: 10 })).toBe(15)
    expect(markerEnd({ tm: 5, dr: Number.NaN })).toBe(5)
  })
})

describe('editing markers', () => {
  it('creates the markers array and keeps markers ordered by time', () => {
    const anim = docWith()
    expect(getMarkers(anim)).toEqual([])
    expect(addMarker(anim, { tm: 30, cm: 'b' })).toBe(0)
    expect(addMarker(anim, { tm: 10, cm: 'a' })).toBe(0)
    expect(addMarker(anim, { tm: 30, cm: 'c', dr: 5 })).toBe(2)
    expect(anim.markers).toEqual([
      { tm: 10, cm: 'a', dr: 0 },
      { tm: 30, cm: 'b', dr: 0 },
      { tm: 30, cm: 'c', dr: 5 },
    ])
  })

  it('rounds times and clamps durations', () => {
    const anim = docWith([])
    addMarker(anim, { tm: 12.00049, dr: -4 })
    expect(anim.markers![0]).toEqual({ tm: 12, cm: '', dr: 0 })
  })

  it('moves a marker and re-sorts', () => {
    const anim = docWith([
      { tm: 0, cm: 'a', dr: 0 },
      { tm: 20, cm: 'b', dr: 0 },
      { tm: 40, cm: 'c', dr: 0 },
    ])
    expect(moveMarker(anim, 0, 30)).toBe(1)
    expect(anim.markers!.map((m) => m.cm)).toEqual(['b', 'a', 'c'])
    expect(anim.markers![1].tm).toBe(30)
    expect(moveMarker(anim, 2, -5)).toBe(0)
    expect(anim.markers!.map((m) => m.cm)).toEqual(['c', 'b', 'a'])
    expect(moveMarker(anim, 9, 1)).toBe(-1)
  })

  it('keeps unsorted neighbours in place when moving', () => {
    const anim = docWith([
      { tm: 50, cm: 'late', dr: 0 },
      { tm: 10, cm: 'early', dr: 0 },
    ])
    // Moving "early" does not reorder the others (no churn in the file).
    expect(moveMarker(anim, 1, 60)).toBe(1)
    expect(anim.markers!.map((m) => m.cm)).toEqual(['late', 'early'])
  })

  it('sets durations, renames and removes', () => {
    const anim = docWith([
      { tm: 0, cm: '{"name":"a"}', dr: 0 },
      { tm: 20, cm: 'b', dr: 0 },
    ])
    setMarkerDuration(anim, 0, 12.5)
    expect(anim.markers![0].dr).toBe(12.5)
    setMarkerDuration(anim, 0, -1)
    expect(anim.markers![0].dr).toBe(0)
    renameMarker(anim, 0, 'intro')
    expect(JSON.parse(anim.markers![0].cm)).toEqual({ name: 'intro' })
    renameMarker(anim, 1, 'outro')
    expect(anim.markers![1].cm).toBe('outro')
    removeMarkers(anim, [0, 7])
    expect(anim.markers!.map((m) => m.cm)).toEqual(['outro'])
    // No-ops on missing data.
    setMarkerDuration(anim, 5, 3)
    renameMarker(anim, 5, 'x')
    removeMarkers(docWith(), [0])
  })

  it('works on frozen documents through immer drafts', () => {
    const base = freeze(docWith([{ tm: 5, cm: 'a', dr: 0 }]), true)
    const next = produce(base, (draft) => {
      addMarker(draft, { tm: 1, cm: 'b' })
      moveMarker(draft, 1, 50)
      renameMarker(draft, 0, 'first')
    })
    expect(next.markers!.map((m) => [m.cm, m.tm])).toEqual([
      ['first', 1],
      ['a', 50],
    ])
    expect(base.markers).toEqual([{ tm: 5, cm: 'a', dr: 0 }])
  })
})

describe('finding markers', () => {
  const markers: Marker[] = [
    { tm: 10, cm: 'a', dr: 0 },
    { tm: 30, cm: 'b', dr: 0 },
    { tm: 20, cm: 'c', dr: 0 },
  ]
  it('finds the closest marker within a tolerance', () => {
    expect(markerAt(markers, 10.3)).toBe(0)
    expect(markerAt(markers, 19.6)).toBe(2)
    expect(markerAt(markers, 15)).toBe(-1)
    expect(markerAt(markers, 15, 5)).toBe(0)
  })
  it('navigates by time regardless of array order', () => {
    expect(nextMarkerIndex(markers, 10)).toBe(2)
    expect(nextMarkerIndex(markers, 20)).toBe(1)
    expect(nextMarkerIndex(markers, 30)).toBe(-1)
    expect(prevMarkerIndex(markers, 30)).toBe(2)
    expect(prevMarkerIndex(markers, 10)).toBe(-1)
    expect(prevMarkerIndex(markers, 100)).toBe(1)
  })
})
