/**
 * The editor workspace: resizable panels around the canvas (layers/assets/history, the
 * center view, properties/colors/issues) and the timeline. Loaded lazily by AppShell.
 */
import { Code2, Columns2, Frame } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from 'react-resizable-panels'
import { Badge, SegmentedControl, TabPanel, Tabs } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { setPrefs, usePrefs, type CenterView, type LeftTab, type RightTab } from '@/store/prefs'
import { AssetsPanel } from '@/features/assets'
import { CodeToolbar, CodeView, useHasCodeDraft } from '@/features/code'
import { ColorsPanel } from '@/features/colors'
import { IssuesPanel, useIssueSummary } from '@/features/insights'
import { InspectorPanel } from '@/features/inspector'
import { LayersPanel } from '@/features/layers'
import { Timeline } from '@/features/timeline'
import { Viewport, ViewportToolbar } from '@/features/viewport'
import { HistoryPanel } from '@/features/workspace'
import { ErrorBoundary } from './ErrorBoundary'
import { setLayoutApi } from './layout'

function ResizeHandle({ orientation }: { orientation: 'horizontal' | 'vertical' }) {
  return (
    <Separator
      className={cn(
        'relative shrink-0 bg-line transition-colors duration-150 outline-none',
        'data-[separator=active]:bg-accent data-[separator=focus]:bg-accent data-[separator=hover]:bg-accent',
        orientation === 'horizontal' ? 'w-px' : 'h-px',
      )}
    />
  )
}

function LeftSidebar() {
  const t = useT()
  const tab = usePrefs((s) => s.leftTab)
  return (
    <Tabs<LeftTab>
      value={tab}
      onValueChange={(leftTab) => setPrefs({ leftTab })}
      items={[
        { value: 'layers', label: t.app.panels.layers },
        { value: 'assets', label: t.app.panels.assets },
        { value: 'history', label: t.app.panels.history },
      ]}
    >
      <TabPanel value="layers">
        <ErrorBoundary name="layers">
          <LayersPanel />
        </ErrorBoundary>
      </TabPanel>
      <TabPanel value="assets">
        <ErrorBoundary name="assets">
          <AssetsPanel />
        </ErrorBoundary>
      </TabPanel>
      <TabPanel value="history">
        <ErrorBoundary name="history">
          <HistoryPanel />
        </ErrorBoundary>
      </TabPanel>
    </Tabs>
  )
}

function IssuesBadge() {
  const { errors, warnings } = useIssueSummary()
  if (errors > 0) return <Badge tone="danger">{errors}</Badge>
  if (warnings > 0) return <Badge tone="warning">{warnings}</Badge>
  return null
}

function RightSidebar() {
  const t = useT()
  const tab = usePrefs((s) => s.rightTab)
  return (
    <Tabs<RightTab>
      value={tab}
      onValueChange={(rightTab) => setPrefs({ rightTab })}
      items={[
        { value: 'properties', label: t.app.panels.properties },
        { value: 'colors', label: t.app.panels.colors },
        { value: 'issues', label: t.app.panels.issues, badge: <IssuesBadge /> },
      ]}
    >
      <TabPanel value="properties">
        <ErrorBoundary name="inspector">
          <InspectorPanel />
        </ErrorBoundary>
      </TabPanel>
      <TabPanel value="colors">
        <ErrorBoundary name="colors">
          <ColorsPanel />
        </ErrorBoundary>
      </TabPanel>
      <TabPanel value="issues">
        <ErrorBoundary name="issues">
          <IssuesPanel />
        </ErrorBoundary>
      </TabPanel>
    </Tabs>
  )
}

