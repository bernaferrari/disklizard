/**
 * Terminal rendering primitives — no GUI deps.
 * SpaceX-grade: dense information, zero ornamentation, predictable columns.
 */

import type { DiskNode } from "../types"
import { formatBytes, formatPct, pad, truncate } from "../format"
import { sortedChildren } from "../tree"

const RESET = "\x1b[0m"
const DIM = "\x1b[2m"
const BOLD = "\x1b[1m"
const CYAN = "\x1b[36m"
const GREEN = "\x1b[32m"
const YELLOW = "\x1b[33m"
const RED = "\x1b[31m"
const MAGENTA = "\x1b[35m"
const BLUE = "\x1b[34m"
const INVERSE = "\x1b[7m"
const HIDE_CURSOR = "\x1b[?25l"
const SHOW_CURSOR = "\x1b[?25h"
const CLEAR = "\x1b[2J\x1b[H"
const CLEAR_LINE = "\x1b[2K"

export const Ansi = { RESET, DIM, BOLD, CYAN, GREEN, YELLOW, RED, MAGENTA, BLUE, INVERSE, HIDE_CURSOR, SHOW_CURSOR, CLEAR, CLEAR_LINE }

const BLOCKS = " ▏▎▍▌▋▊▉█"
const BAR_COLORS = [CYAN, GREEN, BLUE, MAGENTA, YELLOW]

function bar(fraction: number, width: number): string {
  const f = Math.max(0, Math.min(1, fraction))
  const filled = f * width
  const full = Math.floor(filled)
  const rem = filled - full
  const partial = rem > 0 ? BLOCKS[Math.min(8, Math.ceil(rem * 8))] : ""
  const empty = Math.max(0, width - full - (partial ? 1 : 0))
  return "█".repeat(full) + partial + " ".repeat(empty)
}

function colorFor(i: number): string {
  return BAR_COLORS[i % BAR_COLORS.length]
}

export function renderTuiHeader(opts: {
  title: string
  path: string
  size: number
  cols: number
  scanning?: boolean
  files?: number
  rate?: number
}): string {
  const { title, path, size, cols, scanning, files, rate } = opts
  const line1 = `${BOLD}${CYAN}DISKLIZARD${RESET} ${DIM}· space map · opencode${RESET}`
  const status = scanning
    ? `${YELLOW}SCAN${RESET} ${(files ?? 0).toLocaleString()} files${rate ? ` ${DIM}${rate}/s${RESET}` : ""}`
    : `${GREEN}READY${RESET}`
  const line2 = `${status}  ${DIM}${truncate(path, Math.max(20, cols - 24))}${RESET}`
  const line3 = `${BOLD}${formatBytes(size)}${RESET}  ${DIM}${title}${RESET}`
  const rule = "─".repeat(Math.min(cols - 1, 72))
  return `${line1}\n${line2}\n${line3}\n${DIM}${rule}${RESET}`
}

export function renderTuiBars(
  node: DiskNode,
  opts: { selected: number; cols: number; maxRows?: number },
): { lines: string[]; items: DiskNode[] } {
  const items = sortedChildren(node)
  const maxRows = opts.maxRows ?? 24
  const shown = items.slice(0, maxRows)
  const total = node.size || 1
  const nameW = Math.max(16, Math.min(40, opts.cols - 36))
  const barW = Math.max(8, Math.min(28, opts.cols - nameW - 22))

  const clean: string[] = [
    `${DIM}${pad("", 2)}${pad("NAME", nameW - 2)} ${pad("SIZE", 9, "right")} ${pad("%", 6, "right")}  UTIL${RESET}`,
  ]

  shown.forEach((child, i) => {
    const sel = i === opts.selected
    const marker = sel ? `${GREEN}❯${RESET}` : " "
    const icon = child.isDir ? (child.isOther ? "⋯" : "▸") : "·"
    const name = truncate(`${icon} ${child.name}`, nameW - 2)
    const size = pad(formatBytes(child.size), 9, "right")
    const pct = pad(formatPct(child.size, total), 6, "right")
    const frac = child.size / total
    const col = colorFor(i)
    const b = `${col}${bar(frac, barW)}${RESET}`
    const body = `${marker} ${pad(name, nameW - 2)} ${DIM}${size}${RESET} ${pct}  ${b}`
    clean.push(sel ? `${BOLD}${body}${RESET}` : body)
  })

  if (items.length > maxRows) {
    clean.push(`${DIM}  … +${items.length - maxRows} more (drill into parent groups)${RESET}`)
  }
  if (!items.length) {
    clean.push(`${DIM}  (empty)${RESET}`)
  }

  return { lines: clean, items: shown }
}

export function renderTuiHelp(cols: number): string[] {
  const w = Math.min(cols - 2, 60)
  return [
    `${BOLD}CONTROLS${RESET}`,
    `${DIM}${"─".repeat(w)}${RESET}`,
    `  ${CYAN}↑↓ / jk${RESET}     move selection`,
    `  ${CYAN}enter / l${RESET}   drill into folder`,
    `  ${CYAN}backspace / h / esc${RESET}  parent (root → quit)`,
    `  ${CYAN}r${RESET}          rescan current path`,
    `  ${CYAN}o${RESET}          print full path (stdout)`,
    `  ${CYAN}d${RESET}          delete selected (confirm y/N)`,
    `  ${CYAN}?${RESET}          toggle help`,
    `  ${CYAN}q${RESET}          quit`,
    "",
    `${DIM}Same scanner + tree model as Desktop. Code: packages/disklizard${RESET}`,
  ]
}

export function renderTuiFooter(opts: { hint: string; cols: number }): string {
  const rule = "─".repeat(Math.min(opts.cols - 1, 72))
  return `${DIM}${rule}${RESET}\n${DIM}${opts.hint}${RESET}`
}

export function clearScreen(): void {
  process.stdout.write(CLEAR + HIDE_CURSOR)
}

export function restoreTerminal(): void {
  process.stdout.write(SHOW_CURSOR + RESET + "\n")
}
