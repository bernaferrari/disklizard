import { expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { diskUtilityFixture } from "../../fixture"
import { DiskLizardRuntime } from "./runtime"
import { CleanupView } from "./CleanupView"
import { buildCleanupSummary } from "./cleanup-summary"
import type { DiskScanNode } from "./types"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const node = (path: string): DiskScanNode => ({
  path,
  name: path.split("/").at(-1)!,
  size: 100,
  isDir: true,
  children: [],
  ext: "",
})

test("cleanup opens specific explanations without selecting and only bulk-selects recreatable items", async () => {
  const ready = node("/work/web/node_modules")
  const uncertain = node("/work/notes/target")
  const another = node("/work/writing/target")
  const summary = buildCleanupSummary({
    developerItems: [
      {
        node: ready,
        bytes: 100,
        recognition: {
          safety: "regenerable",
          developer: "dependencies",
          tag: "Developer dependencies",
          hint: "Your package manager restores it from the project lockfile",
        },
      },
      ...[uncertain, another].map((node) => ({
        node,
        bytes: 100,
        recognition: {
          safety: "unknown" as const,
          developer: "build-output" as const,
          tag: "Possible build target" as const,
          confidence: "ambiguous" as const,
        },
      })),
    ],
    suggestions: [],
    canModify: () => true,
    isEligible: (candidate) => candidate === ready,
  })
  const collected: string[] = []
  const toggled: string[] = []
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
          <CleanupView
            summary={summary}
            isCollected={() => false}
            coveredBy={() => undefined}
            canModify={() => true}
            restriction={() => undefined}
            collectionCount={0}
            collectionBytes={0}
            trashName="Trash"
            agePreset="all"
            ecosystems={[]}
            ecosystem="all"
            onAgePreset={() => {}}
            onEcosystem={() => {}}
            onToggle={(node) => toggled.push(node.path)}
            onCollect={(nodes) =>
              collected.push(...nodes.map((node) => node.path))
            }
            onClear={() => {}}
            onReview={() => {}}
            onReveal={() => {}}
          />
        </DiskLizardRuntime>
      )
    )
    const button = (text: string) =>
      [...host.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === text
      )!
    expect(host.textContent).not.toContain("Check first")
    expect(host.querySelector('[aria-label^="Select everything"]')).toBeNull()
    await act(async () => button("Select all").click())
    expect(collected).toEqual([ready.path])
    const group = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Other folders")
    )!
    expect(group.getAttribute("aria-expanded")).toBe("false")
    await act(async () =>
      group.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
      )
    )
    expect(group.getAttribute("aria-expanded")).toBe("true")
    const details = host.querySelector<HTMLButtonElement>(
      '[aria-label="Inspect notes / target"]'
    )!
    await act(async () => details.click())
    expect(details.getAttribute("aria-current")).toBe("true")
    expect(
      host.querySelector(`[id="${details.getAttribute("aria-controls")}"]`)
        ?.textContent
    ).toContain("can also belong to your own work")
    expect(toggled).toEqual([])
    await act(async () =>
      details.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
      )
    )
    const next = host.querySelector<HTMLButtonElement>(
      '[aria-label="Inspect writing / target"]'
    )!
    expect(document.activeElement).toBe(next)
    expect(next.getAttribute("aria-current")).toBe("true")
    expect(toggled).toEqual([])
    const inspectorScroll = host.querySelector<HTMLDivElement>("aside > div")!
    inspectorScroll.scrollTop = 120
    await act(async () => details.click())
    expect(inspectorScroll.scrollTop).toBe(0)
    await act(async () =>
      details.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })
      )
    )
    expect(document.activeElement).toBe(group)
    await act(async () =>
      group.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })
      )
    )
    expect(group.getAttribute("aria-expanded")).toBe("false")
    expect(group.getAttribute("aria-current")).toBe("true")
    expect(host.querySelector("aside h2")?.textContent).toBe("notes / target")
    expect(toggled).toEqual([])
    await act(async () => group.click())
    const select = host.querySelector<HTMLButtonElement>(
      '[aria-label="Select notes / target for review"]'
    )!
    expect(select).not.toBeNull()
    await act(async () => select.click())
    expect(toggled).toEqual([uncertain.path])
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

const defaults = {
  isCollected: () => false,
  coveredBy: () => undefined,
  canModify: () => true,
  restriction: () => undefined,
  collectionCount: 0,
  collectionBytes: 0,
  trashName: "Trash",
  agePreset: "all" as const,
  ecosystems: [],
  ecosystem: "all" as const,
  onAgePreset: () => {},
  onEcosystem: () => {},
  onToggle: () => {},
  onCollect: () => {},
  onClear: () => {},
  onReview: () => {},
  onReveal: () => {},
}
const platform = {
  platform: "desktop" as const,
  os: "macos" as const,
  diskUtility: diskUtilityFixture,
}
function dependencies(nodes: DiskScanNode[]) {
  return buildCleanupSummary({
    developerItems: nodes.map((node) => ({
      node,
      bytes: node.size,
      recognition: {
        safety: "regenerable" as const,
        developer: "dependencies" as const,
      },
    })),
    suggestions: [],
    canModify: () => true,
    isEligible: () => true,
  })
}

