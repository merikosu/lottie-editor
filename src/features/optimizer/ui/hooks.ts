/**
 * Hooks shared by the optimizer's views.
 */
import { useEffect, useMemo } from 'react'
import { useOptimizerSettings } from '../model/settings'
import { useOptimizer } from '../model/store'
import { policyFor, type Policy } from '../model/summary'
import type { Job } from '../model/types'

/** The settings a job's results must match (its own options, else the queue's). */
export function usePolicy(job: Job | undefined): Policy | null {
  const options = useOptimizerSettings((s) => s.options)
  const guarantee = useOptimizerSettings((s) => s.guarantee)
  const verifyFrames = useOptimizerSettings((s) => s.verifyFrames)
  return useMemo(
    () => (job ? policyFor(job, { options, guarantee, verifyFrames }) : null),
    [job, options, guarantee, verifyFrames],
  )
}

/** The queue settings needed for totals. */
export function useQueueSettings() {
  const options = useOptimizerSettings((s) => s.options)
  const guarantee = useOptimizerSettings((s) => s.guarantee)
  const verifyFrames = useOptimizerSettings((s) => s.verifyFrames)
  return useMemo(() => ({ options, guarantee, verifyFrames }), [options, guarantee, verifyFrames])
}

export function useJob(id: string | null): Job | undefined {
  return useOptimizer((s) => (id ? s.jobs.find((j) => j.id === id) : undefined))
}

/** The file whose detail was shown last (the queue puts the keyboard back on its row). */
let lastDetail: string | null = null

/** Remembers the file of the detail view when it goes away. */
export function useRememberDetail(jobId: string): void {
  useEffect(
    () => () => {
      lastDetail = jobId
    },
    [jobId],
  )
}

/**
 * Coming back from a file's detail, the focus goes to that file's row (keyboard users continue
 * where they were), unless something else already has it.
 */
export function useReturnToRow(): void {
  useEffect(() => {
    const id = lastDetail
    lastDetail = null
    if (!id) return
    const active = document.activeElement
    if (active && active !== document.body) return
    document
      .querySelector<HTMLElement>(`[data-job="${CSS.escape(id)}"] [data-row-open]`)
      ?.focus({ preventScroll: false })
  }, [])
}
