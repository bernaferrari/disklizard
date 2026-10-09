import { expect, test } from "bun:test"
import { act, useEffect } from "react"
import { createRoot } from "react-dom/client"
import { diskUtilityFixture } from "../../fixture"
import { DiskLizardRuntime } from "./runtime"
import { CleanupView } from "./CleanupView"
import { buildCleanupSummary } from "./cleanup-summary"
import { useReviewCollection } from "./use-review-collection"
import type { DiskScanNode } from "./types"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const archive: DiskScanNode = {
  name: "Archive.zip",
  path: "/Users/alex/Archive.zip",
  size: 294_000_000,
  isDir: false,
  ext: "zip",
  children: [],
}
const summary = buildCleanupSummary({
  developerItems: [],
  suggestions: [],
  canModify: () => true,
  isEligible: () => false,
})
const needsRescan = () => false

function HiddenSelection() {
  const basket = useReviewCollection({
    os: "macos",
    canCollect: () => true,
    needsRescan,
    onNeedsRescan: () => {},
    onParentReplaced: () => {},
    onEmpty: () => {},
  })
  useEffect(() => basket.add([archive]), [])
  return (
    <>
      <output data-count>{basket.effectiveItems.length}</output>
      <CleanupView
        summary={summary}
        isCollected={basket.isCollected}
        coveredBy={() => undefined}
        canModify={() => true}
        restriction={() => undefined}
        collectionCount={basket.effectiveItems.length}
        collectionBytes={basket.bytes}
        trashName="Trash"
        agePreset="all"
        ecosystems={[]}
        ecosystem="all"
        onAgePreset={() => {}}
        onEcosystem={() => {}}
        onToggle={basket.toggle}
        onCollect={basket.add}
        onReview={() => {}}
        onClear={basket.clear}
        onReveal={() => {}}
      />
    </>
  )
}

test("Clear in Cleanup empties the review basket even when none of its items are visible", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <DiskLizardRuntime
          platform={{
            platform: "desktop",
            os: "macos",
            diskUtility: diskUtilityFixture,
          }}
        >
          <HiddenSelection />
        </DiskLizardRuntime>
      )
    )
    expect(host.querySelector("[data-count]")?.textContent).toBe("1")
    expect(host.textContent).toContain("Includes items outside this list")
    const clear = [...host.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "Clear review"
    )
    expect(clear).toBeDefined()
    await act(async () => clear?.click())
    expect(host.querySelector("[data-count]")?.textContent).toBe("0")
    expect(host.textContent).not.toContain("294")
    const review = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Review")
    )
    expect(review).toBeUndefined()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
