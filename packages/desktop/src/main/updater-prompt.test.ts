import { describe, expect, test } from "bun:test"
import { createUpdaterPromptCoordinator, type UpdaterMessageBoxOptions } from "./updater-prompt"
import type { UpdaterState } from "./updater-controller"

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

const messages = {
  checkFailedMessage: "Update check failed.",
  checkFailedTitle: "Update Error",
  installFailedMessage: "DiskLizard couldn't start the update installation. Try again, or install it later.",
  installFailedTitle: "Couldn't Install Update",
  upToDateMessage: "You're up to date.",
  upToDateTitle: "No Updates",
  readyMessage: (version: string) => `Update ${version} downloaded. Restart now?`,
  readyTitle: "Update Ready",
  restart: "Restart",
  retry: "Retry",
  later: "Later",
}

function setup(input?: {
  availability?: { updateAvailable: boolean; version?: string }
  state?: UpdaterState
  responses?: number[]
  install?: () => Promise<void>
  checkOnly?: () => Promise<{ updateAvailable: boolean; version?: string }>
}) {
  const calls: string[] = []
  const dialogs: UpdaterMessageBoxOptions[] = []
  const responses = [...(input?.responses ?? [1])]
  const controller = {
    async checkOnly() {
      calls.push("check")
      return input?.checkOnly?.() ?? input?.availability ?? { updateAvailable: true, version: "2.0.0" }
    },
    getState: () => input?.state ?? ({ status: "ready", version: "2.0.0" } satisfies UpdaterState),
    async dismiss() {
      calls.push("dismiss")
      return controller.getState()
    },
    async install() {
      calls.push("install")
      await input?.install?.()
    },
  }
  const prompt = createUpdaterPromptCoordinator({
    controller,
    messages,
    async showMessageBox(options) {
      dialogs.push(options)
      return { response: responses.shift() ?? 1 }
    },
  })
  return { calls, dialogs, prompt }
}

describe("updater prompt coordinator", () => {
  test("scheduled readiness prompts once and installs only after confirmation", async () => {
    const app = setup({ responses: [0] })

    await app.prompt.scheduled()

    expect(app.calls).toEqual(["check", "install"])
    expect(app.dialogs).toEqual([
      {
        type: "info",
        message: "Update 2.0.0 downloaded. Restart now?",
        title: "Update Ready",
        buttons: ["Restart", "Later"],
        defaultId: 0,
        cancelId: 1,
      },
    ])
  })

  test("Later suppresses timer repetition while a manual check can prompt again", async () => {
    const app = setup({ responses: [1, 1] })

    await app.prompt.scheduled()
    await app.prompt.scheduled()
    await app.prompt.manual()

    expect(app.calls).toEqual(["check", "dismiss", "check", "check", "dismiss"])
    expect(app.dialogs).toHaveLength(2)
  })

  test("coalesces scheduled and manual callers into one check and dialog", async () => {
    const release = deferred<{ updateAvailable: true; version: string }>()
    const app = setup({ checkOnly: () => release.promise, responses: [1] })

    const scheduled = app.prompt.scheduled()
    const callers = [app.prompt.manual(), app.prompt.manual()]
    release.resolve({ updateAvailable: true, version: "2.0.0" })
    await Promise.all([scheduled, ...callers])

    expect(app.calls).toEqual(["check", "dismiss"])
    expect(app.dialogs).toHaveLength(1)
  })

  test("keeps scheduled failures silent but reports manual failures", async () => {
    const app = setup({
      availability: { updateAvailable: false },
      state: { status: "error", message: "offline" },
    })

    await app.prompt.scheduled()
    await app.prompt.manual()

    expect(app.dialogs).toEqual([{ type: "error", message: "Update check failed.", title: "Update Error" }])
  })

  test("does not claim a disabled build is up to date", async () => {
    const app = setup({
      availability: { updateAvailable: false },
      state: { status: "disabled" },
    })

    await app.prompt.scheduled()
    await app.prompt.manual()

    expect(app.calls).toEqual([])
    expect(app.dialogs).toEqual([])
  })

  test("retries a failed install handoff without rechecking the downloaded update", async () => {
    let attempts = 0
    const app = setup({
      responses: [0, 0],
      install: async () => {
        attempts += 1
        if (attempts === 1) throw new Error("stop failed")
      },
    })

    await app.prompt.manual()

    expect(app.calls).toEqual(["check", "install", "install"])
    expect(app.dialogs[1]).toEqual({
      type: "error",
      message: "DiskLizard couldn't start the update installation. Try again, or install it later.",
      title: "Couldn't Install Update",
      buttons: ["Retry", "Later"],
      defaultId: 0,
      cancelId: 1,
    })
  })

  test("Later dismisses a failed install handoff and suppresses scheduled repetition", async () => {
    const app = setup({
      responses: [0, 1],
      install: async () => {
        throw new Error("installer missing")
      },
    })

    await app.prompt.manual()
    await app.prompt.scheduled()

    expect(app.calls).toEqual(["check", "install", "dismiss", "check"])
    expect(app.dialogs.map((entry) => entry.type)).toEqual(["info", "error"])
  })
})
