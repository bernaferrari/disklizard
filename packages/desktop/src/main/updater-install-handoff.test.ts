import { describe, expect, test } from "bun:test"
import { beginTerminalInstallHandoff } from "./updater-install-handoff"

function setup(options?: { synchronousFailure?: Error }) {
  const calls: string[] = []
  let listener: ((error: Error) => void) | undefined
  const updater = {
    once(_event: "error", next: (error: Error) => void) {
      calls.push("listen")
      listener = next
    },
    removeListener(_event: "error", next: (error: Error) => void) {
      calls.push("unlisten")
      if (listener === next) listener = undefined
    },
    quitAndInstall() {
      calls.push("install")
      if (options?.synchronousFailure) throw options.synchronousFailure
    },
  }
  const handoff = beginTerminalInstallHandoff({
    updater,
    onStart: () => calls.push("start"),
    onFailure: () => calls.push("reset"),
  })
  return { calls, handoff, fail: (error: Error) => listener?.(error) }
}

describe("updater install handoff", () => {
  test("listens before starting and stays terminal after a successful native handoff", async () => {
    const app = setup()
    let settled = false
    void app.handoff.finally(() => {
      settled = true
    })

    await Promise.resolve()

    expect(app.calls).toEqual(["listen", "start", "install"])
    expect(settled).toBe(false)
  })

  test("resets quitting state and rejects on an observed asynchronous failure", async () => {
    const app = setup()
    app.fail(new Error("Squirrel failed"))

    await expect(app.handoff).rejects.toThrow("Squirrel failed")
    expect(app.calls).toEqual(["listen", "start", "install", "unlisten", "reset"])
  })

  test("observes synchronous quitAndInstall failures through the same path", async () => {
    const app = setup({ synchronousFailure: new Error("installer missing") })

    await expect(app.handoff).rejects.toThrow("installer missing")
    expect(app.calls).toEqual(["listen", "start", "install", "unlisten", "reset"])
  })
})
