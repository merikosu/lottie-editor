import { useOptimizer } from './model/store'
import { DetailView } from './ui/detail/DetailView'
import { QueueView } from './ui/queue/QueueView'
import { StartState } from './ui/StartState'

/**
 * Optimizer service: drop Lottie files, get maximally optimized files with a visual guarantee.
 * Start state (no files) → the queue → one file's detail (A/B comparison, savings, settings).
 */
export function OptimizerPage() {
  const hasJobs = useOptimizer((s) => s.jobs.length > 0)
  const selectedId = useOptimizer((s) =>
    s.selectedId && s.jobs.some((j) => j.id === s.selectedId) ? s.selectedId : null,
  )
  if (!hasJobs) return <StartState />
  // One view per file: players, playhead and zoom start fresh (no frame of the previous file).
  if (selectedId) return <DetailView key={selectedId} jobId={selectedId} />
  return <QueueView />
}
