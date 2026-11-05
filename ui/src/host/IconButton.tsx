/**
 * The dashboard's small icon button (`components/ui.IconButton`), which the App
 * SDK does not export. Same classes and variants; the dashboard's hover label
 * bubble is the browser's own `title` tooltip here, from the required label.
 */
import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from './cn'

const VARIANTS: Record<'default' | 'accent' | 'danger' | 'active', string> = {
  default: 'text-muted hover:text-text hover:bg-bg-hover',
  accent: 'text-muted hover:text-accent hover:bg-bg-hover',
  danger: 'text-muted hover:text-danger-text hover:bg-danger-subtle',
  active: 'text-accent hover:bg-bg-hover',
}

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  variant?: keyof typeof VARIANTS
  'aria-label': string
}

export const IconButton = forwardRef<HTMLButtonElement, Props>(
  ({ variant = 'default', className, children, title, ...rest }, ref) => (
    <button
      ref={ref}
      type="button"
      title={title ?? rest['aria-label']}
      className={cn(
        'p-[4px] rounded transition-all active:scale-[0.97] active:duration-75 cursor-pointer bg-transparent border-none disabled:opacity-30 disabled:cursor-not-allowed',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  ),
)
IconButton.displayName = 'IconButton'
