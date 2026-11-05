/**
 * Best-effort `localStorage` writes, for the column widths and the rail state.
 *
 * The dashboard's own helper (`utils/safeStorage`) also reclaims its cache tiers
 * on a quota error; those caches are the dashboard's, not this app's, so this
 * copy only swallows a refused write: the layout then falls back to its default
 * on the next visit, as it does on a first visit.
 */
export function safeSetItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Storage disabled or full: the setting is simply not remembered.
  }
}
