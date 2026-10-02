import { expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider, useTheme } from "@/components/dl/theme"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

test("an explicit scheme overrides the system and switches both theme layers together", async () => {
  const saved = localStorage.getItem("disklizard-color-scheme")
  const originalMatchMedia = globalThis.matchMedia
  const element = document.documentElement
  const originalClass = element.className
  const originalScheme = element.getAttribute("data-color-scheme")
  const originalStyle = element.style.colorScheme
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  function Switch() {
    const theme = useTheme()
    return (
      <button onClick={() => theme.setScheme("dark")}>{theme.resolved}</button>
    )
  }
  try {
    // Reproduce the original failure: saved light while the OS is dark.
    globalThis.matchMedia = (query) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => true,
    })
    localStorage.setItem("disklizard-color-scheme", "light")
    await act(async () =>
      root.render(
        <ThemeProvider>
          <Switch />
        </ThemeProvider>
      )
    )
    expect(host.textContent).toBe("light")
    expect(element.getAttribute("data-color-scheme")).toBe("light")
    expect(element.classList.contains("dark")).toBe(false)
    expect(element.style.colorScheme).toBe("light")
    await act(async () => host.querySelector("button")?.click())
    expect(element.getAttribute("data-color-scheme")).toBe("dark")
    expect(element.classList.contains("dark")).toBe(true)
    expect(element.style.colorScheme).toBe("dark")
  } finally {
    await act(async () => root.unmount())
    host.remove()
    globalThis.matchMedia = originalMatchMedia
    if (saved === null) localStorage.removeItem("disklizard-color-scheme")
    else localStorage.setItem("disklizard-color-scheme", saved)
    element.className = originalClass
    if (originalScheme === null) element.removeAttribute("data-color-scheme")
    else element.setAttribute("data-color-scheme", originalScheme)
    element.style.colorScheme = originalStyle
  }
})
