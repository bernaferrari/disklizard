import path from "node:path"
import { fileURLToPath } from "node:url"

import type { Configuration } from "electron-builder"
import { resolveDesktopChannel, updaterPublishConfig, type DesktopChannel } from "./src/main/product-identity"
import { resolveWindowsPublisherName } from "./src/main/updater-policy"

const packageDir = path.dirname(fileURLToPath(import.meta.url))

const PRODUCT = {
  name: "DiskLizard",
  appId: "io.github.bernaferrari.disklizard",
  repository: { owner: "bernaferrari", repo: "disklizard" },
} as const

const metainfoFpm = (appId: string) =>
  `${path.join(packageDir, "resources", `${appId}.metainfo.xml`)}=/usr/share/metainfo/${appId}.metainfo.xml`
const inertAfterInstall = path.join(packageDir, "resources", "linux-after-install.sh")
const inertAfterRemove = path.join(packageDir, "resources", "linux-after-remove.sh")

// This mode is intentionally opt-in. It exists only for CI/local unpacked-app
// smoke tests, where release credentials must never be discovered or used.
const packagedSmoke = process.env.DISKLIZARD_PACKAGED_SMOKE === "1"
// OPENCODE_CHANNEL remains a strict compatibility input. Feed names such as
// `latest` are not build identities and therefore fail closed to `dev`.
// A smoke artifact is always a dev build, even in a release-configured shell.
const channel: DesktopChannel = packagedSmoke
  ? "dev"
  : resolveDesktopChannel(process.env.DISKLIZARD_CHANNEL, process.env.OPENCODE_CHANNEL)
const windowsPublisherName = packagedSmoke
  ? undefined
  : resolveWindowsPublisherName(process.env.DISKLIZARD_WINDOWS_PUBLISHER_NAME)
const publicRelease = packagedSmoke ? undefined : updaterPublishConfig(channel)

const APP_IDS = {
  dev: `${PRODUCT.appId}.dev`,
  beta: `${PRODUCT.appId}.beta`,
  prod: PRODUCT.appId,
} as const

const getBase = (appId: string): Configuration => ({
  artifactName: "disklizard-${os}-${arch}.${ext}",
  directories: {
    output: packagedSmoke ? "dist-smoke" : "dist",
    buildResources: "resources",
  },
  // Linux launchers are .desktop files, so this is the desktop file name,
  // not just the app id.
  // https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html
  // https://www.electron.build/docs/linux/
  extraMetadata: {
    desktopName: `${appId}.desktop`,
  },
  files: ["out/**/*", "!out/**/*.map", "resources/**/*", "!resources/opencode-cli*"],
  extraResources: [
    {
      from: "native/",
      to: "native/",
      filter: [
        "index.js",
        "index.d.ts",
        "build/Release/mac_window.node",
        "swift-build/**",
        "disklizard-scanner",
        "disklizard-scanner.exe",
      ],
    },
  ],
  mac: {
    category: "public.app-category.utilities",
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: !packagedSmoke,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    identity: packagedSmoke ? null : undefined,
    notarize: !packagedSmoke,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: !packagedSmoke,
  },
  win: {
    icon: `resources/icons/icon.ico`,
    target: ["nsis"],
    verifyUpdateCodeSignature: true,
    ...(windowsPublisherName ? { signtoolOptions: { publisherName: windowsPublisherName } } : {}),
    ...(publicRelease && !packagedSmoke ? { forceCodeSigning: true } : {}),
    // Keep version/icon resource editing in smoke builds while making it
    // impossible for an ambient CSC_LINK/WIN_CSC_LINK to sign the fixture.
    ...(packagedSmoke ? { signExecutable: false } : {}),
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    createDesktopShortcut: !packagedSmoke,
    createStartMenuShortcut: !packagedSmoke,
    runAfterFinish: !packagedSmoke,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Utility",
    executableName: appId,
    desktop: {
      entry: {
        // Match the installed .desktop file and hicolor icon basename so
        // Linux shells can associate the running Electron window with its launcher.
        StartupWMClass: appId,
      },
    },
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const appId = APP_IDS[channel]
  const base = getBase(appId)
  const publish = publicRelease
  if (publish && !packagedSmoke && !windowsPublisherName) {
    throw new Error(
      "DISKLIZARD_WINDOWS_PUBLISHER_NAME must match the code-signing certificate before public updates are enabled",
    )
  }

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId,
        productName: `${PRODUCT.name} Dev`,
        deb: { afterInstall: inertAfterInstall, afterRemove: inertAfterRemove, fpm: [metainfoFpm(appId)] },
        rpm: {
          packageName: "disklizard-dev",
          afterInstall: inertAfterInstall,
          afterRemove: inertAfterRemove,
          fpm: [metainfoFpm(appId)],
        },
      }
    }
    case "beta": {
      return {
        ...base,
        appId,
        productName: `${PRODUCT.name} Beta`,
        publish,
        deb: { afterInstall: inertAfterInstall, afterRemove: inertAfterRemove, fpm: [metainfoFpm(appId)] },
        rpm: {
          packageName: "disklizard-beta",
          afterInstall: inertAfterInstall,
          afterRemove: inertAfterRemove,
          fpm: [metainfoFpm(appId)],
        },
      }
    }
    case "prod": {
      return {
        ...base,
        appId,
        productName: PRODUCT.name,
        publish,
        deb: { afterInstall: inertAfterInstall, afterRemove: inertAfterRemove, fpm: [metainfoFpm(appId)] },
        rpm: {
          packageName: "disklizard",
          afterInstall: inertAfterInstall,
          afterRemove: inertAfterRemove,
          fpm: [metainfoFpm(appId)],
        },
      }
    }
  }
}

export default getConfig()
