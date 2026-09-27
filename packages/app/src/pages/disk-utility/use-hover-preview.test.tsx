import { expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { DiskScanNode } from "./types"
import { useHoverPreview } from "./use-hover-preview"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const folder = (name: string): DiskScanNode => ({
  name,
  path: `/root/${name}`,
  size: 100,
  isDir: true,
  ext: "",
  children: [],
})

function PreviewHarness(props: {
  candidate: DiskScanNode | null
  context: string
}) {
  const preview = useHoverPreview(props.candidate, props.context)
  return <span>{preview.node?.name ?? "none"}</span>
}

test("hovered contents settle, persist on leave, and reset with navigation", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const first = folder("first")
  const second = folder("second")
  try {
    await act(async () =>
      root.render(<PreviewHarness candidate={first} context="/root" />)
    )
    expect(host.textContent).toBe("none")
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 820))
    })
    expect(host.textContent).toBe("first")

    await act(async () =>
      root.render(<PreviewHarness candidate={null} context="/root" />)
    )
    expect(host.textContent).toBe("first")
    await act(async () =>
      root.render(<PreviewHarness candidate={second} context="/root" />)
    )
    expect(host.textContent).toBe("first")
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 820))
    })
    expect(host.textContent).toBe("second")

    await act(async () =>
      root.render(<PreviewHarness candidate={null} context="/other" />)
    )
    expect(host.textContent).toBe("none")
    await act(async () =>
      root.render(<PreviewHarness candidate={null} context="/root" />)
    )
    expect(host.textContent).toBe("none")
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
