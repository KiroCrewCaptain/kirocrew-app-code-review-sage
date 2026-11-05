/**
 * The keyboard half of a tablist, for a rail that draws its own tabs: arrows move
 * the selection (and focus) to the next enabled tab, Home/End to the first and
 * last, and only the selected tab is in the tab order. The dashboard's
 * `components/Tablist.useRovingTabs`, without the animated indicator that
 * component draws (which this app never used).
 */
import { type KeyboardEvent, useRef } from 'react'

export interface RovingTab {
  disabled?: boolean
}

export function nextEnabledIndex(tabs: ReadonlyArray<RovingTab>, from: number, dir: 1 | -1): number {
  const n = tabs.length
  for (let step = 1; step <= n; step += 1) {
    const i = (from + dir * step + n * (step + 1)) % n
    if (!tabs[i]?.disabled) return i
  }
  return from
}

export function edgeEnabledIndex(tabs: ReadonlyArray<RovingTab>, edge: 'first' | 'last'): number {
  const order = edge === 'first' ? tabs.map((_, i) => i) : tabs.map((_, i) => tabs.length - 1 - i)
  for (const i of order) {
    if (!tabs[i]?.disabled) return i
  }
  return 0
}

export function useRovingTabs<K>(
  tabs: ReadonlyArray<RovingTab & { key: K }>,
  value: K | undefined,
  onChange: (key: K) => void,
  orientation: 'horizontal' | 'vertical' = 'horizontal',
) {
  const refs = useRef<Array<HTMLElement | null>>([])
  const vertical = orientation === 'vertical'

  const move = (to: number) => {
    const tab = tabs[to]
    if (!tab || tab.disabled) return
    if (tab.key !== value) onChange(tab.key)
    refs.current[to]?.focus()
  }

  return (i: number) => ({
    ref: (el: HTMLElement | null) => { refs.current[i] = el },
    tabIndex: tabs[i]?.key === value ? 0 : -1,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      const forward = vertical ? e.key === 'ArrowDown' : e.key === 'ArrowRight'
      const back = vertical ? e.key === 'ArrowUp' : e.key === 'ArrowLeft'
      const to = forward ? nextEnabledIndex(tabs, i, 1)
        : back ? nextEnabledIndex(tabs, i, -1)
        : e.key === 'Home' ? edgeEnabledIndex(tabs, 'first')
        : e.key === 'End' ? edgeEnabledIndex(tabs, 'last')
        : null
      if (to === null) return
      e.preventDefault()
      move(to)
    },
  })
}
