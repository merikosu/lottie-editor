/** Shared look of all text-like fields (inputs, number fields, select triggers). */
export const fieldFrame =
  'flex min-w-0 items-center rounded-sm bg-surface-2 text-fg shadow-[inset_0_0_0_1px_transparent] transition-shadow duration-100 hover:shadow-[inset_0_0_0_1px_var(--le-line-strong)] focus-within:shadow-[inset_0_0_0_1px_var(--le-accent)] focus-within:hover:shadow-[inset_0_0_0_1px_var(--le-accent)] aria-disabled:pointer-events-none aria-disabled:opacity-40'

export type FieldSize = 'sm' | 'md' | 'lg'

export const fieldSizes: Record<FieldSize, string> = {
  sm: 'h-6 text-sm',
  md: 'h-7 text-sm',
  lg: 'h-8 text-base',
}
