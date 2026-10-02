import { expect, test } from "bun:test"
import { act, useState } from "react"
import { createRoot } from "react-dom/client"
import { MotionConfig } from "framer-motion"
import { NodeContextMenu } from "./NodeContextMenu"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

test("context menu skips disabled items, supports boundaries, and returns focus without trapping Tab", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  function Harness() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button onClick={() => setOpen(true)}>Open menu</button>
        <button>Next control</button>
        <NodeContextMenu
          at={open ? { x: 20, y: 20 } : null}
          onClose={() => setOpen(false)}
          items={[
            { label: "First", onSelect: () => {} },
            { label: "Disabled", disabled: true, onSelect: () => {} },
            { label: "Last", onSelect: () => {} },
          ]}
        />
      </>
    )
  }
  const key = async (value: string) => {
    const event = new KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
    })
    await act(async () => document.activeElement?.dispatchEvent(event))
    return event
  }
  try {
    await act(async () =>
      root.render(
        <MotionConfig skipAnimations>
          <Harness />
        </MotionConfig>
      )
    )
    const trigger = host.querySelector("button")!
    await act(async () => {
      trigger.focus()
      trigger.click()
    })
    expect(document.activeElement?.textContent).toBe("First")
    await key("ArrowDown")
    expect(document.activeElement?.textContent).toBe("Last")
    await key("Home")
    expect(document.activeElement?.textContent).toBe("First")
    await key("End")
    expect(document.activeElement?.textContent).toBe("Last")
    await key("Escape")
    expect(host.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    await act(async () => trigger.click())
    expect((await key("Tab")).defaultPrevented).toBe(false)
    expect(host.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
