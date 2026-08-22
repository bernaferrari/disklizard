/**
 * DiskLizard TUI — interactive terminal space map.
 * Shares scan/tree/format with Desktop via @disklizard/core.
 *
 * Engineer-grade UX: predictable keys, dense columns, no splash screens.
 */

import { homedir } from "node:os"
import { basename } from "node:path"
import { scanPath, getDrives } from "../scan"
import type { DiskNode } from "../types"
import { canDrill, findParent } from "../tree"
import { formatBytes } from "../format"
import {
  Ansi,
  clearScreen,
  restoreTerminal,
  renderTuiBars,
  renderTuiFooter,
  renderTuiHeader,
  renderTuiHelp,
} from "./render"

export type TuiOptions = {
  /** Initial path to scan; default first drive or $HOME */
  path?: string
  maxDepth?: number
  sizeMode?: "physical" | "logical"
}

type Mode = "browse" | "help"

export async function runDiskLizardTui(opts: TuiOptions = {}): Promise<void> {
  let target = opts.path
  if (!target) {
    const drives = await getDrives()
    target = drives[0]?.path ?? homedir()
  }

  const maxDepth = opts.maxDepth ?? 10
  let root: DiskNode | null = null
  let view: DiskNode | null = null
  let selected = 0
  let mode: Mode = "browse"
  let scanning = false
  let scanFiles = 0
  let scanRate = 0
  let helpOpen = false
  let statusLine = ""
  let running = true

  const stdin = process.stdin
  const wasRaw = stdin.isRaw

  function cols(): number {
    return process.stdout.columns || 80
  }

  function rows(): number {
    return process.stdout.rows || 24
  }

  async function doScan(path: string, label?: string) {
    scanning = true
    scanFiles = 0
    scanRate = 0
    statusLine = `scanning ${path}`
    draw()

    let lastF = 0
    let lastT = performance.now()

    try {
      const tree = await scanPath(path, {
        maxDepth,
        sizeMode: opts.sizeMode ?? "physical",
        useWorker: false, // TUI: in-process is fine; avoids eval worker issues in some shells
        progressIntervalMs: 150,
        onProgress: (p) => {
          scanFiles = p.filesScanned
          const now = performance.now()
          if (now - lastT > 400) {
            scanRate = Math.round((p.filesScanned - lastF) / ((now - lastT) / 1000))
            lastF = p.filesScanned
            lastT = now
            draw()
          }
        },
      })
      tree._label = label || basename(path) || path
      root = tree
      view = tree
      selected = 0
      statusLine = `mapped ${formatBytes(tree.size)}`
    } catch (err) {
      statusLine = `scan failed: ${err instanceof Error ? err.message : String(err)}`
    } finally {
      scanning = false
      draw()
    }
  }

  function currentItems(): DiskNode[] {
    if (!view) return []
    return renderTuiBars(view, { selected, cols: cols(), maxRows: Math.max(8, rows() - 10) }).items
  }

  function draw() {
    if (!running) return
    const c = cols()
    const maxRows = Math.max(8, rows() - 10)
    const lines: string[] = []

    lines.push(
      renderTuiHeader({
        title: view?._label || view?.name || "—",
        path: view?.path || target!,
        size: view?.size ?? 0,
        cols: c,
        scanning,
        files: scanFiles,
        rate: scanRate,
      }),
    )
    lines.push("")

    if (helpOpen || mode === "help") {
      lines.push(...renderTuiHelp(c))
    } else if (view) {
      const { lines: barLines } = renderTuiBars(view, { selected, cols: c, maxRows })
      lines.push(...barLines)
    } else if (scanning) {
      lines.push(`${Ansi.YELLOW}  ▸ scanning…${Ansi.RESET}`)
    }

    lines.push("")
    const hint =
      helpOpen
        ? "? close help · q quit"
        : "↑↓ move · enter open · esc up · r rescan · o path · ? help · q quit"
    lines.push(renderTuiFooter({ hint: statusLine ? `${statusLine}  ·  ${hint}` : hint, cols: c }))

    clearScreen()
    process.stdout.write(lines.join("\n"))
  }

  function goUp() {
    if (!root || !view) return
    if (view.path === root.path) {
      running = false
      cleanup()
      process.exit(0)
    }
    const parent = findParent(root, view.path)
    if (parent) {
      view = parent
      selected = 0
      statusLine = parent._label || parent.name
      draw()
    }
  }

  function drill() {
    const items = currentItems()
    const node = items[selected]
    if (!node) return
    if (canDrill(node)) {
      view = node
      selected = 0
      statusLine = node.name
      draw()
    } else {
      statusLine = node.path
      draw()
    }
  }

  async function onKey(key: string, ctrl: boolean) {
    if (!running) return

    if (key === "q" || (ctrl && key === "c")) {
      running = false
      cleanup()
      process.exit(0)
    }

    if (key === "?") {
      helpOpen = !helpOpen
      mode = helpOpen ? "help" : "browse"
      draw()
      return
    }

    if (helpOpen) {
      if (key === "escape" || key === "esc") {
        helpOpen = false
        mode = "browse"
        draw()
      }
      return
    }

    if (scanning) return

    switch (key) {
      case "up":
      case "k":
        selected = Math.max(0, selected - 1)
        draw()
        break
      case "down":
      case "j":
        selected = Math.min(Math.max(0, currentItems().length - 1), selected + 1)
        draw()
        break
      case "return":
      case "enter":
      case "l":
        drill()
        break
      case "backspace":
      case "h":
      case "escape":
      case "esc":
        goUp()
        break
      case "r":
        if (root) void doScan(root.path, root._label)
        break
      case "o": {
        const items = currentItems()
        const node = items[selected]
        if (node) {
          process.stderr.write(`\n${node.path}\n`)
          statusLine = "path printed to stderr"
          draw()
        }
        break
      }
      case "d": {
        statusLine = "The terminal browser is read-only. Review and move items to Trash in the desktop app."
        draw()
        break
      }
    }
  }

  function cleanup() {
    restoreTerminal()
    if (stdin.isTTY) {
      try {
        stdin.setRawMode(wasRaw ?? false)
      } catch {
        /* ignore */
      }
    }
    stdin.removeAllListeners("data")
    stdin.pause()
  }

  // Key input via raw mode
  if (stdin.isTTY) {
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding("utf8")
  }

  stdin.on("data", (buf: string | Buffer) => {
    const s = typeof buf === "string" ? buf : buf.toString("utf8")
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]
      const code = ch.charCodeAt(0)

      if (code === 3) {
        void onKey("c", true)
        continue
      }
      if (code === 27) {
        // escape sequence
        const rest = s.slice(i)
        if (rest.startsWith("\x1b[A")) {
          void onKey("up", false)
          i += 2
        } else if (rest.startsWith("\x1b[B")) {
          void onKey("down", false)
          i += 2
        } else if (rest.startsWith("\x1b[C")) {
          void onKey("l", false)
          i += 2
        } else if (rest.startsWith("\x1b[D")) {
          void onKey("h", false)
          i += 2
        } else {
          void onKey("escape", false)
        }
        continue
      }
      if (code === 13 || code === 10) {
        void onKey("enter", false)
        continue
      }
      if (code === 127 || code === 8) {
        void onKey("backspace", false)
        continue
      }
      void onKey(ch, false)
    }
  })

  process.on("SIGINT", () => {
    running = false
    cleanup()
    process.exit(0)
  })

  process.on("resize", () => draw())

  await doScan(target, basename(target) || target)
}
