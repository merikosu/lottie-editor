/**
 * Imperative access to the main layout (panel collapse/expand), used by view commands.
 * AppShell installs the implementation on mount.
 */
export interface LayoutApi {
  toggleLeft: () => void
  toggleRight: () => void
  toggleBottom: () => void
  isLeftCollapsed: () => boolean
  isRightCollapsed: () => boolean
  isBottomCollapsed: () => boolean
}

const noop: LayoutApi = {
  toggleLeft: () => {},
  toggleRight: () => {},
  toggleBottom: () => {},
  isLeftCollapsed: () => false,
  isRightCollapsed: () => false,
  isBottomCollapsed: () => false,
}

let api: LayoutApi = noop

export function setLayoutApi(next: LayoutApi | null): void {
  api = next ?? noop
}

export function layout(): LayoutApi {
  return api
}
