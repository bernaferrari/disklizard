import type { DriveFacts } from "./disk-scanner"

export type DriveFactsSender = {
  isDestroyed: () => boolean
  send: (channel: string, update: { path: string; facts: DriveFacts }) => void
}

/** Publish deferred, optional local volume facts only while the renderer remains available. */
export function publishDriveFacts(sender: DriveFactsSender, path: string, facts: DriveFacts) {
  if (sender.isDestroyed() || Object.keys(facts).length === 0) return
  sender.send("disklizard:drive-facts", { path, facts })
}
