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
    const [age, ecosystem] = [...document.querySelectorAll("select")]
    expect(document.querySelector(`label[for="${age.id}"]`)?.textContent).toBe(
      "Unchanged for"
    )
    await act(async () => {
      age.value = "90"
      age.dispatchEvent(new Event("change", { bubbles: true }))
      ecosystem.value = "rust"
      ecosystem.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(age.value).toBe("90")
    expect(ecosystem.value).toBe("rust")
    expect(host.textContent).toBe(
      "FiltersRust · Unchanged for at least 90 days"
    )
    await act(async () => {
      age.value = "custom"
      age.dispatchEvent(new Event("change", { bubbles: true }))
    })
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
    expect(age.value).toBe("all")
    expect(ecosystem.value).toBe("all")
    expect(host.textContent).toBe("Filters")
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
