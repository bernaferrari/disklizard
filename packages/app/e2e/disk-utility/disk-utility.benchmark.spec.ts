import type { Page } from "@playwright/test"
import { benchmark, expect } from "../performance/benchmark"

type PaintObservation = {
  durationMs: number
  rafGapP50Ms: number
  rafGapP95Ms: number
  rafGapMaxMs: number
  longTaskCount: number
  longTaskDurationMs: number
}

declare global {
  interface Window {
    diskLizardBenchmarkObservation?: Promise<PaintObservation>
  }
}

async function installMapPaintObservation(page: Page) {
  await page.evaluate(() => {
    const view = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.getAttribute("aria-label")?.startsWith("View map of Test volume"),
    )
    if (!view) throw new Error("Map action was not found")

    window.diskLizardBenchmarkObservation = new Promise<PaintObservation>((resolve) => {
      const gaps: number[] = []
      const longTasks: Array<{ startTime: number; duration: number }> = []
      let startedAt = 0
      let previousFrame = 0
      let stableFrames = 0
      let frame = 0
      let settled = false
      const observer =
        typeof PerformanceObserver === "undefined"
          ? undefined
          : new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) longTasks.push({ startTime: entry.startTime, duration: entry.duration })
            })
      try {
        observer?.observe({ type: "longtask", buffered: true })
      } catch {
        observer?.disconnect()
      }

      const finish = (at: number) => {
        if (settled) return
        settled = true
        cancelAnimationFrame(frame)
        for (const entry of observer?.takeRecords() ?? []) {
          longTasks.push({ startTime: entry.startTime, duration: entry.duration })
        }
        observer?.disconnect()
        const observedLongTasks = longTasks.filter((entry) => entry.startTime >= startedAt && entry.startTime <= at)
        const sortedGaps = [...gaps].sort((left, right) => left - right)
        const percentile = (fraction: number) =>
          sortedGaps[Math.min(sortedGaps.length - 1, Math.floor(sortedGaps.length * fraction))] ?? 0
        resolve({
          durationMs: at - startedAt,
          rafGapP50Ms: percentile(0.5),
          rafGapP95Ms: percentile(0.95),
          rafGapMaxMs: Math.max(0, ...gaps),
          longTaskCount: observedLongTasks.length,
          longTaskDurationMs: observedLongTasks.reduce((total, entry) => total + entry.duration, 0),
        })
      }

      const sample = (at: number) => {
        if (previousFrame > 0) gaps.push(at - previousFrame)
        previousFrame = at
        const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label^="Storage map for Test volume"]')
        const ready = !!canvas && canvas.width > 1 && canvas.height > 1 && canvas.getBoundingClientRect().width > 0
        stableFrames = ready ? stableFrames + 1 : 0
        if (stableFrames >= 2) return finish(at)
        frame = requestAnimationFrame(sample)
      }

      view.addEventListener(
        "click",
        () => {
          startedAt = performance.now()
          previousFrame = startedAt
          frame = requestAnimationFrame(sample)
        },
        { capture: true, once: true },
      )
    })
  })
}

async function installNextPaintObservation(
  page: Page,
  input: { selector: string; event: "click" | "input"; ready: string; readyText?: string },
) {
  await page.evaluate(({ selector, event, ready, readyText }) => {
    const control = document.querySelector<HTMLElement>(selector)
    if (!control) throw new Error(`Benchmark control was not found: ${selector}`)
    window.diskLizardBenchmarkObservation = new Promise<PaintObservation>((resolve) => {
      let startedAt = 0
      let frame = 0
      const observe = (at: number) => {
        const target = [...document.querySelectorAll<HTMLElement>(ready)].find(
          (candidate) => !readyText || candidate.textContent?.includes(readyText),
        )
        if (!target) {
          frame = requestAnimationFrame(observe)
          return
        }
        requestAnimationFrame((next) =>
          resolve({
            durationMs: next - startedAt,
            rafGapP50Ms: 0,
            rafGapP95Ms: 0,
            rafGapMaxMs: 0,
            longTaskCount: 0,
            longTaskDurationMs: 0,
          }),
        )
      }
      control.addEventListener(
        event,
        () => {
          startedAt = performance.now()
          frame = requestAnimationFrame(observe)
        },
        { capture: true, once: true },
      )
    })
  }, input)
}

async function readObservation(page: Page) {
  return page.evaluate(async () => {
    const observation = window.diskLizardBenchmarkObservation
    if (!observation) throw new Error("Benchmark observation was not installed")
    return observation
  })
}

