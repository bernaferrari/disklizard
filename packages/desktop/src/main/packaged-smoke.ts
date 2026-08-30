import { isAbsolute, relative, resolve } from "node:path"

export const PACKAGED_SMOKE_FIXTURE_ARGUMENT = "--disklizard-packaged-smoke-fixture="
export const PACKAGED_SMOKE_USER_DATA_ARGUMENT = "--disklizard-packaged-smoke-user-data="

export type PackagedSmokeConfig = {
  fixturePath: string
  userDataPath: string
}

function argumentValues(argv: readonly string[], prefix: string) {
  return argv.filter((argument) => argument.startsWith(prefix)).map((argument) => argument.slice(prefix.length))
}

function containsPath(root: string, candidate: string) {
  const nested = relative(root, candidate)
  return nested === "" || (!nested.startsWith("..") && !isAbsolute(nested))
}

/**
 * Parse the only runtime seam present in an explicit packaged-smoke build.
 * Normal builds ignore these arguments entirely, and a smoke invocation must
 * isolate fixture data from the application's persisted profile.
 */
export function resolvePackagedSmokeConfig(
  argv: readonly string[],
  packaged: boolean,
  smokeBuild: boolean,
): PackagedSmokeConfig | undefined {
  if (!packaged || !smokeBuild) return undefined

  const fixtureValues = argumentValues(argv, PACKAGED_SMOKE_FIXTURE_ARGUMENT)
  const userDataValues = argumentValues(argv, PACKAGED_SMOKE_USER_DATA_ARGUMENT)
  if (fixtureValues.length === 0 && userDataValues.length === 0) return undefined
  if (
    fixtureValues.length !== 1 ||
    userDataValues.length !== 1 ||
    !fixtureValues[0] ||
    !userDataValues[0] ||
    fixtureValues[0].includes("\0") ||
    userDataValues[0].includes("\0") ||
    !isAbsolute(fixtureValues[0]) ||
    !isAbsolute(userDataValues[0])
  ) {
    throw new Error("Packaged smoke requires absolute fixture and user-data paths")
  }

  const fixturePath = resolve(fixtureValues[0])
  const userDataPath = resolve(userDataValues[0])
  if (containsPath(fixturePath, userDataPath) || containsPath(userDataPath, fixturePath)) {
    throw new Error("Packaged smoke fixture and user-data paths must not overlap")
  }
  return { fixturePath, userDataPath }
}
