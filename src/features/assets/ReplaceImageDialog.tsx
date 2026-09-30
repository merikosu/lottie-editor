import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import type { DialogComponentProps } from '@/commands/dialogs'
import { Button, Dialog } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { imageSrc } from '@/lottie/assets'
import { isImageAsset } from '@/lottie/types'
import { useDocument } from '@/store/document'
import { commitReplace, type ReplaceDialogProps } from './actions'
import { cropToAspect } from './image-file'
import { Checker } from './Thumbnail'

type Fit = 'fit' | 'fill' | 'natural'

interface Option {
  value: Fit
  title: string
  hint: string
  w: number
  h: number
}

/** Frame (current size) and image rectangles for the small option diagrams, in a 32×24 box. */
function Diagram({
  frame,
  image,
  crop,
}: {
  frame: { w: number; h: number }
  image: { w: number; h: number }
  crop: boolean
}) {
  const box = { w: 32, h: 24 }
  const s = Math.min(
    (box.w - 4) / Math.max(frame.w, image.w),
    (box.h - 4) / Math.max(frame.h, image.h),
  )
  const fw = frame.w * s
  const fh = frame.h * s
  const iw = image.w * s
  const ih = image.h * s
  const cx = box.w / 2
  const cy = box.h / 2
  const clip = `clip-${Math.round(fw)}-${Math.round(fh)}-${Math.round(iw)}-${Math.round(ih)}`
  return (
    <svg
      width={box.w}
      height={box.h}
      viewBox={`0 0 ${box.w} ${box.h}`}
      aria-hidden
      className="shrink-0"
    >
      <defs>
        <clipPath id={clip}>
          <rect x={cx - fw / 2} y={cy - fh / 2} width={fw} height={fh} />
        </clipPath>
      </defs>
      <rect
        x={cx - iw / 2}
        y={cy - ih / 2}
        width={iw}
        height={ih}
        rx={1}
        className="fill-accent/35"
        clipPath={crop ? `url(#${clip})` : undefined}
      />
      <rect
        x={cx - fw / 2 + 0.5}
        y={cy - fh / 2 + 0.5}
        width={Math.max(0, fw - 1)}
        height={Math.max(0, fh - 1)}
        rx={1}
        className="fill-none stroke-fg-subtle"
        strokeDasharray="2 2"
      />
    </svg>
  )
}

function Preview({
  src,
  label,
  w,
  h,
}: {
  src: string | null
  label: string
  w: number
  h: number
}) {
  return (
    <figure className="flex min-w-0 flex-1 flex-col gap-1.5">
      <Checker className="flex h-28 items-center justify-center overflow-hidden rounded-md shadow-[inset_0_0_0_1px_var(--le-line)]">
        {src && (
          <img
            src={src}
            alt=""
            className="max-h-full max-w-full object-contain"
            draggable={false}
          />
        )}
      </Checker>
      <figcaption className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-fg-muted">{label}</span>
        <span className="text-fg-subtle tabular-nums">
          {w} × {h}
        </span>
      </figcaption>
    </figure>
  )
}

/** Asks how a replacement image with different proportions should fit the current size. */
export function ReplaceImageDialog({ props, close }: DialogComponentProps<ReplaceDialogProps>) {
  const t = useT()
  const { assetId, image } = props
  const asset = useDocument((s) => s.doc?.assets?.find((a) => a.id === assetId))
  const [fit, setFit] = useState<Fit>('fit')
  const [busy, setBusy] = useState(false)

  if (!asset || !isImageAsset(asset)) return null
  const cur = { w: asset.w ?? image.w, h: asset.h ?? image.h }
  const s = Math.min(cur.w / image.w, cur.h / image.h)
  const options: Option[] = [
    {
      value: 'fit',
      title: t.assets.replaceDialog.fit,
      hint: t.assets.replaceDialog.fitHint,
      w: Math.max(1, Math.round(image.w * s)),
      h: Math.max(1, Math.round(image.h * s)),
    },
    {
      value: 'fill',
      title: t.assets.replaceDialog.fill,
      hint: t.assets.replaceDialog.fillHint,
      w: cur.w,
      h: cur.h,
    },
    {
      value: 'natural',
      title: t.assets.replaceDialog.natural,
      hint: t.assets.replaceDialog.naturalHint,
      w: image.w,
      h: image.h,
    },
  ]
  const chosen = options.find((o) => o.value === fit) ?? options[0]

  const confirm = async () => {
    if (busy) return
    setBusy(true)
    try {
      // "Crop" bakes the crop into the pixels so every player shows the same result.
      const pixels = chosen.value === 'fill' ? await cropToAspect(image, chosen.w, chosen.h) : image
      commitReplace(assetId, pixels, chosen.w, chosen.h)
    } catch (err) {
      console.warn('Assets: could not crop the image', err)
      commitReplace(assetId, image, chosen.w, chosen.h)
    }
    close()
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title={t.assets.replaceDialog.title}
      description={t.assets.replaceDialog.description(asset.id)}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t.common.cancel}
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void confirm()}
            data-testid="replace-confirm"
          >
            {t.assets.replaceDialog.confirm}
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-3">
        <Preview src={imageSrc(asset)} label={t.assets.replaceDialog.current} w={cur.w} h={cur.h} />
        <ArrowRight size={16} className="shrink-0 text-fg-faint" aria-hidden />
        <Preview src={image.dataUri} label={t.assets.replaceDialog.next} w={image.w} h={image.h} />
      </div>
      <fieldset className="mt-4 flex flex-col gap-1">
        <legend className="sr-only">{t.assets.replaceDialog.title}</legend>
        {options.map((o) => {
          const selected = o.value === fit
          const cover = Math.max(cur.w / image.w, cur.h / image.h)
          const shown =
            o.value === 'fill' ? { w: image.w * cover, h: image.h * cover } : { w: o.w, h: o.h }
          return (
            <label
              key={o.value}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent',
                selected
                  ? 'bg-accent-subtle shadow-[inset_0_0_0_1px_var(--le-accent)]'
                  : 'hover:bg-hover',
              )}
            >
              <input
                type="radio"
                name="le-replace-fit"
                value={o.value}
                checked={selected}
                onChange={() => setFit(o.value)}
                // Initial focus on the choice (not the close button) so arrows and Enter work at once.
                autoFocus={selected}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void confirm()
                  }
                }}
                className="sr-only"
              />
              <span
                className={cn(
                  'flex size-3.5 shrink-0 items-center justify-center rounded-full shadow-[inset_0_0_0_1px_var(--le-line-strong)]',
                  selected && 'bg-accent shadow-none',
                )}
                aria-hidden
              >
                {selected && <span className="size-1.5 rounded-full bg-accent-fg" />}
              </span>
              <Diagram frame={cur} image={shown} crop={o.value === 'fill'} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm text-fg">{o.title}</span>
                <span className="text-xs text-fg-subtle">{o.hint}</span>
              </span>
              <span className="shrink-0 text-xs text-fg-muted tabular-nums">
                {o.w} × {o.h}
              </span>
            </label>
          )
        })}
      </fieldset>
    </Dialog>
  )
}
