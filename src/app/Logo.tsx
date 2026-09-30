/** App mark: an easing curve inside a rounded square. */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="0.5" y="0.5" width="19" height="19" rx="5.5" fill="var(--le-accent)" />
      <path d="M4.5 15C9 15 8.5 5 15.5 5" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="4.5" cy="15" r="1.6" fill="white" />
      <circle cx="15.5" cy="5" r="1.6" fill="white" />
    </svg>
  )
}
