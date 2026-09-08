import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"

const overview = readFileSync(new URL("./DiskUtilityDriveOverview.tsx", import.meta.url), "utf8")
const volumeSurfaces = readFileSync(new URL("./DiskUtilityDriveSurfaces.tsx", import.meta.url), "utf8")
const page = readFileSync(new URL("./index.tsx", import.meta.url), "utf8")

describe("drive overview hierarchy", () => {
  it("offers folder scanning once, in the secondary footer action", () => {
    expect(overview.match(/disk\.drive\.scanFolder/g)).toHaveLength(1)
    expect(overview).not.toContain("disk.drive.firstRun.title")
    expect(overview).not.toContain("disk.drive.firstRun.body")
  })

  it("gives each volume exactly one scan/view action", () => {
    const volumeRow = volumeSurfaces.slice(
      volumeSurfaces.indexOf("export function VolumeRow"),
      volumeSurfaces.indexOf("function VolumeGlyph"),
    )
    expect(volumeRow.match(/<button\n/g)).toHaveLength(1)
    expect(overview.match(/<VolumeRow\n/g)).toHaveLength(1)
    expect(overview).toContain("onScan={() => props.onScanDrive(drive)}")
  })

  it("does not render empty protected or saved management sections", () => {
    expect(overview).not.toContain('<Show when={(props.cleanupLocks ?? []).length > 0}>')
    expect(overview).toContain('<Show when={props.pinnedLocations.length > 0}>')
    expect(overview).not.toContain('language.t("disk.drive.savedEmpty")')
  })
})

describe("parked map reachability", () => {
  it("exposes retained maps on Drives with keyboard-reachable Open and Close actions", () => {
    expect(overview).toContain('<For each={props.openMaps}>')
    expect(overview).toContain('onClick={() => props.onOpenMap(map)}')
    expect(overview).toContain('onClick={() => props.onCloseMap(map)}')
    expect(overview).toContain('aria-label={language.t("disk.drive.closeMap", { name: map.label })}')
  })

  it("restores the selected parked map before returning to the scan screen", () => {
    expect(page).toContain("openMaps={tabs()}")
    expect(page).toMatch(/function switchToTab\(id: string\)[\s\S]*?setView\("scan"\)/)
    expect(page).toMatch(/onOpenMap=\{\(map\) => \{\s*switchToTab\(map\.id\)\s*\}\}/)
    expect(page).toContain("onCloseMap={(map) => closeTab(map.id)}")
  })
})
