import path from "node:path"
import { fileURLToPath } from "node:url"

import type { Configuration } from "electron-builder"
import { updaterPublishConfig, type DesktopChannel } from "./src/main/product-identity"

const packageDir = path.dirname(fileURLToPath(import.meta.url))

const PRODUCT = {
  name: "DiskLizard",
  appId: "io.github.bernaferrari.disklizard",
  repository: { owner: "bernaferrari", repo: "disklizard" },
} as const

const metainfoFpm = (appId: string) =>
  `${path.join(packageDir, "resources", `${appId}.metainfo.xml`)}=/usr/share/metainfo/${appId}.metainfo.xml`

const channel = ((): DesktopChannel => {
  // OPENCODE_CHANNEL is kept only so existing local packaging commands continue
  // to select their channel while the desktop runtime migrates to DISKLIZARD_CHANNEL.
  const raw = process.env.DISKLIZARD_CHANNEL ?? process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

const APP_IDS = {
  dev: `${PRODUCT.appId}.dev`,
  beta: `${PRODUCT.appId}.beta`,
  prod: PRODUCT.appId,
} as const

const getBase = (appId: string): Configuration => ({
  artifactName: "disklizard-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  // Linux launchers are .desktop files, so this is the desktop file name,
  // not just the app id.
  // https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html
  // https://www.electron.build/docs/linux/
  extraMetadata: {
    desktopName: `${appId}.desktop`,
  },
  files: ["out/**/*", "resources/**/*", "!resources/opencode-cli*"],
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
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: true,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: true,
  },
  protocols: {
    name: PRODUCT.name,
    schemes: ["disklizard"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    target: ["nsis"],
    verifyUpdateCodeSignature: true,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
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

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId,
        productName: `${PRODUCT.name} Dev`,
        protocols: { name: `${PRODUCT.name} Dev`, schemes: ["disklizard"] },
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "disklizard-dev", fpm: [metainfoFpm(appId)] },
      }
    }
    case "beta": {
      return {
        ...base,
        appId,
        productName: `${PRODUCT.name} Beta`,
        protocols: { name: `${PRODUCT.name} Beta`, schemes: ["disklizard"] },
        publish: updaterPublishConfig("beta"),
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "disklizard-beta", fpm: [metainfoFpm(appId)] },
      }
    }
    case "prod": {
      return {
        ...base,
        appId,
        productName: PRODUCT.name,
        protocols: { name: PRODUCT.name, schemes: ["disklizard"] },
        publish: updaterPublishConfig("prod"),
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "disklizard", fpm: [metainfoFpm(appId)] },
      }
    }
  }
}

export default getConfig()
