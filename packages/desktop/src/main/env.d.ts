interface ImportMetaEnv {
  readonly DISKLIZARD_CHANNEL?: string
  readonly DISKLIZARD_RELEASE_OWNER?: string
  readonly DISKLIZARD_RELEASE_REPO?: string
  readonly DISKLIZARD_RELEASE_PUBLIC?: string
  /** Enables the destructive-to-normal-startup packaged smoke entry only in an explicit CI fixture build. */
  readonly DISKLIZARD_PACKAGED_SMOKE?: string
  /** Compatibility for desktop bundles built before DISKLIZARD_CHANNEL. */
  readonly OPENCODE_CHANNEL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
