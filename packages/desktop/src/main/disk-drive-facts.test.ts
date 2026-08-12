import { describe, expect, test } from "bun:test"
import { publishDriveFacts } from "./disk-drive-facts"

describe("deferred drive facts", () => {
  test("publishes an optional local update with its originating path", () => {
    const sent: Array<{ channel: string; update: unknown }> = []
    publishDriveFacts(
      {
        isDestroyed: () => false,
        send: (channel, update) => sent.push({ channel, update }),
      },
      "/Volumes/Data",
      { filesystem: "apfs", snapshotCount: 2 },
    )

    expect(sent).toEqual([
      {
        channel: "disklizard:drive-facts",
        update: { path: "/Volumes/Data", facts: { filesystem: "apfs", snapshotCount: 2 } },
      },
    ])
  })

  test("does not message a gone renderer or publish empty evidence", () => {
    const sent: Array<{ channel: string; update: unknown }> = []
    const sender = {
      isDestroyed: () => false,
      send: (channel: string, update: unknown) => sent.push({ channel, update }),
    }
    publishDriveFacts(sender, "/Volumes/Data", {})
    publishDriveFacts({ ...sender, isDestroyed: () => true }, "/Volumes/Data", { filesystem: "apfs" })
    expect(sent).toEqual([])
  })
})
