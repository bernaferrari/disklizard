/**
 * DiskLizard — the disk utility built into OpenCode.
 *
 * A DaisyDisk-inspired sunburst map (rendered in OKLCH) paired with a ranked list,
 * all in OpenCode's theme. The signature trick: a "Reclaim" engine that recognizes
 * well-known space hogs (node_modules, caches, build output, Trash…) and surfaces a
 * live, non-double-counted total of space you can get back — with one-tap review.
 *
 * Motion is hand-rolled springs (motion.ts) + the canvas engine's own rAF physics.
 */

import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { showToast } from "@opencode-ai/ui/toast"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, untrack } from "solid-js"
import { usePlatform, type DiskDriveInfo, type DiskScanNode } from "@/context/platform"
import { Sunburst, primarySegmentColor } from "./sunburst"
import { createSpring, animateCount, MOTION } from "./motion"
import { computeReclaim, recognize, type ReclaimSummary } from "./recognize"
import { formatBytes, shortBytes, formatPct, formatCount, truncatePath } from "./format"
import { DRIVE_ACCENT, SAFETY_ACCENT, usageTone, usageStroke } from "./ui-tokens"

type ViewMode = "drives" | "scan"
type ScanMode = "map" | "list"
type Crumb = { name: string; path: string; node?: DiskScanNode }
type Entry = { node: DiskScanNode; index: number }

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const { promise: timed, resolve, reject } = Promise.withResolvers<T>()
  const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  promise.then(
    (v) => {
      clearTimeout(timer)
      resolve(v)
    },
    (e) => {
      clearTimeout(timer)
      reject(e)
    },
  )
  return timed
}

function buildCrumbs(root: DiskScanNode | null, view: DiskScanNode | null): Crumb[] {
  if (!root || !view) return []
  const crumbs: Crumb[] = [{ name: root._label || root.name || root.path, path: root.path, node: root }]
  if (view.path === root.path) return crumbs
  const parts = view.path.replace(root.path, "").split(/[/\\]/).filter(Boolean)
  let walk: DiskScanNode | undefined = root
  let acc = root.path
  for (const part of parts) {
    acc = acc.endsWith("/") || acc.endsWith("\\") ? acc + part : acc + "/" + part
    const child: DiskScanNode | undefined = walk?.children?.find((c) => c.name === part || c.path === acc)
    if (!child) break
    walk = child
    crumbs.push({ name: child.name, path: child.path, node: child })
  }
  return crumbs
}

