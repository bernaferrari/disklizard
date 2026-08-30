export const DESKTOP_CHANNELS = ["dev", "beta", "prod"] as const

export type DesktopChannel = (typeof DESKTOP_CHANNELS)[number]

export const PRODUCT_NAME = "DiskLizard"
export const APP_PROTOCOL = "disklizard"

export const APP_IDS = {
  dev: "io.github.bernaferrari.disklizard.dev",
  beta: "io.github.bernaferrari.disklizard.beta",
  prod: "io.github.bernaferrari.disklizard",
} as const satisfies Record<DesktopChannel, string>

export const APP_NAMES = {
  dev: `${PRODUCT_NAME} Dev`,
  beta: `${PRODUCT_NAME} Beta`,
  prod: PRODUCT_NAME,
} as const satisfies Record<DesktopChannel, string>

/**
 * DISKLIZARD_CHANNEL is the canonical build-time channel. OPENCODE_CHANNEL is
 * only a compatibility fallback for local builds that have not switched yet.
 */
export function resolveDesktopChannel(channel: unknown, legacyChannel?: unknown): DesktopChannel {
  const raw = channel ?? legacyChannel
  return isDesktopChannel(raw) ? raw : "dev"
}

function isDesktopChannel(value: unknown): value is DesktopChannel {
  return typeof value === "string" && DESKTOP_CHANNELS.includes(value as DesktopChannel)
}

export function appIdentity(channel: DesktopChannel, packaged: boolean) {
  const buildChannel = packaged ? channel : "dev"
  return { appId: APP_IDS[buildChannel], name: APP_NAMES[buildChannel] }
}

export function updaterFeedChannel(channel: DesktopChannel): "beta" | "latest" {
  return channel === "beta" ? "beta" : "latest"
}

export type PublicReleaseRepository = {
  owner: string
  repo: string
  private: false
}

type ReleaseRepositoryEnvironment = {
  DISKLIZARD_RELEASE_OWNER?: unknown
  DISKLIZARD_RELEASE_REPO?: unknown
  DISKLIZARD_RELEASE_PUBLIC?: unknown
}

const GITHUB_OWNER = /^[A-Za-z\d](?:[A-Za-z\d-]{0,37}[A-Za-z\d])?$/
const GITHUB_REPOSITORY = /^[A-Za-z\d._-]{1,100}$/

/**
 * Updates are configured only after release automation explicitly identifies
 * and acknowledges a public repository. Repository visibility cannot be
 * inferred from electron-builder's `private` field.
 */
export function resolvePublicReleaseRepository(
  environment: ReleaseRepositoryEnvironment = process.env,
): PublicReleaseRepository | undefined {
  if (environment.DISKLIZARD_RELEASE_PUBLIC !== "true") return
  const owner = environment.DISKLIZARD_RELEASE_OWNER ?? "bernaferrari"
  const repo = environment.DISKLIZARD_RELEASE_REPO
  if (typeof owner !== "string" || !GITHUB_OWNER.test(owner)) return
  if (typeof repo !== "string" || !GITHUB_REPOSITORY.test(repo) || repo === "." || repo === "..") return
  return { owner, repo, private: false }
}

export function updaterPublishConfig(
  channel: DesktopChannel,
  repository: PublicReleaseRepository | undefined = resolvePublicReleaseRepository(),
) {
  if (channel === "dev") return undefined
  if (!repository) return undefined
  return {
    provider: "github" as const,
    owner: repository.owner,
    repo: repository.repo,
    channel: updaterFeedChannel(channel),
    private: false,
  }
}
