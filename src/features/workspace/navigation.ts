/**
 * Running an action on a given page: when another page is showing, open the right one first
 * and run the action once it is on screen.
 */
import { currentRoute, navigate, type Route } from '@/app/router'

/**
 * Calls `fn` after a page switch has taken effect. React renders the new page as soon as the
 * router state changes, but pages finish setting up in effects and resize observers (the
 * editor installs its panel layout API, the canvas measures itself); two frames later all of
 * that has run.
 */
export function afterPageSwitch(fn: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(fn))
}

/** Runs `fn` on `route`: right away when it is showing, otherwise after navigating there. */
export function runOnRoute(route: Route | null, fn: () => void): void {
  if (route === null || currentRoute() === route) {
    fn()
    return
  }
  navigate(route)
  afterPageSwitch(fn)
}
