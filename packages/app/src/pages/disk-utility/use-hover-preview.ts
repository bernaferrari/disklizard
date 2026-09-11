import { useEffect, useState } from "react"
import type { DiskScanNode } from "./types"

/** Pointer highlights are immediate; inspection deliberately settles and persists. */
export function useHoverPreview(candidate: DiskScanNode | null, context: unknown) {
  const [preview, setPreview] = useState<{ context: unknown; node: DiskScanNode }>()
  useEffect(() => {
    if (!candidate) return
    const timer = setTimeout(() => setPreview({ context, node: candidate }), 800)
    return () => clearTimeout(timer)
  }, [candidate, context])
  return { node: preview && preview.context === context ? preview.node : null, dismiss: () => setPreview(undefined) }
}
