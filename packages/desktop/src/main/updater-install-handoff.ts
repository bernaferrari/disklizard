export type NativeInstallEmitter = {
  once(event: "error", listener: (error: Error) => void): unknown
  removeListener(event: "error", listener: (error: Error) => void): unknown
  quitAndInstall(): void
}

/**
 * Hands control to electron-updater. A successful handoff deliberately never
 * resolves because the current process is expected to terminate. Only an
 * observed native updater failure returns control to the application.
 */
export function beginTerminalInstallHandoff(input: {
  updater: NativeInstallEmitter
  onStart(): void
  onFailure(): void
}): Promise<void> {
  return new Promise<void>((_resolve, reject) => {
    let active = true
    const fail = (error: unknown) => {
      if (!active) return
      active = false
      input.updater.removeListener("error", fail)
      try {
        input.onFailure()
      } catch (resetError) {
        reject(resetError)
        return
      }
      reject(error instanceof Error ? error : new Error(String(error)))
    }

    input.updater.once("error", fail)
    try {
      input.onStart()
      input.updater.quitAndInstall()
    } catch (error) {
      fail(error)
    }
  })
}
