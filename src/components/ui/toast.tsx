import { Toaster as Sonner } from 'sonner'
import { useT } from '@/i18n'
import { usePrefs } from '@/store/prefs'

export function Toaster() {
  const t = useT()
  const theme = usePrefs((s) => s.theme)
  return (
    <Sonner
      theme={theme}
      // The landmark screen readers announce (sonner adds its hotkey, "alt+T", after it).
      containerAriaLabel={t.common.notifications}
      position="bottom-center"
      offset={20}
      gap={8}
      visibleToasts={4}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex w-[360px] items-start gap-2.5 rounded-lg bg-surface-3 px-3 py-2.5 text-sm text-fg shadow-popover',
          title: 'font-medium leading-5',
          description: 'mt-0.5 text-xs text-fg-muted',
          icon: 'mt-0.5 [&_svg]:size-4',
          success: '[&_[data-icon]]:text-success',
          error: '[&_[data-icon]]:text-danger',
          warning: '[&_[data-icon]]:text-warning',
          info: '[&_[data-icon]]:text-accent-text',
          actionButton:
            'ml-auto h-6 shrink-0 rounded-md bg-accent px-2 text-xs font-medium text-accent-fg hover:bg-accent-hover',
          cancelButton: 'ml-auto h-6 shrink-0 rounded-md bg-hover px-2 text-xs font-medium text-fg',
          closeButton: 'text-fg-subtle',
        },
      }}
    />
  )
}
