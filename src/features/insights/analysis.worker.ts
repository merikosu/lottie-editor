/**
 * Analysis worker: parses the serialized document, gzips it, validates it and counts its
 * contents off the main thread, so edits of big files never wait for the checker.
 */
import { analyzeJson, type AnalysisRequest, type AnalysisResponse } from './analysis'

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<AnalysisRequest>) => void): void
  postMessage(message: AnalysisResponse, transfer: Transferable[]): void
}

const scope = self as unknown as WorkerScope

scope.addEventListener('message', (event) => {
  const request = event.data
  if (request.type === 'ping') {
    scope.postMessage({ type: 'ready' }, [])
    return
  }
  try {
    scope.postMessage({ type: 'result', id: request.id, result: analyzeJson(request.json) }, [])
  } catch (err) {
    scope.postMessage(
      { type: 'error', id: request.id, message: err instanceof Error ? err.message : String(err) },
      [],
    )
  }
})
