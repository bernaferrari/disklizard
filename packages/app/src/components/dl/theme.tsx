import * as React from "react"

export type ColorScheme = "light" | "dark" | "system"

const STORAGE_KEY = "disklizard-color-scheme"

interface ThemeContextValue {
  scheme: ColorScheme
  resolved: "light" | "dark"
  setScheme: (scheme: ColorScheme) => void
}

const ThemeContext = React.createContext<ThemeContextValue | undefined>(
  undefined
)

function systemScheme(): "light" | "dark" {
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

/**
 * Bridges one color-scheme decision onto both token systems: the DiskLizard
 * tokens use `light-dark()` + `color-scheme`, the shadcn/ui layer uses the
 * `.dark` class. Follows the system preference unless overridden.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [scheme, setSchemeState] = React.useState<ColorScheme>(() => {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY)
    return saved === "light" || saved === "dark" ? saved : "system"
  })
  const [system, setSystem] = React.useState<"light" | "dark">(() =>
    systemScheme()
  )

  React.useEffect(() => {
    const query = globalThis.matchMedia?.("(prefers-color-scheme: dark)")
    if (!query) return undefined
    const onChange = () => setSystem(systemScheme())
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [])

  const resolved = scheme === "system" ? system : scheme

  React.useEffect(() => {
    const root = document.documentElement
    root.style.colorScheme = resolved
    root.setAttribute("data-color-scheme", resolved)
    root.classList.toggle("dark", resolved === "dark")
  }, [resolved])

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      scheme,
      resolved,
      setScheme: (next) => {
        setSchemeState(next)
        if (next === "system") globalThis.localStorage?.removeItem(STORAGE_KEY)
        else globalThis.localStorage?.setItem(STORAGE_KEY, next)
      },
    }),
    [scheme, resolved]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = React.useContext(ThemeContext)
  if (!context) throw new Error("useTheme must be used within ThemeProvider")
  return context
}
