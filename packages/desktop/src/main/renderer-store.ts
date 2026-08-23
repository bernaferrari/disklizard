import type { RendererStoreID } from "../preload/types"

const rendererStoreNames = {
  disklizard: "disklizard.dat",
  global: "opencode.global.dat",
} satisfies Record<RendererStoreID, string>

export function resolveRendererStoreName(value: unknown) {
  if (typeof value !== "string" || !(value in rendererStoreNames)) {
    throw new Error("Invalid renderer store")
  }
  return rendererStoreNames[value as RendererStoreID]
}
