/**
 * A small menu with the dashboard's `components/ui/dropdown-menu` API and classes.
 *
 * The dashboard's menu is Radix, which the host does not hand to an app bundle,
 * and a bundle that carried its own copy would ship a second React-coupled
 * library. This is the part of it the page uses: a trigger (`asChild`), content
 * aligned to the trigger's start or end edge, items with `onSelect` (an item whose
 * handler calls `event.preventDefault()` keeps the menu open, as Radix does),
 * labels and separators. The menu opens on a press, Enter, Space or ArrowDown, moves
 * between items with the arrow keys and Home/End, and closes on Escape, a press
 * outside it or a selection, returning focus to the trigger.
 */
import {
  Children,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from './cn'

interface MenuState {
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: { current: HTMLElement | null }
  contentId: string
}

const MenuContext = createContext<MenuState | null>(null)

function useMenu(): MenuState {
  const menu = useContext(MenuContext)
  if (!menu) throw new Error('DropdownMenu parts must sit inside <DropdownMenu>')
  return menu
}

export function DropdownMenu({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false)
  const triggerRef = useRef<HTMLElement | null>(null)
  const contentId = useId()
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next)
    if (!next) triggerRef.current?.focus({ preventScroll: true })
  }, [])
  return (
    <MenuContext.Provider value={{ open, setOpen, triggerRef, contentId }}>
      {children}
    </MenuContext.Provider>
  )
}

type TriggerChildProps = {
  onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void
  onKeyDown?: (e: ReactKeyboardEvent<HTMLElement>) => void
  disabled?: boolean
}

export function DropdownMenuTrigger({ children }: { asChild?: boolean; children: ReactNode }) {
  const { open, setOpen, triggerRef, contentId } = useMenu()
  const child = Children.only(children)
  if (!isValidElement(child)) return null
  const element = child as ReactElement<TriggerChildProps & Record<string, unknown>>
  return cloneElement(element, {
    ref: (el: HTMLElement | null) => { triggerRef.current = el },
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? contentId : undefined,
    'data-state': open ? 'open' : 'closed',
    // A press opens it on pointerdown, as Radix does (a secondary or ctrl-click
    // does not); the keyboard opens it with Enter, Space or ArrowDown. The click
    // that follows a press is not a second toggle.
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      element.props.onPointerDown?.(e)
      if (e.defaultPrevented || element.props.disabled) return
      if (e.button !== 0 || e.ctrlKey) return
      if (!open) e.preventDefault()
      setOpen(!open)
    },
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => {
      element.props.onKeyDown?.(e)
      if (e.defaultPrevented || element.props.disabled) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setOpen(!open)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setOpen(true)
      }
    },
  } as Record<string, unknown>)
}

const ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"])'

export function DropdownMenuContent({
  children,
  align = 'start',
  sideOffset = 4,
  className,
}: {
  children: ReactNode
  align?: 'start' | 'end'
  side?: 'bottom'
  sideOffset?: number
  className?: string
}) {
  const { open, setOpen, triggerRef, contentId } = useMenu()
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', visibility: 'hidden' })

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const top = rect.bottom + sideOffset
      setStyle({
        position: 'fixed',
        top,
        maxHeight: Math.max(120, window.innerHeight - top - 8),
        ...(align === 'end'
          ? { right: Math.max(8, window.innerWidth - rect.right) }
          : { left: Math.max(8, rect.left) }),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, align, sideOffset, triggerRef])

  useEffect(() => {
    if (!open) return
    contentRef.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus({ preventScroll: true })
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (contentRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open, setOpen, triggerRef])

  if (!open) return null

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      return
    }
    if (e.key === 'Tab') {
      setOpen(false)
      return
    }
    const items = Array.from(contentRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])
    if (!items.length) return
    const at = items.indexOf(document.activeElement as HTMLElement)
    const to = e.key === 'ArrowDown' ? (at + 1) % items.length
      : e.key === 'ArrowUp' ? (at <= 0 ? items.length - 1 : at - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? items.length - 1
      : null
    if (to === null) return
    e.preventDefault()
    items[to].focus()
  }

  return createPortal(
    <div
      ref={contentRef}
      id={contentId}
      role="menu"
      tabIndex={-1}
      data-state="open"
      onKeyDown={onKeyDown}
      style={style}
      className={cn(
        'z-[9999] min-w-[8rem] overflow-y-auto overscroll-contain rounded-lg border border-border bg-bg-elevated p-1 text-text shadow-lg',
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  )
}

/** What an item's `onSelect` receives: `preventDefault()` keeps the menu open. */
export interface MenuSelectEvent {
  preventDefault: () => void
  defaultPrevented: boolean
}

export function DropdownMenuItem({
  children,
  onSelect,
  disabled = false,
  className,
}: {
  children: ReactNode
  onSelect?: (e: MenuSelectEvent) => void
  disabled?: boolean
  className?: string
}) {
  const { setOpen } = useMenu()
  const select = () => {
    if (disabled) return
    const event: MenuSelectEvent = {
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true },
    }
    onSelect?.(event)
    if (!event.defaultPrevented) setOpen(false)
  }
  return (
    <div
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      data-disabled={disabled ? '' : undefined}
      onClick={select}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          select()
        }
      }}
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-md px-3 py-1.5 text-[13px] outline-hidden transition-colors',
        'hover:bg-bg-hover focus:bg-bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function DropdownMenuLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('px-3 py-1.5 text-[12px] font-semibold text-muted', className)}>{children}</div>
  )
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <div role="separator" className={cn('mx-1 my-1 h-px bg-border', className)} />
}
