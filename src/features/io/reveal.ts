/**
 * Where a newly opened document shows up. The editor and Customize show the open document; the
 * home page and the optimizer do not, so a file opened there (with ⌘O, a paste, a sample, a
 * recent file) goes to the editor — unless the action named its page (a home page card).
 */
import { currentRoute, navigate } from '@/app/router'
import type { DocumentRoute } from './dialog-ids'

const DOCUMENT_PAGES: readonly string[] = ['edit', 'customize'] satisfies DocumentRoute[]

/** Shows the document the user has just opened, on `route` when given. */
export function revealDocument(route?: DocumentRoute): void {
  const here = currentRoute()
  const target = route ?? (DOCUMENT_PAGES.includes(here) ? null : 'edit')
  if (target && target !== here) navigate(target)
}
