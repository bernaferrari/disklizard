import type { ReactNode } from "react"

/** Highlight the visible substring that made a text result relevant. */
export function SearchHighlight(props: { text: string; query: string }) {
  const needle = props.query.trim()
  if (!needle) return props.text
  const lower = props.text.toLocaleLowerCase()
  const search = needle.toLocaleLowerCase()
  const pieces: ReactNode[] = []
  let start = 0
  while (start < props.text.length) {
    const match = lower.indexOf(search, start)
    if (match < 0) break
    if (match > start) pieces.push(props.text.slice(start, match))
    pieces.push(
      <mark
        key={match}
        className="rounded-sm bg-[color-mix(in_oklch,var(--dl-accent-strong)_18%,transparent)] text-inherit"
      >
        {props.text.slice(match, match + needle.length)}
      </mark>
    )
    start = match + needle.length
  }
  if (!pieces.length) return props.text
  if (start < props.text.length) pieces.push(props.text.slice(start))
  return <>{pieces}</>
}
