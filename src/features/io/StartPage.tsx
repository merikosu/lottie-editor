import type { ReactNode } from 'react'
import { Logo } from '@/app/Logo'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'

/**
 * Frame of the start pages (home, the editor without a document, other services' start states):
 * the same column, margins and header everywhere, so switching between them nothing jumps.
 */
export function StartPage({
  tagline,
  children,
  className,
  ...rest
}: {
  /** One quiet line under the app name. */
  tagline: string
  children: ReactNode
  className?: string
  'data-testid'?: string
}) {
  const t = useT()
  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-[960px] animate-fade-in flex-col px-8 pt-[max(40px,8vh)] pb-16',
        className,
      )}
      {...rest}
    >
      <header className="mb-6 flex items-center gap-3 px-1">
        <Logo size={28} />
        <div className="min-w-0">
          <h1 className="text-md font-semibold text-fg">{t.app.name}</h1>
          <p className="text-sm text-fg-muted">{tagline}</p>
        </div>
      </header>
      {children}
    </div>
  )
}
