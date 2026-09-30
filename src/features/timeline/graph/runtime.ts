/**
 * The mounted graph editor, for commands and menus (which run outside React). Null while the
 * graph is not shown.
 */
import type { GraphController } from './controller'

let graph: GraphController | null = null

export function setGraphRuntime(next: GraphController | null): void {
  graph = next
}

export function getGraphRuntime(): GraphController | null {
  return graph
}
