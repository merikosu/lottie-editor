/**
 * The optimizer queue (in memory: it lives as long as the page, across service switches).
 * Components select what they show; the runner (runner.ts) reacts to changes and does the work.
 */
import { create } from 'zustand'
import type { OptimizeOptions } from '@/lottie/optimizer'
import type { Job, JobPart } from './types'

export interface OptimizerState {
  jobs: Job[]
  /** Job shown in the detail view (null: the queue). */
  selectedId: string | null
}

export const useOptimizer = create<OptimizerState>()(() => ({
  jobs: [],
  selectedId: null,
}))

export function getJob(id: string): Job | undefined {
  return useOptimizer.getState().jobs.find((j) => j.id === id)
}

export function addJobs(jobs: Job[]): void {
  if (!jobs.length) return
  useOptimizer.setState((s) => ({ jobs: [...s.jobs, ...jobs] }))
}

/** Updates a job (no-op when it was removed meanwhile). */
export function updateJob(id: string, patch: Partial<Job> | ((job: Job) => Partial<Job>)): void {
  useOptimizer.setState((s) => {
    const index = s.jobs.findIndex((j) => j.id === id)
    if (index < 0) return s
    const job = s.jobs[index]
    const next = { ...job, ...(typeof patch === 'function' ? patch(job) : patch) }
    const jobs = s.jobs.slice()
    jobs[index] = next
    return { jobs }
  })
}

/** Updates one part of a job. */
export function updatePart(
  jobId: string,
  partIndex: number,
  patch: Partial<JobPart> | ((part: JobPart) => Partial<JobPart>),
): void {
  updateJob(jobId, (job) => {
    const part = job.parts[partIndex]
    if (!part) return {}
    const parts = job.parts.slice()
    parts[partIndex] = { ...part, ...(typeof patch === 'function' ? patch(part) : patch) }
    return { parts }
  })
}

/** Puts `job` where the job `id` was (or at the end when it is gone). */
export function replaceJob(id: string, job: Job): void {
  useOptimizer.setState((s) => {
    const index = s.jobs.findIndex((j) => j.id === id)
    if (index < 0) return { jobs: [...s.jobs, job] }
    const jobs = s.jobs.slice()
    jobs[index] = job
    return { jobs, selectedId: s.selectedId === id ? job.id : s.selectedId }
  })
}

export function removeJob(id: string): void {
  useOptimizer.setState((s) => {
    const index = s.jobs.findIndex((j) => j.id === id)
    if (index < 0) return s
    const jobs = s.jobs.filter((j) => j.id !== id)
    // Leaving the detail of a removed file shows its neighbour (or the queue when none is left).
    let selectedId = s.selectedId
    if (selectedId === id) selectedId = (jobs[index] ?? jobs[index - 1])?.id ?? null
    return { jobs, selectedId }
  })
}

export function clearJobs(): void {
  useOptimizer.setState({ jobs: [], selectedId: null })
}

export function selectJob(id: string | null): void {
  useOptimizer.setState({ selectedId: id })
}

/** Shows the next (+1) or previous (-1) file in the detail view. */
export function stepSelection(delta: number): void {
  const { jobs, selectedId } = useOptimizer.getState()
  const index = jobs.findIndex((j) => j.id === selectedId)
  const next = jobs[index + delta]
  if (index >= 0 && next) selectJob(next.id)
}

/** Sets (or clears, with null) a file's own settings. */
export function setJobOptions(id: string, options: OptimizeOptions | null): void {
  updateJob(id, { options })
}

export function setActivePart(id: string, active: number): void {
  updateJob(id, (job) => ({ active: Math.max(0, Math.min(job.parts.length - 1, active)) }))
}
