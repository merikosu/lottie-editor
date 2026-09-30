/**
 * Optimizer Web Worker: runs the pipeline, the analysis and the semantic verification off the
 * main thread. Created by `createOptimizerClient()`; one request at a time (the client queues).
 */
import { analyze } from './analyze'
import { optimizeAnimation } from './pipeline'
import type { WorkerRequest, WorkerResponse } from './protocol'
import { verifySemantic } from './semantic'
import type { Animation } from '../types'

interface WorkerScope {
  postMessage(message: WorkerResponse): void
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void
}

const scope = self as unknown as WorkerScope

function post(message: WorkerResponse): void {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- worker scope, not window
  scope.postMessage(message)
}

async function handle(req: WorkerRequest): Promise<void> {
  try {
    switch (req.type) {
      case 'optimize': {
        const result = await optimizeAnimation(req.json, req.options, {
          source: req.source,
          measureGzip: req.measureGzip,
          onProgress: (step, done, total) =>
            post({ type: 'progress', id: req.id, step, done, total }),
        })
        post({ type: 'optimized', id: req.id, json: result.json, report: result.report })
        break
      }
      case 'analyze':
        post({ type: 'analysis', id: req.id, analysis: analyze(req.json, req.options) })
        break
      case 'verifySemantic': {
        const a = JSON.parse(req.a) as Animation
        const b = JSON.parse(req.b) as Animation
        post({ type: 'semantic', id: req.id, report: verifySemantic(a, b, req.options) })
        break
      }
    }
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err))
    post({ type: 'error', id: req.id, name: e.name, message: e.message })
  }
}

// Requests run one after another: the client sends the next one when this one answered.
scope.addEventListener('message', (event) => {
  void handle(event.data)
})
