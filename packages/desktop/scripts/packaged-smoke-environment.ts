const RELEASE_ENVIRONMENT_KEYS = [
  "APPLE_API_KEY",
  "APPLE_API_KEY_ID",
  "APPLE_API_ISSUER",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
  "AZURE_CERTIFICATE_PROFILE_NAME",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "AZURE_CODE_SIGNING_ACCOUNT_NAME",
  "AZURE_CODE_SIGNING_ENDPOINT",
  "AZURE_TENANT_ID",
  "CSC_KEY_PASSWORD",
  "CSC_LINK",
  "DISKLIZARD_RELEASE_OWNER",
  "DISKLIZARD_RELEASE_PUBLIC",
  "DISKLIZARD_RELEASE_REPO",
  "DISKLIZARD_SCANNER_PATH",
  "DISKLIZARD_WINDOWS_PUBLISHER_NAME",
  "DISKLIZARD_NATIVE_SCANNER",
  "ELECTRON_RUN_AS_NODE",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "SENTRY_AUTH_TOKEN",
  "SENTRY_ORG",
  "SENTRY_PROJECT",
  "NODE_OPTIONS",
  "WIN_CSC_KEY_PASSWORD",
  "WIN_CSC_LINK",
] as const

/** Build/package a disposable dev artifact without ambient release authority. */
export function packagedSmokeEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment = { ...source }
  for (const key of RELEASE_ENVIRONMENT_KEYS) delete environment[key]
  environment.DISKLIZARD_CHANNEL = "dev"
  environment.OPENCODE_CHANNEL = "dev"
  environment.DISKLIZARD_PACKAGED_SMOKE = "1"
  environment.CSC_IDENTITY_AUTO_DISCOVERY = "false"
  return environment
}
