/**
 * The built-in page's tests wrapped it in the dashboard's router. The bundle uses
 * no router (it reads `?run=` off `window.location` and navigates through the
 * host's launcher), so this stand-in only keeps those wrappers working: a
 * `MemoryRouter` that puts its first entry in the address bar.
 */
import type { ReactNode } from 'react'

export function MemoryRouter({ children, initialEntries }: { children?: ReactNode; initialEntries?: string[] }) {
  const first = initialEntries?.[0]
  if (first !== undefined && window.location.pathname + window.location.search !== first) {
    window.history.replaceState(null, '', first)
  }
  return <>{children}</>
}

export function useNavigate(): (to: string) => void {
  return () => {}
}
