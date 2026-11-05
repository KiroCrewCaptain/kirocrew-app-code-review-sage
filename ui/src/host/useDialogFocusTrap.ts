/**
 * Modal focus handling: focus moves into the dialog when it opens and back to
 * what had it when it closes, Tab wraps inside the dialog, and Escape asks it to
 * close (not while an IME composition is open, whose Escape cancels the
 * composition). The dashboard's `hooks/useDialogFocusTrap`, without its
 * coordination with the dashboard's own overlays (stacked traps, the crew
 * overlay), which an app page has no access to.
 */
import { type RefObject, useEffect } from 'react'

export const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useDialogFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
): void {
  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null
    const first = Array.from(containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      .find((el) => el.tabIndex >= 0)
    ;(first ?? containerRef.current)?.focus({ preventScroll: true })
    return () => restoreTo?.focus?.({ preventScroll: true })
  }, [containerRef])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (e.isComposing) return
        onEscape()
        return
      }
      const container = containerRef.current
      if (e.key !== 'Tab' || !container) return
      const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => el.tabIndex >= 0)
      if (!items.length) return
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      const active = document.activeElement
      const wrapsForward = !e.shiftKey && active === lastEl
      const wrapsBackward = e.shiftKey && (active === firstEl || active === container)
      const refocuses = !wrapsForward && !wrapsBackward && !container.contains(active)
      if (!wrapsForward && !wrapsBackward && !refocuses) return
      e.preventDefault()
      ;(wrapsBackward ? lastEl : firstEl).focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [containerRef, onEscape])
}
