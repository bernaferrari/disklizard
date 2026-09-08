
type WindowFullscreenAPI = Pick<Window["api"], "getWindowFullscreen" | "onWindowFullscreenChanged">

export function createWindowFullscreen(api: WindowFullscreenAPI) {
  let currentValue = false
const value = () => currentValue
const setValue = (next: typeof currentValue) => { currentValue = next }
  let disposed = false
  const unsubscribe = api.onWindowFullscreenChanged((fullscreen) => {
    if (!disposed) setValue(fullscreen)
  })

  void api
    .getWindowFullscreen()
    .then((fullscreen) => {
      if (!disposed) setValue(fullscreen)
    })
    .catch(() => undefined)

  return {
    value,
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribe()
    },
  }
}
