import { describe, expect, it } from "bun:test"

describe("Disk Utility typography", () => {
  it("keeps component copy on the supported 13px-or-larger role scale", async () => {
    const offenders: string[] = []
    const files = new Bun.Glob("*.tsx").scan({ cwd: import.meta.dir, absolute: true })

    for await (const path of files) {
      const source = await Bun.file(path).text()
      if (/text-(?:9|10|11)-(?:regular|medium|semibold|mono)/.test(source)) offenders.push(path)
    }

    expect(offenders).toEqual([])
  })
})