test("filtering replaces a vanished inspection without losing the global review selection", async () => {
  const alpha = node("/work/alpha/node_modules")
  const beta = node("/work/beta/node_modules")
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const view = (nodes: DiskScanNode[]) => (
    <DiskLizardRuntime platform={platform}>
      <CleanupView
        {...defaults}
        summary={dependencies(nodes)}
        collectionCount={1}
        collectionBytes={200}
      />
    </DiskLizardRuntime>
  )
  try {
    await act(async () => root.render(view([alpha, beta])))
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          '[aria-label="Inspect beta / node_modules"]'
        )!
        .click()
    )
    expect(host.querySelector("aside h2")?.textContent).toBe(
      "beta / node_modules"
    )
    await act(async () => root.render(view([alpha])))
    expect(host.querySelector("aside h2")?.textContent).toBe(
      "alpha / node_modules"
    )
    expect(host.querySelector("aside")?.textContent).not.toContain(beta.path)
    await act(async () => root.render(view([])))
    expect(host.querySelector("aside")).toBeNull()
    expect(
      [...host.querySelectorAll("button")].some(
        (button) => button.textContent === "Move to Trash…"
      )
    ).toBe(true)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

test("large cleanup categories reveal a bounded batch rather than mounting the entire inventory", async () => {
  const summary = dependencies(
    Array.from({ length: 1000 }, (_, i) => node(`/work/p${i}/node_modules`))
  )
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <DiskLizardRuntime platform={platform}>
          <CleanupView {...defaults} summary={summary} />
        </DiskLizardRuntime>
      )
    )
    expect(host.querySelectorAll("[data-cleanup-item]").length).toBe(4)
    const more = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Show 24 more"
    )!
    await act(async () => more.click())
    expect(host.querySelectorAll("[data-cleanup-item]").length).toBe(28)
    const fewer = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Show fewer"
    )!
    await act(async () => fewer.click())
    expect(host.querySelectorAll("[data-cleanup-item]").length).toBe(4)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

test("category checkboxes select and release recreatable items, and Space toggles the focused row", async () => {
  const nodes = [node("/work/a/node_modules"), node("/work/b/node_modules")]
  const selected = new Set<string>()
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const view = () => (
    <DiskLizardRuntime platform={platform}>
      <CleanupView
        {...defaults}
        summary={dependencies(nodes)}
        isCollected={(path) => selected.has(path)}
        onToggle={(n) => {
          if (!selected.delete(n.path)) selected.add(n.path)
        }}
        onCollect={(list) => list.forEach((n) => selected.add(n.path))}
        onRelease={(list) => list.forEach((n) => selected.delete(n.path))}
      />
    </DiskLizardRuntime>
  )
  try {
    await act(async () => root.render(view()))
    const group = () =>
      host.querySelector<HTMLButtonElement>(
        '[aria-label="Select everything in Dependencies"]'
      )!
    expect(group().getAttribute("aria-checked")).toBe("false")
    await act(async () => group().click())
    await act(async () => root.render(view()))
    expect([...selected].sort()).toEqual(nodes.map((n) => n.path))
    expect(group().getAttribute("aria-checked")).toBe("true")
    await act(async () => group().click())
    await act(async () => root.render(view()))
    expect(selected.size).toBe(0)

    // The category holding the inspected item starts expanded.
    const row = host.querySelector<HTMLButtonElement>(
      '[aria-label="Inspect a / node_modules"]'
    )!
    await act(async () =>
      row.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true })
      )
    )
    await act(async () => root.render(view()))
    expect([...selected]).toEqual([nodes[0].path])
    expect(group().getAttribute("aria-checked")).toBe("mixed")
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

test("a scan that cannot attribute unreadable folders explains it once, not per item", async () => {
  const summary = buildCleanupSummary({
    developerItems: [
      node("/work/a/node_modules"),
      node("/work/b/node_modules"),
    ].map((n) => ({
      node: n,
      bytes: n.size,
      recognition: {
        safety: "regenerable" as const,
        developer: "dependencies" as const,
      },
    })),
    suggestions: [],
    canModify: () => true,
    isEligible: () => true,
    hasUnobservedContents: () => true,
  })
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <DiskLizardRuntime platform={platform}>
          <CleanupView {...defaults} summary={summary} />
        </DiskLizardRuntime>
      )
    )
    expect(host.textContent).toContain("Some folders couldn’t be read")
    expect(host.textContent).not.toContain("Partly read")
    expect(host.querySelector("aside")?.textContent).not.toContain(
      "This scan has unreadable folders"
    )
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
