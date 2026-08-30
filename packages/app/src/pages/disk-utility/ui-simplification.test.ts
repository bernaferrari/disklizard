import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"

const page = readFileSync(new URL("./index.tsx", import.meta.url), "utf8")
const controls = readFileSync(new URL("./DiskUtilityControls.tsx", import.meta.url), "utf8")
const treemap = readFileSync(new URL("./TreemapPanel.tsx", import.meta.url), "utf8")

describe("Disk Utility simplified UI contract", () => {
  it("parks hidden tiles with both inert and aria-hidden semantics", () => {
    expect(page).toContain('inert={!gridInteractive() ? true : undefined}')
    expect(page).toContain('aria-hidden={!gridInteractive() ? "true" : undefined}')
    expect(treemap).toContain('aria-hidden="true"')
  })

  it("exposes the active state of every lens as a pressed control", () => {
    expect(controls).toContain('aria-pressed={props.active}')
    expect(page).toContain('label={language.t("disk.history.lens")}')
    expect(page).toContain('active={indexFilter.lens === "changes" || recentLens()}')
  })

  it("keeps the Changes lens wired to the renamed history surface", () => {
    expect(page).toContain('indexFilter.lens === "changes" ? "disk.history.search" : "disk.search.placeholder"')
    expect(page).toContain("<DiskScanHistory")
    expect(page).toContain('label={language.t("disk.history.lens")}')
  })
})
