import type { UpdateAvailability, UpdaterState } from "./updater-controller"

export type UpdaterPromptController = {
  checkOnly(): Promise<UpdateAvailability>
  getState(): UpdaterState
  dismiss(): Promise<UpdaterState>
  install(): Promise<void>
}

export type UpdaterPromptMessages = {
  checkFailedMessage: string
  checkFailedTitle: string
  installFailedMessage: string
  installFailedTitle: string
  upToDateMessage: string
  upToDateTitle: string
  readyMessage(version: string): string
  readyTitle: string
  restart: string
  retry: string
  later: string
}

export type UpdaterMessageBoxOptions = {
  type: "error" | "info"
  message: string
  title: string
  buttons?: string[]
  defaultId?: number
  cancelId?: number
}

type ActivePrompt = {
  manualRequested: boolean
  promise: Promise<void>
}

/**
 * Owns update-check presentation for one application controller. Scheduled and
 * manual callers coalesce into one check and one dialog; a manual caller can
 * upgrade an in-flight silent check to user-visible feedback. Choosing Later
 * suppresses repeated timer prompts for that version until the user checks
 * manually or a newer version appears.
 */
export function createUpdaterPromptCoordinator(input: {
  controller: UpdaterPromptController
  messages: UpdaterPromptMessages
  showMessageBox(options: UpdaterMessageBoxOptions): Promise<{ response: number }>
  log?: (message: string, data?: object) => void
}) {
  let active: ActivePrompt | undefined
  let dismissedVersion: string | undefined

  const run = async (prompt: ActivePrompt) => {
    // The native menu is disabled for builds without an explicit public feed.
    // If a stale menu/renderer action still reaches this coordinator, do not
    // turn "no backend exists" into the false claim "up to date".
    if (input.controller.getState().status === "disabled") return
    const availability = await input.controller.checkOnly()
    const state = input.controller.getState()
    if (!availability.updateAvailable || !availability.version || state.status !== "ready") {
      if (state.status === "disabled") return
      if (!prompt.manualRequested) return
      if (state.status === "error") {
        await input.showMessageBox({
          type: "error",
          message: input.messages.checkFailedMessage,
          title: input.messages.checkFailedTitle,
        })
        return
      }
      await input.showMessageBox({
        type: "info",
        message: input.messages.upToDateMessage,
        title: input.messages.upToDateTitle,
      })
      return
    }

    const version = availability.version
    if (!prompt.manualRequested && dismissedVersion === version) return
    const response = await input.showMessageBox({
      type: "info",
      message: input.messages.readyMessage(version),
      title: input.messages.readyTitle,
      buttons: [input.messages.restart, input.messages.later],
      defaultId: 0,
      cancelId: 1,
    })
    if (response.response !== 0) {
      dismissedVersion = version
      await input.controller.dismiss()
      return
    }

    while (true) {
      try {
        await input.controller.install()
        return
      } catch (error) {
        input.log?.("update installation could not start", {
          error: error instanceof Error ? error.message : String(error),
        })
        // A failed native handoff restores the controller's `ready` state, so
        // retry the already-downloaded release without checking or downloading
        // it again. Later follows the same suppression policy as the first
        // prompt and leaves the update available for a manual check.
        const recovery = await input.showMessageBox({
          type: "error",
          message: input.messages.installFailedMessage,
          title: input.messages.installFailedTitle,
          buttons: [input.messages.retry, input.messages.later],
          defaultId: 0,
          cancelId: 1,
        })
        if (recovery.response === 0) continue
        dismissedVersion = version
        await input.controller.dismiss()
        return
      }
    }
  }

  const present = (manual: boolean) => {
    if (active) {
      if (manual) active.manualRequested = true
      return active.promise
    }
    const prompt: ActivePrompt = { manualRequested: manual, promise: Promise.resolve() }
    prompt.promise = run(prompt).finally(() => {
      if (active === prompt) active = undefined
    })
    active = prompt
    return prompt.promise
  }

  return {
    scheduled: () => present(false),
    manual: () => present(true),
  }
}
