/**
 * Whether the viewport is phone-narrow (below 768px), the dashboard's own
 * breakpoint, re-read on every `matchMedia` change.
 *
 * The dashboard's `hooks/useIsMobile` also defers the switch into its layout
 * transition and answers `false` inside an embed; neither is reachable from an
 * app bundle, and an app page is never mounted in the dashboard's embed shell.
 */
import { useSyncExternalStore } from 'react'

export const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function mql(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(MOBILE_QUERY)
    : null
}

function subscribe(cb: () => void): () => void {
  const list = mql()
  list?.addEventListener?.('change', cb)
  window.addEventListener('resize', cb)
  return () => {
    list?.removeEventListener?.('change', cb)
    window.removeEventListener('resize', cb)
  }
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, () => mql()?.matches ?? false, () => false)
}