export default function DiskUtilityPage() {
  const platform = usePlatform()
  const isDesktop = () => platform.platform === "desktop"
  const disk = () => (platform.platform === "desktop" ? platform.diskUtility : undefined)

  const [view, setView] = createSignal<ViewMode>("drives")
  const [scanMode, setScanMode] = createSignal<ScanMode>("map")
  const [drives, setDrives] = createSignal<DiskDriveInfo[]>([])
  const [drivesLoading, setDrivesLoading] = createSignal(false)
  const [drivesError, setDrivesError] = createSignal<string>()
  const [selectedDrive, setSelectedDrive] = createSignal<string>()

  const [treeRoot, setTreeRoot] = createSignal<DiskScanNode | null>(null)
  const [viewNode, setViewNode] = createSignal<DiskScanNode | null>(null)
  const [scanLabel, setScanLabel] = createSignal("")
  const [scanning, setScanning] = createSignal(false)
  const [scanFiles, setScanFiles] = createSignal(0)
  const [scanTotal, setScanTotal] = createSignal(0)
  const [scanPct, setScanPct] = createSignal(0)
  const [scanBytes, setScanBytes] = createSignal(0)
  const [scanTail, setScanTail] = createSignal("")
  const [selectedPath, setSelectedPath] = createSignal<string>()
  const [hoveredPath, setHoveredPath] = createSignal<string | null>(null)
  const [focusIdx, setFocusIdx] = createSignal(0)
  const [pendingDelete, setPendingDelete] = createSignal<DiskScanNode | null>(null)
  const [deleting, setDeleting] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [reviewOpen, setReviewOpen] = createSignal(false)
  const [reclaimDisplay, setReclaimDisplay] = createSignal(0)

  const [canvasEl, setCanvasEl] = createSignal<HTMLCanvasElement | undefined>()
  const [sunburst, setSunburst] = createSignal<Sunburst | undefined>()
  let scanUnsub: (() => void) | undefined
  let scanToken = 0

  const crumbs = createMemo(() => buildCrumbs(treeRoot(), viewNode()))
  const reclaim = createMemo<ReclaimSummary>(() => computeReclaim(treeRoot()))
  const parentSize = createMemo(() => viewNode()?.size ?? 0)
  const parentCount = createMemo(() => viewNode()?.children?.length ?? 0)

  const sortedChildren = createMemo<DiskScanNode[]>(() => {
    const node = viewNode()
    if (!node) return []
    return [...(node.children ?? [])].sort((a, b) => b.size - a.size)
  })
  const entries = createMemo<Entry[]>(() => {
    const q = query().trim().toLowerCase()
    const list = sortedChildren().map((node, index) => ({ node, index }))
    return q ? list.filter(({ node }) => node.name.toLowerCase().includes(q)) : list
  })
  const selectedNode = createMemo(() => {
    const path = selectedPath()
    if (!path) return null
    return sortedChildren().find((n) => n.path === path) ?? null
  })

  /** The node the sunburst center + list header should describe right now. */
  const focusNode = createMemo<DiskScanNode | null>(() => {
    const h = hoveredPath()
    if (h) {
      const hit = sortedChildren().find((n) => n.path === h)
      if (hit) return hit
    }
    const s = selectedNode()
    if (s) return s
    return viewNode()
  })

  // Animated count-up for the reclaim total.
  createEffect(() => {
    const total = reclaim().totalBytes
    if (total <= 0) {
      setReclaimDisplay(0)
      return
    }
    const from = untrack(() => reclaimDisplay()) || 0
    const cancel = animateCount(from, total, 700, setReclaimDisplay)
    onCleanup(cancel)
  })

  onMount(() => {
    if (disk()) void loadDrives()
  })

  // (Re)create the sunburst when its canvas mounts.
  createEffect(() => {
    const el = canvasEl()
    if (!el) {
      setSunburst(undefined)
      return
    }
    const sb = new Sunburst(el, {
      onHover: (seg) => setHoveredPath(seg?.path ?? null),
      onClick: (seg) => {
        selectPath(seg.path)
        if (seg.node.isDir && !seg.node.isOther && seg.node.children?.length) {
          setTimeout(() => drill(seg.node), 40)
        }
      },
      onCenterClick: () => goUp(),
    })
    const root = treeRoot()
    if (root) sb.setData(root, viewNode())
    setSunburst(sb)
    onCleanup(() => {
      sb.destroy()
      setSunburst((cur) => (cur === sb ? undefined : cur))
    })
  })

  // Re-feed data when a fresh scan completes while the canvas is already mounted.
  createEffect(() => {
    const root = treeRoot()
    const sb = sunburst()
    if (root && sb && sb.root !== root) sb.setData(root, viewNode())
  })

  onCleanup(() => {
    scanUnsub?.()
    sunburst()?.destroy()
  })

  async function loadDrives() {
    const api = disk()
    if (!api) return
    setDrivesLoading(true)
    setDrivesError(undefined)
    try {
      const list = await withTimeout(api.getDrives(), 8000, "Listing drives")
      setDrives(list)
      if (!selectedDrive() && list[0]) setSelectedDrive(list[0].path)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setDrivesError(message)
      setDrives([{ path: "/", name: "System", label: "System (/)", total: 0, free: 0, used: 0, type: "local" }])
      showToast({ variant: "error", title: "Could not list drives", description: message })
    } finally {
      setDrivesLoading(false)
    }
  }

  async function chooseAndScan() {
    const api = disk()
    if (!api) return
    const path = await api.chooseFolder()
    if (path) await startScan(path, path.split(/[/\\]/).pop() || path)
  }

  async function startScan(path: string, label: string, total = 0) {
    const api = disk()
    if (!api) return
    scanUnsub?.()
    const token = ++scanToken
    setView("scan")
    setScanLabel(label)
    setScanTotal(total)
    setScanning(true)
    setScanFiles(0)
    setScanPct(0)
    setScanBytes(0)
    setScanTail("")
    setTreeRoot(null)
    setViewNode(null)
    setSelectedPath(undefined)
    setHoveredPath(null)
    setQuery("")
    setFocusIdx(0)
    scanUnsub = api.onScanProgress((p) => {
      if (token !== scanToken) return
      setScanFiles(p.filesScanned)
      setScanTail(truncatePath(p.currentPath, 56))
      if (p.size > 0) {
        setScanBytes(p.size)
        if (total > 0) setScanPct(Math.min(99, (p.size / total) * 100))
      }
    })
    try {
      const tree = await api.scanPath(path, { maxDepth: 9 })
      if (token !== scanToken) return // superseded or cancelled
      tree._label = label
      setScanPct(100)
      setTreeRoot(tree)
      setViewNode(tree)
    } catch (err) {
      if (token !== scanToken) return
      const message = err instanceof Error ? err.message : String(err)
      showToast({ variant: "error", title: "Scan failed", description: message })
      setView("drives")
    } finally {
      if (token === scanToken) {
        setScanning(false)
        scanUnsub?.()
        scanUnsub = undefined
      }
    }
  }

  /** Abort the in-flight scan: invalidate its token and return to the volume list. */
  function cancelScan() {
    scanToken++
    scanUnsub?.()
    scanUnsub = undefined
    setScanning(false)
    backToDrives()
  }

  function drill(node: DiskScanNode) {
    if (scanning() || !node.isDir || node.isOther) return
    sunburst()?.navigateTo(node)
    setViewNode(node)
    setSelectedPath(undefined)
    setHoveredPath(null)
    setQuery("")
    setFocusIdx(0)
  }

  function goUp() {
    if (scanning()) {
      cancelScan()
      return
    }
    const list = crumbs()
    if (list.length <= 1) {
      backToDrives()
      return
    }
    const parent = list[list.length - 2]
    if (parent?.node) {
      sunburst()?.navigateTo(parent.node)
      setViewNode(parent.node)
      setSelectedPath(undefined)
      setHoveredPath(null)
      setFocusIdx(0)
    } else {
      backToDrives()
    }
  }

  function backToDrives() {
    setView("drives")
    setTreeRoot(null)
    setViewNode(null)
    setSelectedPath(undefined)
    setHoveredPath(null)
    void loadDrives()
  }

  function goToCrumb(crumb: Crumb) {
    if (crumb.node && !scanning()) {
      sunburst()?.navigateTo(crumb.node)
      setViewNode(crumb.node)
      setSelectedPath(undefined)
      setHoveredPath(null)
      setFocusIdx(0)
    }
  }

  function selectPath(path: string) {
    setSelectedPath(path)
    sunburst()?.setSelected(path)
    const idx = entries().findIndex((e) => e.node.path === path)
    if (idx >= 0) setFocusIdx(idx)
  }

  function hoverEntry(path: string | null) {
    setHoveredPath(path)
    sunburst()?.setHighlight(path)
  }

  function moveFocus(delta: number) {
    const list = entries()
    if (!list.length) return
    let i = focusIdx() + delta
    if (i < 0) i = list.length - 1
    if (i >= list.length) i = 0
    setFocusIdx(i)
    selectPath(list[i].node.path)
  }

  function openFocused() {
    const node = selectedNode()
    if (!node) return
    if (node.isDir && !node.isOther) drill(node)
  }

  async function reveal(path: string) {
    const api = disk()
    if (!api) return
    try {
      await api.revealPath(path)
    } catch (err) {
      showToast({ variant: "error", title: "Could not reveal", description: err instanceof Error ? err.message : String(err) })
    }
  }

  async function trashNode(node: DiskScanNode) {
    const api = disk()
    if (!api) return
    setDeleting(true)
    try {
      await api.deletePath(node.path)
      showToast({ variant: "success", title: "Moved to trash", description: node.name })
      const root = treeRoot()
      if (root) await startScan(root.path, scanLabel())
    } catch (err) {
      showToast({ variant: "error", title: "Delete failed", description: err instanceof Error ? err.message : String(err) })
    } finally {
      setDeleting(false)
    }
  }

  async function confirmDelete() {
    const node = pendingDelete()
    if (!node) return
    setPendingDelete(null)
    await trashNode(node)
  }

  // Keyboard navigation
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA") return
      if (pendingDelete()) {
        if (e.key === "Escape") setPendingDelete(null)
        if (e.key === "Enter") void confirmDelete()
        return
      }
      if (view() !== "scan") return
      if (scanning()) {
        if (e.key === "Escape" || e.key === "Backspace") {
          e.preventDefault()
          cancelScan()
        }
        return
      }
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault()
        moveFocus(1)
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault()
        moveFocus(-1)
      } else if (e.key === "Enter") {
        e.preventDefault()
        openFocused()
      } else if (e.key === "Escape" || e.key === "Backspace") {
        e.preventDefault()
        goUp()
      } else if (e.key === "Delete") {
        e.preventDefault()
        const node = selectedNode()
        if (node) setPendingDelete(node)
      } else if (e.key === "r" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        const root = treeRoot()
        if (root) void startScan(root.path, scanLabel())
      } else if (e.key === "1") {
        setScanMode("map")
      } else if (e.key === "2") {
        setScanMode("list")
      }
    }
    document.addEventListener("keydown", onKey)
    onCleanup(() => document.removeEventListener("keydown", onKey))
  })

  return (
    <div class="isolate flex size-full min-h-0 flex-col bg-background-base text-text-base font-(family-name:--font-family-text)">
      <style>{KEYFRAMES}</style>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header class="relative z-20 shrink-0 border-b border-border-weaker-base bg-background-base/80 backdrop-blur-md">
        <div class="flex items-center justify-between gap-3 px-4 py-2.5">
          <div class="flex min-w-0 items-center gap-2.5">
            <div class="grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[oklch(0.72_0.17_270)] to-[oklch(0.62_0.2_210)] text-white shadow-sm">
              <Icon name="dot-grid" class="size-3.5" />
            </div>
            <div class="min-w-0">
              <h1 class="text-13-semibold leading-tight text-text-strong">DiskLizard</h1>
              <Show when={view() === "scan" && scanLabel()}>
                <p class="truncate text-11-regular leading-tight text-text-weak">{scanLabel()}</p>
              </Show>
            </div>
            <Show when={view() === "drives" && disk()}>
              <Button variant="secondary" size="small" icon="reset" onClick={() => void loadDrives()} disabled={drivesLoading()}>
                Refresh
              </Button>
            </Show>
            <Show when={view() === "scan"}>
              <Button variant="secondary" size="small" icon="chevron-left" onClick={goUp}>
                {crumbs().length <= 1 ? "Volumes" : "Back"}
              </Button>
            </Show>
          </div>

          <div class="flex shrink-0 items-center gap-2">
            <Show when={view() === "scan" && !scanning()}>
              <div class="flex items-center gap-0.5 rounded-md bg-surface-raised-base p-0.5 ring-1 ring-inset ring-border-weaker-base">
                <SegmentedButton active={scanMode() === "map"} onClick={() => setScanMode("map")} icon="dot-grid" label="Map" />
                <SegmentedButton active={scanMode() === "list"} onClick={() => setScanMode("list")} icon="bullet-list" label="List" />
              </div>
              <div class="flex items-center gap-1.5 rounded-md bg-surface-raised-base px-2 py-1 ring-1 ring-inset ring-border-weaker-base">
                <Icon name="magnifying-glass" class="size-3 text-icon-weak" />
                <input
                  type="search"
                  placeholder="Filter"
                  value={query()}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                  class="w-24 bg-transparent text-12-regular text-text-strong placeholder:text-text-weak outline-none"
                />
              </div>
              <Button variant="secondary" size="small" icon="reset" onClick={() => treeRoot() && void startScan(treeRoot()!.path, scanLabel())}>
                Rescan
              </Button>
            </Show>
            <Show when={view() === "drives" && disk()}>
              <Button variant="secondary" size="small" onClick={() => void chooseAndScan()}>
                Choose folder…
              </Button>
            </Show>
          </div>
        </div>

        {/* Breadcrumbs */}
        <Show when={view() === "scan" && crumbs().length > 0}>
          <nav class="flex min-w-0 items-center gap-0.5 overflow-x-auto px-4 pb-2 text-11-regular" aria-label="Path">
            <For each={crumbs()}>
              {(crumb, i) => (
                <>
                  <Show when={i() > 0}>
                    <Icon name="chevron-right" class="size-3 shrink-0 text-text-weaker" />
                  </Show>
                  <button
                    type="button"
                    class="max-w-[180px] shrink-0 truncate rounded px-1.5 py-0.5 text-text-weak transition-colors hover:bg-surface-raised-base hover:text-text-strong"
                    classList={{ "text-text-strong": i() === crumbs().length - 1 }}
                    onClick={() => goToCrumb(crumb)}
                  >
                    {crumb.name}
                  </button>
                </>
              )}
            </For>
          </nav>
        </Show>
      </header>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div class="relative min-h-0 flex-1 overflow-hidden">
        <Show
          when={isDesktop()}
          fallback={<Placeholder icon="folder" title="Desktop app required" body="Disk scanning needs the OpenCode desktop app." />}
        >
          <Show
            when={disk()}
            fallback={<Placeholder icon="folder" title="Disk API unavailable" body="Restart the desktop app — the IPC bridge is not connected." />}
          >
            {/* ── DRIVES ── */}
            <Show when={view() === "drives"}>
              <ScrollView class="h-full">
                <div class="mx-auto w-full max-w-5xl px-5 py-6">
                  <Show when={drivesLoading()}>
                    <div class="mb-4 flex items-center gap-2 text-12-regular text-text-weak">
                      <span class="dl-spin size-3.5 rounded-full border-2 border-border-weaker-base border-t-text-strong" />
                      Loading volumes…
                    </div>
                  </Show>
                  <Show when={drivesError()}>
                    <div class="mb-4 rounded-lg border border-border-weaker-base bg-surface-panel px-3 py-2 text-12-regular text-text-weak">
                      {drivesError()} — showing fallback.
                    </div>
                  </Show>

                  <div class="mb-3 flex items-center gap-2">
                    <span class="grid size-5 place-items-center rounded-md bg-surface-raised-base ring-1 ring-inset ring-border-weaker-base">
                      <Icon name="server" class="size-3 text-text-weak" />
                    </span>
                    <h2 class="text-12-semibold uppercase tracking-wider text-text-strong">Volumes</h2>
                    <span class="rounded-full bg-surface-raised-base px-1.5 py-0.5 text-10-semibold tabular-nums text-text-weak ring-1 ring-inset ring-border-weaker-base">
                      {drives().length}
                    </span>
                  </div>

                  <Show
                    when={drives().length > 0}
                    fallback={
                      <div class="rounded-xl border border-dashed border-border-weaker-base bg-surface-panel px-6 py-14 text-center text-13-regular text-text-weak">
                        No volumes found. Use <span class="text-text-strong">Choose folder…</span> to scan.
                      </div>
                    }
                  >
                    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <For each={drives()}>
                        {(drive) => <DriveCard drive={drive} onScan={() => void startScan(drive.path, drive.label || drive.name, drive.total)} />}
                      </For>
                    </div>
                  </Show>

                  <p class="mt-6 text-center text-11-regular text-text-weak">
                    Pick a volume or choose any folder. Everything runs locally — nothing leaves your machine.
                  </p>
                </div>
              </ScrollView>
            </Show>

            {/* ── SCAN ── */}
            <Show when={view() === "scan"}>
              <Show
                when={!scanning()}
                fallback={
                  <div class="flex h-full flex-col items-center justify-center gap-6 px-6">
                    <ScanProgress pct={scanTotal() > 0 ? scanPct() : null} />
                    <div class="max-w-md text-center">
                      <p class="text-14-semibold text-text-strong">Scanning {scanLabel()}</p>
                      <p class="mt-1.5 text-12-regular tabular-nums text-text-weak">
                        {formatCount(scanFiles())} items
                        {scanBytes() > 0 ? ` · ${shortBytes(scanBytes())}` : ""}
                      </p>
                      <p class="dl-tail mx-auto mt-2 max-w-lg truncate font-mono text-11-regular text-text-weaker">
                        {scanTail() || "warming up…"}
                      </p>
                    </div>
                    <Button variant="secondary" size="small" icon="chevron-left" onClick={cancelScan}>
                      Back to volumes
                    </Button>
                  </div>
                }
              >
                <div class="flex h-full flex-col">
                  {/* Reclaim banner */}
                  <Show when={reclaim().totalBytes > 0}>
                    <ReclaimBanner
                      bytes={reclaimDisplay()}
                      count={reclaim().totalCount}
                      onReview={() => setReviewOpen(true)}
                    />
                  </Show>

                  <div class="flex min-h-0 flex-1">
                    {/* MAP */}
                    <Show when={scanMode() === "map"}>
                      <div class="relative grid min-w-0 flex-1 place-items-center overflow-hidden p-4">
                        <div class="relative aspect-square w-full max-w-[min(100%,calc(100vh-15rem))]">
                          <canvas ref={(el: HTMLCanvasElement) => setCanvasEl(el)} class="absolute inset-0 h-full w-full" />
                          <CenterOverlay
                            node={focusNode()}
                            parentSize={parentSize()}
                          />
                        </div>
                      </div>
                    </Show>

                    {/* LIST */}
                    <aside
                      class="flex min-h-0 flex-col border-border-weaker-base bg-surface-panel/40"
                      classList={{
                        "w-[clamp(280px,28vw,360px)] shrink-0 border-l": scanMode() === "map",
                        "flex-1": scanMode() === "list",
                      }}
                    >
                      <div class="flex shrink-0 items-center gap-2 px-3 py-2.5">
                        <Icon name="bullet-list" class="size-3.5 text-text-weak" />
                        <h2 class="text-12-semibold uppercase tracking-wider text-text-strong">Largest</h2>
                        <span class="rounded-full bg-surface-raised-base px-1.5 py-0.5 text-10-semibold tabular-nums text-text-weak ring-1 ring-inset ring-border-weaker-base">
                          {formatCount(parentCount())}
                        </span>
                        <span class="ml-auto text-11-regular tabular-nums text-text-weak">{formatBytes(parentSize())}</span>
                      </div>
                      <ScrollView class="min-h-0 flex-1">
                        <Show
                          when={entries().length > 0}
                          fallback={
                            <div class="px-6 py-12 text-center text-13-regular text-text-weak">
                              {query() ? "No matching items." : "This folder is empty."}
                            </div>
                          }
                        >
                          <ul>
                            <For each={entries()}>
                              {(entry, i) => {
                                const rec = () => recognize(entry.node)
                                const pct = () => (parentSize() ? (entry.node.size / parentSize()) * 100 : 0)
                                const barW = () => Math.max(2, Math.min(100, pct()))
                                const isActive = () => selectedPath() === entry.node.path || (focusIdx() === i() && !selectedPath())
                                const isHover = () => hoveredPath() === entry.node.path
                                return (
                                  <li
                                    class="dl-row border-b border-border-weaker-base last:border-b-0"
                                    style={{ "animation-delay": `${Math.min(i(), 24) * 14}ms` }}
                                  >
                                    <div
                                      role="button"
                                      tabindex="0"
                                      class="group relative flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors hover:bg-surface-raised-base/50"
                                      classList={{ "bg-surface-raised-base/70": isActive() }}
                                      onClick={() => selectPath(entry.node.path)}
                                      onDblClick={() => drill(entry.node)}
                                      onMouseEnter={() => hoverEntry(entry.node.path)}
                                      onMouseLeave={() => hoverEntry(selectedPath() ?? null)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") drill(entry.node)
                                      }}
                                    >
                                      <span
                                        class="size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-white/20"
                                        style={{ background: primarySegmentColor(entry.index) }}
                                      />
                                      <div class="min-w-0 flex-1">
                                        <div class="flex items-center gap-1.5">
                                          <Icon
                                            name={entry.node.isDir ? "folder" : "code-lines"}
                                            class="size-3 shrink-0 text-icon-weak"
                                          />
                                          <span class="truncate text-12-semibold text-text-strong">{entry.node.name}</span>
                                          <Show when={rec().tag}>
                                            <span class={`shrink-0 rounded px-1.5 py-0.5 text-9-semibold uppercase tracking-wide ring-1 ring-inset ${SAFETY_ACCENT[rec().safety].pill}`}>
                                              {rec().tag}
                                            </span>
                                          </Show>
                                        </div>
                                        <div class="mt-1 flex items-center gap-2">
                                          <div class="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-raised-base ring-1 ring-inset ring-border-weaker-base">
                                            <div
                                              class="h-full rounded-full transition-[width] duration-300 ease-out"
                                              style={{ width: `${barW()}%`, background: primarySegmentColor(entry.index) }}
                                            />
                                          </div>
                                          <span class="shrink-0 text-10-regular tabular-nums text-text-weak">{formatPct(entry.node.size, parentSize())}</span>
                                        </div>
                                      </div>
                                      <span class="shrink-0 text-12-semibold tabular-nums text-text-strong">{shortBytes(entry.node.size)}</span>
                                      <Show when={entry.node.isDir && !entry.node.isOther}>
                                        <Button
                                          size="small"
                                          variant="ghost"
                                          icon="chevron-right"
                                          onClick={(e: MouseEvent) => {
                                            e.stopPropagation()
                                            drill(entry.node)
                                          }}
                                        />
                                      </Show>
                                      <Show when={isHover()}>
                                        <span class="absolute inset-y-0 left-0 w-0.5 rounded-full" style={{ background: primarySegmentColor(entry.index) }} />
                                      </Show>
                                    </div>
                                  </li>
                                )
                              }}
                            </For>
                          </ul>
                        </Show>
                      </ScrollView>
                    </aside>
                  </div>

                  {/* Detail / action bar */}
                  <Show when={selectedNode()}>
                    {(node) => <DetailBar node={node()} parentSize={parentSize()} onReveal={() => void reveal(node().path)} onOpen={() => drill(node())} onTrash={() => setPendingDelete(node())} />}
                  </Show>
                </div>
              </Show>
            </Show>
          </Show>
        </Show>
      </div>

      {/* ── Reclaim review drawer ── */}
      <Show when={reviewOpen()}>
        <ReclaimDrawer reclaim={reclaim()} onClose={() => setReviewOpen(false)} onTrash={(node) => void trashNode(node)} deleting={deleting()} />
      </Show>

      {/* ── Delete confirm ── */}
      <Show when={pendingDelete()}>
        {(node) => (
          <div class="fixed inset-0 z-50 grid place-items-center bg-background-base/70 p-4 backdrop-blur-sm dl-fade" onClick={() => !deleting() && setPendingDelete(null)}>
            <div class="dl-pop w-full max-w-md rounded-xl border border-border-weaker-base bg-surface-panel p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div class="flex items-start gap-3">
                <div class="grid size-9 shrink-0 place-items-center rounded-lg bg-[#da3633]/14 ring-1 ring-inset ring-[#f85149]/40">
                  <Icon name="trash" class="size-4 text-[#cf222e]" />
                </div>
                <div class="min-w-0 flex-1">
                  <h3 class="text-14-semibold text-text-strong">Move to trash?</h3>
                  <p class="mt-1 truncate text-13-regular text-text-strong">{node().name}</p>
                  <p class="mt-0.5 truncate font-mono text-11-regular text-text-weak">{node().path}</p>
                  <p class="mt-2 text-12-regular tabular-nums text-text-weak">{formatBytes(node().size)}</p>
                </div>
              </div>
              <div class="mt-5 flex justify-end gap-2">
                <Button size="small" variant="secondary" disabled={deleting()} onClick={() => setPendingDelete(null)}>Cancel</Button>
                <Button size="small" variant="primary" disabled={deleting()} icon="trash" onClick={() => void confirmDelete()}>
                  {deleting() ? "Moving…" : "Move to trash"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SegmentedButton(props: { active: boolean; onClick: () => void; icon: string; label: string }) {
  return (
    <button
      type="button"
      class="flex items-center gap-1 rounded px-2 py-1 text-11-semibold transition-colors"
      classList={{
        "bg-background-base text-text-strong shadow-sm ring-1 ring-inset ring-border-weaker-base": props.active,
        "text-text-weak hover:text-text-strong": !props.active,
      }}
      onClick={props.onClick}
    >
      <Icon name={props.icon as never} class="size-3" />
      {props.label}
    </button>
  )
}

function Placeholder(props: { icon: string; title: string; body: string }) {
  return (
    <div class="flex h-full items-center justify-center px-6">
      <div class="max-w-md text-center">
        <div class="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-surface-raised-base shadow-md">
          <Icon name={props.icon as never} class="size-5 text-text-weak" />
        </div>
        <h2 class="text-16-medium text-text-strong">{props.title}</h2>
        <p class="mt-2 text-13-regular text-text-weak">{props.body}</p>
      </div>
    </div>
  )
}

/** Circular scan-progress ring. `pct === null` → indeterminate (folder scan). */
function ScanProgress(props: { pct: number | null }) {
  const r = 52
  const circ = 2 * Math.PI * r
  const offset = () => (props.pct == null ? circ * 0.78 : circ * (1 - Math.min(100, props.pct) / 100))
  return (
    <div class="relative grid size-32 place-items-center">
      <svg viewBox="0 0 120 120" class="size-32 -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="oklch(0.6 0.01 0 / 0.12)" stroke-width="8" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="url(#dl-scan-grad)"
          stroke-width="8"
          stroke-linecap="round"
          stroke-dasharray={`${circ}`}
          stroke-dashoffset={`${offset()}`}
          style={{ transition: props.pct == null ? "none" : "stroke-dashoffset 0.3s ease-out" }}
        />
        <defs>
          <linearGradient id="dl-scan-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="oklch(0.72 0.17 270)" />
            <stop offset="100%" stop-color="oklch(0.62 0.2 210)" />
          </linearGradient>
        </defs>
      </svg>
      <div class="absolute text-center">
        <Show
          when={props.pct != null}
          fallback={<span class="dl-pulse mx-auto block size-2.5 rounded-full bg-[oklch(0.72_0.17_270)]" />}
        >
          <div class="text-20-medium leading-none tabular-nums text-text-strong">
            {Math.round(props.pct!)}
            <span class="ml-0.5 text-12-medium text-text-weak">%</span>
          </div>
        </Show>
        <div class="mt-1.5 text-9-regular uppercase tracking-wider text-text-weak">scanned</div>
      </div>
    </div>
  )
}

/** Center overlay for the sunburst — shows the focused node's identity + size. */
function CenterOverlay(props: { node: DiskScanNode | null; parentSize: number }) {
  const rec = () => (props.node ? recognize(props.node) : null)
  return (
    <div class="pointer-events-none absolute inset-0 grid place-items-center">
      <div class="max-w-[78%] text-center">
        <Show when={props.node}>
          <p class="truncate text-13-semibold text-text-strong">{props.node!.name}</p>
          <p class="mt-0.5 text-20-medium tabular-nums text-text-strong" style={{ "text-wrap": "balance" }}>
            {formatBytes(props.node!.size)}
          </p>
          <Show when={props.parentSize && props.node!.path}>
            <p class="mt-0.5 text-11-regular tabular-nums text-text-weak">{formatPct(props.node!.size, props.parentSize)} of folder</p>
          </Show>
          <Show when={rec()?.tag}>
            <span class={`mt-1.5 inline-block rounded px-1.5 py-0.5 text-9-semibold uppercase tracking-wide ring-1 ring-inset ${SAFETY_ACCENT[rec()!.safety].pill}`}>
              {rec()!.tag}
            </span>
          </Show>
        </Show>
      </div>
    </div>
  )
}

/** Drive card — click-to-scan, with a hero free-space figure. */
function DriveCard(props: { drive: DiskDriveInfo; onScan: () => void }) {
  const accent = () => DRIVE_ACCENT[props.drive.type] ?? DRIVE_ACCENT.local
  const hasTotal = () => props.drive.total > 0
  const usedPct = () => (hasTotal() ? (props.drive.used / props.drive.total) * 100 : 0)
  const freePct = () => (hasTotal() ? (props.drive.free / props.drive.total) * 100 : 0)
  // The free-space figure is the hero; color it by how little room is left.
  const freeColor = () =>
    freePct() < 10
      ? "text-[color-mix(in_oklch,#cf222e_70%,var(--text-strong))]"
      : freePct() < 25
        ? "text-[color-mix(in_oklch,#9a6700_70%,var(--text-strong))]"
        : "text-text-strong"
  const r = 26
  const c = 2 * Math.PI * r
  const progress = createSpring(0, MOTION.lush)

  onMount(() => {
    const id = setTimeout(() => progress.set(usedPct() / 100), 80)
    onCleanup(() => clearTimeout(id))
  })

  return (
    <div
      role="button"
      tabindex="0"
      onClick={props.onScan}
      onKeyDown={(e) => {
        if (e.key === "Enter") props.onScan()
      }}
      class="dl-card group relative flex cursor-pointer flex-col gap-4 overflow-hidden rounded-2xl border border-border-weaker-base bg-surface-panel p-5 outline-none transition-all hover:-translate-y-0.5 hover:border-border-base hover:shadow-xl focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.15_270/0.6)]"
    >
      <div class="flex items-center gap-4">
        <div class="relative grid size-16 shrink-0 place-items-center">
          <svg viewBox="0 0 64 64" class="size-16 -rotate-90">
            <circle cx="32" cy="32" r={r} fill="none" stroke="oklch(0.6 0.01 0 / 0.12)" stroke-width="6" />
            <circle
              cx="32"
              cy="32"
              r={r}
              fill="none"
              stroke={hasTotal() ? usageStroke(props.drive.used, props.drive.total) : accent().stroke}
              stroke-width="6"
              stroke-linecap="round"
              stroke-dasharray={`${c}`}
              stroke-dashoffset={`${c * (1 - progress())}`}
            />
          </svg>
          <div class="absolute text-11-semibold tabular-nums text-text-weak">
            {hasTotal() ? `${Math.round(usedPct())}%` : "—"}
          </div>
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class={`size-1.5 shrink-0 rounded-full ${accent().dot}`} />
            <span class="truncate text-14-semibold text-text-strong">{props.drive.name}</span>
          </div>
          <p class="mt-1 truncate text-11-regular text-text-weak">
            {hasTotal() ? props.drive.path : "Ready to scan"}
          </p>
        </div>
      </div>

      <Show when={hasTotal()}>
        <div class="flex items-end justify-between gap-3 border-t border-border-weaker-base pt-3">
          <div>
            <p class={`text-20-medium leading-none tabular-nums ${freeColor()}`}>{formatBytes(props.drive.free)}</p>
            <p class="mt-1.5 text-11-regular tabular-nums text-text-weak">
              free of {formatBytes(props.drive.total)}
            </p>
          </div>
          <span
            class={`shrink-0 rounded-full px-2 py-1 text-10-semibold tabular-nums ring-1 ring-inset ${usageTone(props.drive.used, props.drive.total)}`}
          >
            {formatBytes(props.drive.used)} used
          </span>
        </div>
      </Show>

      <div class="flex items-center justify-center gap-1 text-12-semibold text-text-weak transition-colors group-hover:text-text-strong">
        <Icon name="dot-grid" class="size-3.5" />
        Scan
        <Icon name="chevron-right" class="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
    </div>
  )
}

/** The reclaimable-space banner — the wow feature. */
function ReclaimBanner(props: { bytes: number; count: number; onReview: () => void }) {
  return (
    <div class="dl-shimmer relative shrink-0 overflow-hidden border-b border-[oklch(0.72_0.17_145/0.3)] bg-[oklch(0.72_0.17_145/0.08)]">
      <div class="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
        <div class="grid size-7 shrink-0 place-items-center rounded-md bg-[oklch(0.72_0.17_145/0.16)] ring-1 ring-inset ring-[#3fb950]/40">
          <Icon name="models" class="size-3.5 text-[#1a7f37]" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-12-semibold text-text-strong">
            <span class="tabular-nums">{formatBytes(props.bytes)}</span> reclaimable
          </p>
          <p class="truncate text-10-regular text-text-weak">
            Across {formatCount(props.count)} regenerable caches, build outputs & dependencies — safe to clear.
          </p>
        </div>
        <Button size="small" variant="secondary" icon="chevron-right" onClick={props.onReview}>
          Review
        </Button>
      </div>
    </div>
  )
}

/** Detail / action bar pinned under the scan results. */
function DetailBar(props: {
  node: DiskScanNode
  parentSize: number
  onReveal: () => void
  onOpen: () => void
  onTrash: () => void
}) {
  const rec = () => recognize(props.node)
  return (
    <div class="dl-slide-up shrink-0 border-t border-border-weaker-base bg-background-base px-4 py-2.5">
      <div class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-2.5">
          <Icon name={props.node.isDir ? "folder" : "code-lines"} class="size-4 shrink-0 text-icon-weak" />
          <div class="min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="truncate text-13-semibold text-text-strong">{props.node.name}</span>
              <Show when={rec().tag}>
                <span class={`shrink-0 rounded px-1.5 py-0.5 text-9-semibold uppercase tracking-wide ring-1 ring-inset ${SAFETY_ACCENT[rec().safety].pill}`}>
                  {rec().tag}
                </span>
              </Show>
            </div>
            <p class="truncate font-mono text-10-regular text-text-weak">{props.node.path}</p>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <span class="text-13-semibold tabular-nums text-text-strong">{formatBytes(props.node.size)}</span>
          <span class="text-10-regular tabular-nums text-text-weak">{formatPct(props.node.size, props.parentSize)}</span>
          <Show when={rec().hint}>
            <span class="hidden text-10-regular text-text-weak sm:inline">· {rec().hint}</span>
          </Show>
          <Show when={props.node.isDir && !props.node.isOther}>
            <Button size="small" variant="secondary" icon="enter" onClick={props.onOpen}>Open</Button>
          </Show>
          <Button size="small" variant="secondary" icon="square-arrow-top-right" onClick={props.onReveal}>Reveal</Button>
          <Button size="small" variant="secondary" icon="trash" onClick={props.onTrash}>Trash</Button>
        </div>
      </div>
    </div>
  )
}

/** Slide-over drawer reviewing reclaimable items by category. */
function ReclaimDrawer(props: {
  reclaim: ReclaimSummary
  onClose: () => void
  onTrash: (node: DiskScanNode) => void
  deleting: boolean
}) {
  return (
    <div class="fixed inset-0 z-40 flex justify-end" onClick={props.onClose}>
      <div class="dl-fade absolute inset-0 bg-background-base/60 backdrop-blur-sm" />
      <div
        class="dl-drawer relative flex h-full w-full max-w-md flex-col border-l border-border-weaker-base bg-surface-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="flex shrink-0 items-center gap-2 border-b border-border-weaker-base px-4 py-3">
          <Icon name="models" class="size-4 text-[#1a7f37]" />
          <h2 class="text-14-semibold text-text-strong">Reclaim space</h2>
          <span class="rounded-full bg-[#238636]/14 px-1.5 py-0.5 text-10-semibold tabular-nums text-[color-mix(in_oklch,#1a7f37_62%,var(--text-strong))] ring-1 ring-inset ring-[#3fb950]/45">
            {formatBytes(props.reclaim.totalBytes)}
          </span>
          <Button class="ml-auto" size="small" variant="ghost" icon="close" onClick={props.onClose} />
        </div>
        <ScrollView class="min-h-0 flex-1">
          <div class="p-3">
            <For each={props.reclaim.buckets}>
              {(bucket) => (
                <section class="mb-4">
                  <header class="mb-1.5 flex items-center gap-2 px-1">
                    <span class={`size-2 rounded-full ${SAFETY_ACCENT[bucket.safety].dot}`} />
                    <h3 class="text-11-semibold uppercase tracking-wider text-text-strong">
                      {bucket.safety.replace("-", " ")}
                    </h3>
                    <span class="ml-auto text-11-regular tabular-nums text-text-weak">{formatBytes(bucket.bytes)}</span>
                  </header>
                  <ul class="overflow-hidden rounded-lg border border-border-weaker-base bg-background-base">
                    <For each={bucket.items}>
                      {(item) => (
                        <li class="flex items-center gap-2 border-b border-border-weaker-base px-2.5 py-2 last:border-b-0">
                          <Icon name={item.node.isDir ? "folder" : "code-lines"} class="size-3.5 shrink-0 text-icon-weak" />
                          <div class="min-w-0 flex-1">
                            <p class="truncate text-12-semibold text-text-strong">{item.node.name}</p>
                            <p class="truncate font-mono text-10-regular text-text-weak">{truncatePath(item.node.path, 44)}</p>
                          </div>
                          <span class="shrink-0 text-11-semibold tabular-nums text-text-strong">{shortBytes(item.node.size)}</span>
                          <Button
                            size="small"
                            variant="ghost"
                            icon="trash"
                            disabled={props.deleting}
                            onClick={() => props.onTrash(item.node)}
                          />
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              )}
            </For>
            <p class="mt-2 px-1 text-10-regular text-text-weak">
              DiskLizard recognizes these as regenerable. Items move to trash — restore if needed.
            </p>
          </div>
        </ScrollView>
      </div>
    </div>
  )
}

const KEYFRAMES = `
.dl-row { animation: dl-rise 0.34s cubic-bezier(0.22,1,0.36,1) both; }
.dl-card { animation: dl-rise 0.4s cubic-bezier(0.22,1,0.36,1) both; }
.dl-fade { animation: dl-fade 0.18s ease-out both; }
.dl-pop { animation: dl-pop 0.26s cubic-bezier(0.22,1,0.36,1) both; }
.dl-slide-up { animation: dl-slide-up 0.3s cubic-bezier(0.22,1,0.36,1) both; }
.dl-drawer { animation: dl-drawer 0.32s cubic-bezier(0.22,1,0.36,1) both; }
.dl-spin { animation: dl-spin 0.8s linear infinite; }
.dl-pulse { animation: dl-pulse 1.4s ease-in-out infinite; }
.dl-tail { animation: dl-fade 0.4s ease-out; }
.dl-shimmer::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(100deg, transparent 30%, oklch(1 0 0 / 0.06) 50%, transparent 70%);
  animation: dl-sheen 3.2s ease-in-out infinite; pointer-events: none;
}
@keyframes dl-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes dl-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes dl-pop { from { opacity: 0; transform: scale(0.96) translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes dl-slide-up { from { opacity: 0; transform: translateY(100%); } to { opacity: 1; transform: none; } }
@keyframes dl-drawer { from { transform: translateX(100%); } to { transform: none; } }
@keyframes dl-spin { to { transform: rotate(360deg); } }
@keyframes dl-pulse { 0%,100% { transform: scale(1); opacity: 0.9; } 50% { transform: scale(1.12); opacity: 1; } }
@keyframes dl-sheen { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
@media (prefers-reduced-motion: reduce) {
  .dl-row,.dl-card,.dl-fade,.dl-pop,.dl-slide-up,.dl-drawer,.dl-pulse,.dl-shimmer::after { animation: none !important; }
}
`
