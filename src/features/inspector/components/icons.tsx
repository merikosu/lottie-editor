/**
 * Small custom glyphs the icon set lacks: stroke caps and joins, keyframe diamonds.
 * They inherit `currentColor` and use lucide's 24px grid.
 */
import type { ReactNode } from 'react'
import type { IconProps } from '@/commands/registry'

function Svg({ size = 14, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden
      className={className}
    >
      {children}
    </svg>
  )
}

/** A thick translucent stroke with the cap/join, plus the thin centerline of the path. */
function StrokeSample({
  d,
  cap,
  join,
  width = 10,
}: {
  d: string
  cap?: 'butt' | 'round' | 'square'
  join?: 'miter' | 'round' | 'bevel'
  width?: number
}) {
  return (
    <>
      <path
        d={d}
        strokeWidth={width}
        strokeLinecap={cap ?? 'butt'}
        strokeLinejoin={join ?? 'miter'}
        strokeOpacity={0.45}
      />
      <path d={d} strokeWidth={1.75} strokeLinecap="butt" strokeLinejoin="miter" />
    </>
  )
}

/* ------------------------------- Line caps -------------------------------- */

/** The path ends at x = 14; the cap shape (if any) extends past the marker line. */
const CAP_PATH = 'M-6 12H14'

function CapIcon({ cap, ...props }: IconProps & { cap: 'butt' | 'round' | 'square' }) {
  return (
    <Svg {...props}>
      <StrokeSample d={CAP_PATH} cap={cap} width={11} />
      <path d="M14 4.5v15" strokeWidth={1.75} strokeDasharray="2 2" />
    </Svg>
  )
}

export const CapButtIcon = (props: IconProps) => <CapIcon cap="butt" {...props} />
export const CapRoundIcon = (props: IconProps) => <CapIcon cap="round" {...props} />
export const CapSquareIcon = (props: IconProps) => <CapIcon cap="square" {...props} />

/* ------------------------------- Line joins ------------------------------- */

const JOIN_PATH = 'M7 28V8H28'

function JoinIcon({ join, ...props }: IconProps & { join: 'miter' | 'round' | 'bevel' }) {
  return (
    <Svg {...props}>
      <StrokeSample d={JOIN_PATH} join={join} />
    </Svg>
  )
}

export const JoinMiterIcon = (props: IconProps) => <JoinIcon join="miter" {...props} />
export const JoinRoundIcon = (props: IconProps) => <JoinIcon join="round" {...props} />
export const JoinBevelIcon = (props: IconProps) => <JoinIcon join="bevel" {...props} />

/* ---------------------------------- Misc ---------------------------------- */

/** Keyframe diamond for menus. */
export function DiamondIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4.5 19.5 12 12 19.5 4.5 12Z" strokeWidth={1.75} strokeLinejoin="round" />
    </Svg>
  )
}
