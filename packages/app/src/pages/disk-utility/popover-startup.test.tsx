import { expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { Popover } from "../../components/dl/popover"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

test("an inline volume-details popover mounts without crashing the home screen", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  const errors: unknown[] = []
  const root = createRoot(host, { onUncaughtError: (error) => errors.push(error) })
  try {
    await act(async () => {
      root.render(<Popover portal={false} trigger="Volume details">Storage details</Popover>)
    })
    expect(errors).toEqual([])
    expect(host.textContent).toContain("Volume details")
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