function CenterPanel() {
  const t = useT()
  const view = usePrefs((s) => s.centerView)
  // Unapplied JSON edits stay visible from the canvas view as a dot on the JSON tab.
  const codeDraft = useHasCodeDraft()
  const showCanvas = view === 'canvas' || view === 'split'

  let body: ReactNode
  const canvas = (
    <ErrorBoundary name="viewport">
      <Viewport />
    </ErrorBoundary>
  )
  const code = (
    <ErrorBoundary name="code">
      <CodeView />
    </ErrorBoundary>
  )
  if (view === 'split') {
    body = (
      <Group orientation="horizontal" className="h-full">
        <Panel id="split-canvas" minSize={240}>
          {canvas}
        </Panel>
        <ResizeHandle orientation="horizontal" />
        <Panel id="split-code" minSize={280} defaultSize="45">
          {code}
        </Panel>
      </Group>
    )
  } else {
    body = showCanvas ? canvas : code
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-canvas">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-surface-1 px-1.5">
        <SegmentedControl<CenterView>
          value={view}
          onValueChange={(centerView) => setPrefs({ centerView })}
          aria-label={t.app.panels.viewMode}
          options={[
            { value: 'canvas', icon: Frame, label: t.app.panels.canvas },
            {
              value: 'code',
              icon: Code2,
              label: (
                <span className="relative">
                  {t.app.panels.code}
                  {codeDraft && view === 'canvas' && (
                    <span
                      className="absolute -top-0.5 -right-2 size-1.5 rounded-full bg-accent"
                      aria-hidden
                    />
                  )}
                </span>
              ),
              title: t.app.panels.code,
            },
            { value: 'split', icon: Columns2, title: t.app.panels.split },
          ]}
        />
        <div className="flex min-w-0 flex-1 items-center justify-end gap-0.5">
          {showCanvas && (
            <ErrorBoundary name="viewport-toolbar" compact>
              <ViewportToolbar />
            </ErrorBoundary>
          )}
          {view === 'code' && (
            <ErrorBoundary name="code-toolbar" compact>
              <CodeToolbar />
            </ErrorBoundary>
          )}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">{body}</div>
    </div>
  )
}

const storage = typeof window !== 'undefined' ? window.localStorage : undefined

export function Workspace() {
  const leftRef = usePanelRef()
  const rightRef = usePanelRef()
  const bottomRef = usePanelRef()
  const vertical = useDefaultLayout({ id: 'le-layout-v', storage })
  const horizontal = useDefaultLayout({ id: 'le-layout-h', storage })

  useEffect(() => {
    const toggle = (ref: typeof leftRef) => () => {
      const p = ref.current
      if (!p) return
      if (p.isCollapsed()) p.expand()
      else p.collapse()
    }
    setLayoutApi({
      toggleLeft: toggle(leftRef),
      toggleRight: toggle(rightRef),
      toggleBottom: toggle(bottomRef),
      isLeftCollapsed: () => leftRef.current?.isCollapsed() ?? false,
      isRightCollapsed: () => rightRef.current?.isCollapsed() ?? false,
      isBottomCollapsed: () => bottomRef.current?.isCollapsed() ?? false,
    })
    return () => setLayoutApi(null)
  }, [leftRef, rightRef, bottomRef])

  return (
    <Group
      orientation="vertical"
      className="min-h-0 flex-1"
      defaultLayout={vertical.defaultLayout}
      onLayoutChanged={vertical.onLayoutChanged}
    >
      <Panel id="main" minSize={200}>
        <Group
          orientation="horizontal"
          className="h-full"
          defaultLayout={horizontal.defaultLayout}
          onLayoutChanged={horizontal.onLayoutChanged}
        >
          <Panel
            id="left"
            panelRef={leftRef}
            defaultSize={264}
            minSize={200}
            maxSize={480}
            collapsible
            groupResizeBehavior="preserve-pixel-size"
            className="bg-surface-1"
          >
            <LeftSidebar />
          </Panel>
          <ResizeHandle orientation="horizontal" />
          <Panel id="center" minSize={320}>
            <CenterPanel />
          </Panel>
          <ResizeHandle orientation="horizontal" />
          <Panel
            id="right"
            panelRef={rightRef}
            defaultSize={304}
            minSize={260}
            maxSize={560}
            collapsible
            groupResizeBehavior="preserve-pixel-size"
            className="bg-surface-1"
          >
            <RightSidebar />
          </Panel>
        </Group>
      </Panel>
      <ResizeHandle orientation="vertical" />
      <Panel
        id="timeline"
        panelRef={bottomRef}
        defaultSize={280}
        minSize={140}
        collapsible
        groupResizeBehavior="preserve-pixel-size"
        className="bg-surface-1"
      >
        <ErrorBoundary name="timeline">
          <Timeline />
        </ErrorBoundary>
      </Panel>
    </Group>
  )
}
