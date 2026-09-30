/**
 * About: app name and version, what it is, the privacy promise, links and the open-source
 * projects it is built with.
 */
import { ArrowUpRight, Bug, CodeXml, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { Logo } from '@/app/Logo'
import type { DialogComponentProps } from '@/commands/dialogs'
import { Button, Dialog } from '@/components/ui'
import { useT } from '@/i18n'
import pkg from '../../../../package.json'
import { CREDITS, ISSUES_URL, REPOSITORY_URL } from './credits'
import { useReturnFocus } from '../useReturnFocus'

const external = { target: '_blank', rel: 'noreferrer noopener' } as const

/** A link styled as a small secondary button (`<Button asChild>` cannot wrap links yet). */
function LinkButton({
  href,
  icon,
  children,
}: {
  href: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <a
      href={href}
      {...external}
      className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-surface-2 px-2 text-sm font-medium whitespace-nowrap text-fg shadow-[inset_0_0_0_1px_var(--le-line-strong)] transition-colors duration-100 select-none hover:bg-surface-3 active:bg-pressed [&_svg]:text-fg-muted"
    >
      {icon}
      <span>{children}</span>
    </a>
  )
}

export function AboutDialog({ close }: DialogComponentProps) {
  const t = useT()
  useReturnFocus()
  const a = t.workspace.about
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      size="md"
      title={
        <span className="flex items-center gap-3">
          <Logo size={36} />
          <span className="flex min-w-0 flex-col">
            <span className="text-md font-semibold text-fg">{t.app.name}</span>
            <span
              className="text-xs font-normal text-fg-subtle tabular-nums"
              data-testid="about-version"
            >
              {a.version(pkg.version)}
            </span>
          </span>
        </span>
      }
      // Shown once a license is set in package.json.
      footerStart={
        'license' in pkg && typeof pkg.license === 'string' ? a.license(pkg.license) : undefined
      }
      footer={
        // The default action gets the initial focus (instead of the ✕ in the corner).
        <Button variant="secondary" autoFocus onClick={close}>
          {t.common.close}
        </Button>
      }
    >
      <div data-testid="about-dialog">
        <p className="text-sm text-fg">{a.description}</p>
        <p className="mt-2 flex items-start gap-2 text-xs text-fg-muted">
          <ShieldCheck size={14} className="mt-px shrink-0 text-fg-subtle" aria-hidden />
          <span>{a.privacy}</span>
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <LinkButton href={REPOSITORY_URL} icon={<CodeXml size={14} aria-hidden />}>
            {a.repository}
          </LinkButton>
          <LinkButton href={ISSUES_URL} icon={<Bug size={14} aria-hidden />}>
            {a.issues}
          </LinkButton>
        </div>

        <section className="mt-5 border-t border-line pt-4" aria-labelledby="le-about-credits">
          <h3 id="le-about-credits" className="text-xs font-semibold text-fg">
            {a.credits}
          </h3>
          <p className="mt-0.5 text-xs text-fg-subtle">{a.creditsHint}</p>
          <ul className="mt-2 grid grid-cols-2 gap-x-6">
            {CREDITS.map((c) => (
              <li key={c.name}>
                <a
                  href={c.url}
                  {...external}
                  className="group flex h-6 min-w-0 items-center gap-1.5 rounded-sm text-sm text-fg-muted hover:text-fg"
                >
                  <span className="truncate">{c.name}</span>
                  <ArrowUpRight
                    size={12}
                    aria-hidden
                    className="shrink-0 text-fg-faint opacity-0 transition-opacity group-hover:opacity-100"
                  />
                  <span className="ml-auto shrink-0 text-xs text-fg-subtle">{c.license}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Dialog>
  )
}
