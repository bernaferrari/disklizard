import { updaterFeedChannel, type DesktopChannel } from "./product-identity"

export type UpdaterReleasePolicyTarget = {
  channel: string | null
  allowPrerelease: boolean
  allowDowngrade: boolean
}

export function productionUpdaterDowngradeAllowed(channel: DesktopChannel) {
  return channel !== "prod"
}

export function updaterAllowsPrerelease(channel: DesktopChannel) {
  return channel === "beta"
}

/** Applies the complete channel policy to electron-updater's mutable backend. */
export function applyUpdaterReleasePolicy(target: UpdaterReleasePolicyTarget, channel: DesktopChannel) {
  target.channel = updaterFeedChannel(channel)
  target.allowPrerelease = updaterAllowsPrerelease(channel)
  target.allowDowngrade = productionUpdaterDowngradeAllowed(channel)
}

function splitDistinguishedName(value: string): string[] | undefined {
  const parts: string[] = []
  let token = ""
  let quoted = false
  let escaped = false
  for (const character of value) {
    if (escaped) {
      token += character
      escaped = false
      continue
    }
    if (character === "\\") {
      token += character
      escaped = true
      continue
    }
    if (character === '"') {
      token += character
      quoted = !quoted
      continue
    }
    if (!quoted && character === ",") {
      parts.push(token)
      token = ""
      continue
    }
    // Alternate separators and multi-valued RDNs are valid RFC forms, but
    // electron-updater flattens them into a Map. Reject them here so the
    // expected certificate identity has one unambiguous canonical form.
    if (!quoted && (character === ";" || character === "+")) return
    token += character
  }
  if (quoted || escaped) return
  parts.push(token)
  return parts
}

function distinguishedNameEqualsIndex(part: string) {
  let quoted = false
  let escaped = false
  for (let index = 0; index < part.length; index += 1) {
    const character = part[index]!
    if (escaped) {
      escaped = false
      continue
    }
    if (character === "\\") {
      escaped = true
      continue
    }
    if (character === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && character === "=") return index
  }
  return -1
}

/** Canonical certificate publisher embedded into Windows update metadata. */
export function resolveWindowsPublisherName(value: unknown): string | undefined {
  if (typeof value !== "string") return
  const publisher = value.trim()
  if (!publisher || publisher.length > 256 || /[\u0000-\u001f\u007f]/.test(publisher)) return
  const parts = splitDistinguishedName(publisher)
  if (!parts || parts.length < 2) return

  const attributes = new Set<string>()
  const canonical: string[] = []
  for (const rawPart of parts) {
    const part = rawPart.trim()
    const equals = distinguishedNameEqualsIndex(part)
    if (equals <= 0) return
    const key = part.slice(0, equals).trim().toUpperCase()
    const attributeValue = part.slice(equals + 1).trim()
    const semanticValue =
      attributeValue.startsWith('"') && attributeValue.endsWith('"')
        ? attributeValue.slice(1, -1).trim()
        : attributeValue
    if (
      !/^(?:[A-Z][A-Z\d]*|\d+(?:\.\d+)+)$/.test(key) ||
      !semanticValue ||
      attributes.has(key)
    )
      return
    attributes.add(key)
    canonical.push(`${key}=${attributeValue}`)
  }
  if (!attributes.has("CN") || !attributes.has("O")) return
  return canonical.join(", ")
}
