import { expect, test } from "bun:test"
import { installQuitCleanup } from "./quit-cleanup"

function application() {
  let listener: (event: { preventDefault(): void }) => void = () => {}
  let allowed = 0
  let prevented = 0
  const exited = Promise.withResolvers<void>()
  const app = {
    on(_event: "before-quit", callback: typeof listener) { listener = callback },
    quit() {
      let blocked = false
      listener({ preventDefault: () => { blocked = true; prevented++ } })
      if (!blocked) { allowed++; exited.resolve() }
    },
  }
  return { app, exited: exited.promise, allowed: () => allowed, prevented: () => prevented }
}

test("quit waits for native cleanup and coalesces repeated requests", async () => {
  const fixture = application()
  const pending = Promise.withResolvers<void>()
  let calls = 0
  installQuitCleanup(fixture.app, async () => { calls++; await pending.promise }, () => {})
  fixture.app.quit()
  fixture.app.quit()
  await Promise.resolve()
  expect(calls).toBe(1)
  expect(fixture.allowed()).toBe(0)
  expect(fixture.prevented()).toBe(2)
  pending.resolve()
  await fixture.exited
  expect(fixture.allowed()).toBe(1)
  fixture.app.quit()
  expect(fixture.allowed()).toBe(2)
  expect(calls).toBe(1)
})

test("cleanup errors are reported once and do not trap the user in the app", async () => {
  const fixture = application()
  const reported = Promise.withResolvers<unknown>()
  const failure = new Error("Watcher shutdown failed")
  installQuitCleanup(fixture.app, async () => { throw failure }, (error) => reported.resolve(error))
  fixture.app.quit()
  expect(await reported.promise).toBe(failure)
  expect(fixture.allowed()).toBe(1)
})
