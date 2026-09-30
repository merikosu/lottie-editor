/** Returns a throttled function that runs at most once per `ms`, always delivering the last call. */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: A | null = null
  const run = () => {
    last = performance.now()
    timer = null
    const args = pending
    pending = null
    if (args) fn(...args)
  }
  const throttled = (...args: A) => {
    pending = args
    const wait = ms - (performance.now() - last)
    if (wait <= 0) run()
    else if (!timer) timer = setTimeout(run, wait)
  }
  throttled.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    pending = null
  }
  throttled.flush = () => {
    if (timer) {
      clearTimeout(timer)
      run()
    }
  }
  return throttled
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  const debounced = (...args: A) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, ms)
  }
  debounced.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  return debounced
}

/** Yields to the event loop so long tasks (exports) keep the UI responsive. */
export function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
