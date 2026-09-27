/** An imperative pointer overlay keeps drag movement out of React renders. */
export function showCollectionDragPreview(
  host: HTMLElement,
  name: string,
  size: string,
  color: string
) {
  host.replaceChildren()
  const token = document.createElement("div")
  token.textContent = size
  Object.assign(token.style, {
    width: "76px",
    height: "76px",
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    background: color,
    color: "oklch(0.2 0.02 250)",
    fontSize: "13px",
    fontWeight: "600",
    boxShadow:
      "inset 0 0 0 1px rgb(255 255 255 / .35), 0 8px 24px rgb(0 0 0 / .24)",
  })
  const label = document.createElement("div")
  label.textContent = name
  Object.assign(label.style, {
    marginTop: "8px",
    maxWidth: "180px",
    padding: "5px 9px",
    borderRadius: "7px",
    background: "var(--background-base)",
    color: "var(--text-strong)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  })
  host.append(token, label)
  host.style.left = "0"
  host.style.top = "0"
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
    token.animate(
      [
        { transform: "scale(1.25)", borderRadius: "20%", opacity: 0.7 },
        { transform: "scale(1)", borderRadius: "50%", opacity: 1 },
      ],
      { duration: 180, easing: "cubic-bezier(.22,1,.36,1)" }
    )
}
export function moveCollectionDragPreview(
  host: HTMLElement,
  x: number,
  y: number
) {
  host.style.transform = `translate3d(${x - 38}px, ${y - 38}px, 0)`
}
export function hideCollectionDragPreview(host: HTMLElement) {
  host
    .getAnimations({ subtree: true })
    .forEach((animation) => animation.cancel())
  host.style.left = "-9999px"
  host.style.top = "-9999px"
  host.style.transform = "none"
  host.replaceChildren()
}
