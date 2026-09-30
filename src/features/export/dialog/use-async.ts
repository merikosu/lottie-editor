import { useEffect, useRef, useState, type DependencyList } from 'react'

function sameDeps(a: DependencyList, b: DependencyList): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
}

export interface AsyncState<T> {
  /** Latest result (kept while a newer one is computed, so values never flash). */
  value: T | undefined
  /** The shown value belongs to older inputs. */
  pending: boolean
  error: unknown
}

/**
 * Runs `compute` after `delay` ms whenever `deps` change (debounced, cancelled when the inputs
 * change again or the component unmounts). For derived data that is too slow for render:
 * file sizes, compressed sizes, encoder support.
 */
export function useAsync<T>(
  compute: ((signal: AbortSignal) => Promise<T>) | null,
  deps: DependencyList,
  delay = 150,
): AsyncState<T> {
  const [state, setState] = useState<{
    deps: DependencyList
    value: T | undefined
    error: unknown
  }>({
    deps: [],
    value: undefined,
    error: null,
  })
  const computeRef = useRef(compute)
  useEffect(() => {
    computeRef.current = compute
  })

  useEffect(() => {
    const run = computeRef.current
    if (!run) return
    const controller = new AbortController()
    const inputs = deps
    const timer = setTimeout(() => {
      run(controller.signal).then(
        (value) => {
          if (!controller.signal.aborted) setState({ deps: inputs, value, error: null })
        },
        (error: unknown) => {
          if (!controller.signal.aborted) setState((s) => ({ deps: inputs, value: s.value, error }))
        },
      )
    }, delay)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
    // The caller's dependency list drives recomputation (like useMemo); `compute` is read through a ref.
    // oxlint-disable-next-line react/exhaustive-deps
  }, deps)

  const pending = compute !== null && !sameDeps(state.deps, deps)
  return { value: state.value, pending, error: pending ? null : state.error }
}
