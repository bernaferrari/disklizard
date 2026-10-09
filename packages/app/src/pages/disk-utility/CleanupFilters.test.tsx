import { expect, test } from "bun:test"
import { act, useState } from "react"
import { createRoot } from "react-dom/client"
import { diskUtilityFixture } from "../../fixture"
import { DiskLizardRuntime } from "./runtime"
import { CleanupFilters } from "./CleanupFilters"
import type { DeveloperCleanupAgePreset } from "./developer-cleanup"
import type { ArtifactEcosystemFilter } from "./recognize"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function FiltersHarness() {
  const [age, setAge] = useState<DeveloperCleanupAgePreset>("all")
  const [customDays, setCustomDays] = useState("30")
  const [ecosystem, setEcosystem] = useState<ArtifactEcosystemFilter>("all")
  return (
    <CleanupFilters
      age={age}
      ecosystem={ecosystem}
      ecosystems={["node", "rust"]}
      customDays={customDays}
      onCustomDays={setCustomDays}
      onAge={setAge}
      onEcosystem={setEcosystem}
    />
  )
}

test("cleanup filters preserve both choices while open and reset both together", async () => {
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
          <FiltersHarness />
        </DiskLizardRuntime>
      )
    )
    await act(async () =>
      host.querySelector<HTMLButtonElement>("button")!.click()
    )
    const [age, ecosystem] = [
      ...document.querySelectorAll<HTMLElement>('[role="radiogroup"]'),
    ]
    const checked = (group: HTMLElement) =>
      group.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
        ?.dataset.value
    const choose = (group: HTMLElement, value: string) =>
      group.querySelector<HTMLButtonElement>(`[data-value="${value}"]`)!.click()
    expect(
      document.getElementById(age.getAttribute("aria-labelledby") ?? "")
        ?.textContent
    ).toBe("Unchanged for")
    await act(async () => {
      choose(age, "90")
      choose(ecosystem, "rust")
    })
    expect(checked(age)).toBe("90")
    expect(checked(ecosystem)).toBe("rust")
    expect(host.textContent).toBe(
      "FiltersRust · Unchanged for at least 90 days"
    )
    await act(async () => choose(age, "custom"))
    const custom = document.querySelector<HTMLInputElement>(
      'input[type="number"]'
    )!
    expect(custom).not.toBeNull()
    expect(custom.disabled).toBe(false)
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(custom, "120")
      custom.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(host.textContent).toContain("Unchanged for at least 120 days")
    const reset = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Clear filters"
    )
    expect(reset).toBeDefined()
    await act(async () => reset!.click())
    expect(checked(age)).toBe("all")
    expect(checked(ecosystem)).toBe("all")
    expect(host.textContent).toBe("Filters")
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
