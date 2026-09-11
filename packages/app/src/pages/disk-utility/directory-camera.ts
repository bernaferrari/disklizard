export type CameraBox = { x: number; y: number; width: number; height: number }

/** Uniform camera transform: fill a viewport with a focused rectangle without stretching. */
export function focusCamera(view: CameraBox, focus: CameraBox) {
  const scale = Math.max(view.width / Math.max(1, focus.width), view.height / Math.max(1, focus.height))
  const x = view.width / 2 - (focus.x - view.x + focus.width / 2) * scale
  const y = view.height / 2 - (focus.y - view.y + focus.height / 2) * scale
  return { scale, x, y }
}
export function cameraCss(camera: ReturnType<typeof focusCamera>) {
  return `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`
}
export function inverseCamera(camera: ReturnType<typeof focusCamera>) {
  return { scale: 1 / camera.scale, x: -camera.x / camera.scale, y: -camera.y / camera.scale }
}
