type QuitApplication = {
  on(event: "before-quit", listener: (event: { preventDefault(): void }) => void): unknown
  quit(): void
}

/** Keep the main event loop and renderer lifetime intact until native cleanup
 * finishes. Repeated quit requests share the same cleanup; the retry exits. */
export function installQuitCleanup(
  application: QuitApplication,
  cleanup: () => Promise<void>,
  reportError: (error: unknown) => void,
) {
  let state: "ready" | "cleaning" | "complete" = "ready"
  const complete = () => {
    state = "complete"
    application.quit()
  }
  application.on("before-quit", (event) => {
    if (state === "complete") return
    event.preventDefault()
    if (state === "cleaning") return
    state = "cleaning"
    void Promise.resolve().then(cleanup).then(complete, (error) => {
      try {
        reportError(error)
      } finally {
        complete()
      }
    })
  })
}