async function chromiumHeap(page: Page) {
  const session = await page.context().newCDPSession(page)
  try {
    // Compare retained renderer state rather than transient allocation noise.
    await session.send("HeapProfiler.collectGarbage")
    await session.send("Performance.enable")
    const result = await session.send("Performance.getMetrics")
    return result.metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value ?? null
  } finally {
    await session.detach()
  }
}

benchmark("DiskLizard large retained tree reaches a usable map and stays responsive", async ({ page, report }) => {
  await page.goto("/?benchmark=1&width=24")
  const scan = page.getByRole("button", { name: /^Scan Test volume/ })
  await expect(scan).toBeEnabled()
  const heapBefore = await chromiumHeap(page)
  const fixture = await page.evaluate(() => ({
    treeNodes: window.diskLizardFixture.treeNodes,
    payloadBytes: window.diskLizardFixture.payloadBytes,
  }))

  const scanStartedAt = await page.evaluate(() => performance.now())
  await scan.click()
  const view = page.getByRole("button", { name: "View map of Test volume" })
  await expect(view).toBeEnabled()
  const scanResultReadyMs = await page.evaluate((startedAt) => performance.now() - startedAt, scanStartedAt)

  await installMapPaintObservation(page)
  await view.click()
  const map = page.getByRole("region", { name: /^Storage map for Test volume/ })
  await expect(map).toBeVisible()
  const mapPaint = await readObservation(page)
  const canvasPixels = await page.locator('canvas[aria-label^="Storage map for Test volume"]').evaluate(
    (canvas: HTMLCanvasElement) => canvas.width * canvas.height,
  )

  await page.getByRole("button", { name: "Tiles" }).click()
  const tileSelector = '[data-disk-tile-path="/Users/alex/Workspace 00"]'
  const tile = page.locator(tileSelector)
  await expect(tile).toBeVisible()
  await installNextPaintObservation(page, {
    selector: tileSelector,
    event: "click",
    ready: `${tileSelector}[aria-pressed="true"]`,
  })
  await tile.click()
  const selectionPaint = await readObservation(page)
  await expect(tile).toHaveAttribute("aria-pressed", "true")

  await page.getByText("Explore this scan", { exact: true }).click()
  const search = page.getByRole("searchbox", { name: "Search this scan" })
  await expect(search).toBeVisible()
  const query = "artifact-23-23-23.bin"
  await installNextPaintObservation(page, {
    selector: "#disklizard-scan-search",
    event: "input",
    ready: "[data-disk-index]",
    readyText: query,
  })
  await search.fill(query)
  const searchPaint = await readObservation(page)
  await expect(page.getByText(query, { exact: true })).toBeVisible()

  const heapAfter = await chromiumHeap(page)
  const rendered = await page.evaluate(() => ({
    elements: document.querySelectorAll("*").length,
  }))

  expect(fixture.treeNodes).toBeGreaterThan(10_000)
  expect(fixture.payloadBytes).toBeGreaterThan(0)
  expect(mapPaint.durationMs).toBeGreaterThanOrEqual(0)
  expect(selectionPaint.durationMs).toBeGreaterThanOrEqual(0)
  expect(searchPaint.durationMs).toBeGreaterThanOrEqual(0)
  report(
    {
      scanResultReadyMs,
      mapFirstUsableObservedMs: mapPaint.durationMs,
      mapRafGapP50Ms: mapPaint.rafGapP50Ms,
      mapRafGapP95Ms: mapPaint.rafGapP95Ms,
      mapRafGapMaxMs: mapPaint.rafGapMaxMs,
      mapLongTaskCount: mapPaint.longTaskCount,
      mapLongTaskDurationMs: mapPaint.longTaskDurationMs,
      selectionNextPaintMs: selectionPaint.durationMs,
      scanWideSearchNextPaintMs: searchPaint.durationMs,
      retainedTreeNodes: fixture.treeNodes,
      serializedPayloadBytes: fixture.payloadBytes,
      renderedElementCount: rendered.elements,
      canvasPixels,
      rendererJSHeapUsedBeforeBytes: heapBefore,
      rendererJSHeapUsedAfterBytes: heapAfter,
      rendererJSHeapDeltaBytes: heapBefore === null || heapAfter === null ? null : heapAfter - heapBefore,
    },
    { width: 24, productionBuild: true },
  )
})
