/**
 * Right-click menu of the canvas. Every entry is a registered command (looked up by id), so
 * actions owned by other features appear when they exist and are hidden otherwise.
 */
import type { ReactNode } from 'react'
import {
  isCommandEnabled,
  primaryShortcut,
  runCommand,
  useCommands,
  type Command,
} from '@/commands/registry'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  MenuCheckboxItem,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuSub,
} from '@/components/ui'
import { nodeDisplayName } from '@/components/lottie/labels'
import { ArrangeMenu, NodeStateItems } from '@/features/layers'
import { useT, type Dict } from '@/i18n'
import { useDocument } from '@/store/document'
import { BACKGROUNDS } from '../backgrounds'

/** Groups of command ids, separated in the menu (the first ones act on the selection). */
const EDIT_GROUP = ['edit.copy', 'edit.paste', 'edit.duplicate', 'edit.delete']
const NODE_GROUP = ['layer.rename']
/** Shown through the layer panel's own items (labels follow the selection's state). */
const STATE_IDS = ['layer.toggleVisibility', 'layer.toggleLock']
const ARRANGE_IDS = [
  'layer.bringToFront',
  'layer.bringForward',
  'layer.sendBackward',
  'layer.sendToBack',
]
const LOOK_GROUP = ['edit.revealInCode', 'view.zoomSelection']
/** Right-click on empty canvas. */
const EMPTY_GROUP = ['edit.paste']
const FRAME_GROUP = ['export.copyFramePng', 'export.copyFrameSvg', 'export.saveFramePng']
const VIEW_GROUP = ['view.zoomFit', 'view.zoom100']
const SELECT_GROUP = ['edit.selectAll']
const BACKGROUND_IDS = BACKGROUNDS.map((bg) => `view.bg.${bg}`)

function CommandItem({ cmd, t }: { cmd: Command; t: Dict }) {
  const enabled = isCommandEnabled(cmd)
  if (cmd.checked) {
    return (
      <MenuCheckboxItem
        kind="context"
        checked={cmd.checked()}
        disabled={!enabled}
        shortcut={primaryShortcut(cmd)}
        onSelect={() => runCommand(cmd.id)}
      >
        {cmd.title(t)}
      </MenuCheckboxItem>
    )
  }
  return (
    <MenuItem
      kind="context"
      icon={cmd.icon}
      disabled={!enabled}
      shortcut={primaryShortcut(cmd)}
      onSelect={() => runCommand(cmd.id)}
    >
      {cmd.title(t)}
    </MenuItem>
  )
}

function MenuContents({ kind }: { kind: 'edited' | 'original' }) {
  const t = useT()
  const commands = useCommands()
  const doc = useDocument((s) => s.doc)
  const selection = useDocument((s) => s.selection.nodes)
  const pick = (ids: string[]) => ids.map((id) => commands.get(id)).filter((c): c is Command => !!c)

  const sections: ReactNode[] = []
  if (kind === 'edited' && selection.length > 0) {
    const edit = pick(EDIT_GROUP)
    const node = pick(NODE_GROUP)
    const states = pick(STATE_IDS)
    const arrange = pick(ARRANGE_IDS)
    const look = pick(LOOK_GROUP)
    const title =
      selection.length === 1 && doc
        ? nodeDisplayName(doc, selection[selection.length - 1], t)
        : null
    if (edit.length || title) {
      sections.push(
        <div key="edit">
          {title && (
            <MenuLabel kind="context">
              <span className="block max-w-56 truncate">{title}</span>
            </MenuLabel>
          )}
          {edit.map((cmd) => (
            <CommandItem key={cmd.id} cmd={cmd} t={t} />
          ))}
        </div>,
      )
    }
    if (node.length || states.length || arrange.length) {
      sections.push(
        <div key="node">
          {node.map((cmd) => (
            <CommandItem key={cmd.id} cmd={cmd} t={t} />
          ))}
          {states.length > 0 && <NodeStateItems kind="context" />}
          {arrange.length > 0 && <ArrangeMenu kind="context" />}
        </div>,
      )
    }
    if (look.length) sections.push(look.map((cmd) => <CommandItem key={cmd.id} cmd={cmd} t={t} />))
  } else if (kind === 'edited') {
    const empty = pick(EMPTY_GROUP)
    if (empty.length)
      sections.push(empty.map((cmd) => <CommandItem key={cmd.id} cmd={cmd} t={t} />))
  }
  const frame = pick(FRAME_GROUP)
  if (frame.length) sections.push(frame.map((cmd) => <CommandItem key={cmd.id} cmd={cmd} t={t} />))

  const backgrounds = pick(BACKGROUND_IDS)
  const view = pick(VIEW_GROUP)
  if (backgrounds.length || view.length) {
    sections.push(
      <div key="view">
        {backgrounds.length > 0 && (
          <MenuSub kind="context" label={t.viewport.background}>
            {backgrounds.map((cmd) => (
              <CommandItem key={cmd.id} cmd={cmd} t={t} />
            ))}
          </MenuSub>
        )}
        {view.map((cmd) => (
          <CommandItem key={cmd.id} cmd={cmd} t={t} />
        ))}
      </div>,
    )
  }
  if (kind === 'edited') {
    const select = pick(SELECT_GROUP)
    if (select.length)
      sections.push(select.map((cmd) => <CommandItem key={cmd.id} cmd={cmd} t={t} />))
  }

  return (
    <>
      {sections.map((section, i) => (
        <div key={i}>
          {i > 0 && <MenuSeparator kind="context" />}
          {section}
        </div>
      ))}
    </>
  )
}

export function CanvasContextMenu({
  kind,
  children,
}: {
  kind: 'edited' | 'original'
  children: ReactNode
}) {
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-[232px]">
        <MenuContents kind={kind} />
      </ContextMenuContent>
    </ContextMenu>
  )
}
