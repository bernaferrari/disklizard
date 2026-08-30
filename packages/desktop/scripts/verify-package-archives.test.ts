import { createPackage } from "@electron/asar"
import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  assertDesktopEntryIdentity,
  assertLinuxPackageIdentity,
  assertMetainfoIdentity,
  assertSafePackageScriptlets,
  inspectExtractedLinuxPackage,
  inspectMountedDmg,
  parseHdiutilAttachment,
  parseDebianPackageIdentity,
  parseRpmPackageIdentity,
  readPlistBundleIdentifier,
  validateArchiveExtractionListing,
  validatePackageArchiveEvidence,
  writePackageArchiveEvidence,
} from "./verify-package-archives"

const temporary: string[] = []
const identity = {
  appId: "io.github.bernaferrari.disklizard.dev",
  productName: "DiskLizard Dev",
}
const fixtureSha512 = "a".repeat(128)

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function fixtureRoot(name: string) {
  const root = await mkdtemp(path.join(tmpdir(), `${name}-`))
  temporary.push(root)
  return root
}

async function writeRuntimeArchive(destination: string) {
  const source = await fixtureRoot("disklizard-asar")
  for (const entry of [
    "out/main/index.js",
    "out/main/native-parse-worker.js",
    "out/preload/index.js",
    "out/renderer/index.html",
    "out/renderer/oc-theme-preload.js",
  ]) {
    const target = path.join(source, entry)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, `fixture:${entry}`)
  }
  await mkdir(path.dirname(destination), { recursive: true })
  await createPackage(source, destination)
}

async function writeExecutable(target: string) {
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, "fixture executable")
  await chmod(target, 0o755)
}

async function createMacFixture() {
  const mountRoot = await fixtureRoot("disklizard-dmg")
  const app = path.join(mountRoot, `${identity.productName}.app`)
  await writeExecutable(path.join(app, "Contents", "MacOS", identity.productName))
  await writeFile(
    path.join(app, "Contents", "Info.plist"),
    `<plist><dict><key>CFBundleIdentifier</key><string>${identity.appId}</string></dict></plist>`,
  )
  await writeRuntimeArchive(path.join(app, "Contents", "Resources", "app.asar"))
  await writeExecutable(path.join(app, "Contents", "Resources", "native", "disklizard-scanner"))
  return { app, mountRoot }
}

async function createLinuxFixture() {
  const root = await fixtureRoot("disklizard-linux-package")
  const application = path.join(root, "opt", identity.productName)
  await writeExecutable(path.join(application, identity.appId))
  await writeRuntimeArchive(path.join(application, "resources", "app.asar"))
  await writeExecutable(path.join(application, "resources", "native", "disklizard-scanner"))
  await mkdir(path.join(root, "usr", "share", "applications"), { recursive: true })
  await writeFile(
    path.join(root, "usr", "share", "applications", `${identity.appId}.desktop`),
    `[Desktop Entry]\nExec="/opt/${identity.productName}/${identity.appId}" %U\nStartupWMClass=${identity.appId}\n`,
  )
  await mkdir(path.join(root, "usr", "share", "metainfo"), { recursive: true })
  await writeFile(
    path.join(root, "usr", "share", "metainfo", `${identity.appId}.metainfo.xml`),
    `<component><id>${identity.appId}</id><launchable type="desktop-id">${identity.appId}.desktop</launchable></component>`,
  )
  return { application, root }
}

describe("packaged release archive contents", () => {
  test("desktop identity is read only from one unambiguous Desktop Entry group", () => {
    const valid = `[Desktop Entry]\nExec="/opt/${identity.productName}/${identity.appId}" %U\nStartupWMClass=${identity.appId}\n`
    expect(() => assertDesktopEntryIdentity(valid, identity, "deb")).not.toThrow()
    expect(() =>
      assertDesktopEntryIdentity(
        `[Other]\nExec="/opt/${identity.productName}/${identity.appId}"\nStartupWMClass=${identity.appId}\n` +
          `[Desktop Entry]\nExec=/opt/unrelated/application\n`,
        identity,
        "deb",
      ),
    ).toThrow("Desktop Entry")
    expect(() => assertDesktopEntryIdentity(`${valid}Exec=/opt/unrelated/application\n`, identity, "deb")).toThrow(
      "duplicate",
    )
    expect(() => assertDesktopEntryIdentity(`${valid}[Desktop Entry]\n`, identity, "deb")).toThrow("duplicate")
  })

  test("metainfo identity comes from the component tree rather than comments or nested decoys", () => {
    const valid = `<component type="desktop-application"><id>${identity.appId}</id><launchable type="desktop-id">${identity.appId}.desktop</launchable></component>`
    expect(() => assertMetainfoIdentity(valid, identity, "rpm")).not.toThrow()
    expect(() =>
      assertMetainfoIdentity(
        `<!-- <id>${identity.appId}</id><launchable type="desktop-id">${identity.appId}.desktop</launchable> -->` +
          `<component type="desktop-application"><id>invalid.example</id><launchable type="desktop-id">invalid.desktop</launchable></component>`,
        identity,
        "rpm",
      ),
    ).toThrow("metainfo")
    expect(() =>
      assertMetainfoIdentity(
        `<component><description><id>${identity.appId}</id></description><launchable type="desktop-id">${identity.appId}.desktop</launchable></component>`,
        identity,
        "rpm",
      ),
    ).toThrow("metainfo")
  })

  test("Linux package headers match the frozen package identity", () => {
    const expected = { packageName: "disklizard-dev", version: "0.1.0", architecture: "x64" as const }
    expect(() =>
      assertLinuxPackageIdentity("deb", { name: "disklizard-dev", version: "0.1.0", architecture: "amd64" }, expected),
    ).not.toThrow()
    expect(() =>
      assertLinuxPackageIdentity("rpm", { name: "disklizard-dev", version: "0.1.0", architecture: "x86_64" }, expected),
    ).not.toThrow()
    expect(() =>
      assertLinuxPackageIdentity("deb", { name: "unrelated", version: "0.1.0", architecture: "amd64" }, expected),
    ).toThrow("package identity")
    expect(() =>
      assertLinuxPackageIdentity("rpm", { name: "disklizard-dev", version: "9.0.0", architecture: "x86_64" }, expected),
    ).toThrow("package identity")
  })

  test("Linux package header parsers reject ambiguous metadata", () => {
    expect(
      parseDebianPackageIdentity("Package: disklizard-dev\nVersion: 0.1.0\nArchitecture: amd64\nDescription: fixture\n"),
    ).toEqual({ name: "disklizard-dev", version: "0.1.0", architecture: "amd64" })
    expect(() =>
      parseDebianPackageIdentity(
        "Package: disklizard-dev\nPackage: unrelated\nVersion: 0.1.0\nArchitecture: amd64\n",
      ),
    ).toThrow("duplicate")
    expect(parseRpmPackageIdentity("disklizard-dev\n0.1.0\nx86_64\n")).toEqual({
      name: "disklizard-dev",
      version: "0.1.0",
      architecture: "x86_64",
    })
    expect(() => parseRpmPackageIdentity("disklizard-dev\n0.1.0\nx86_64\nextra\n")).toThrow("metadata")
  })

  test("Linux package install scripts are absent or the owned inert script", () => {
    const inert = "#!/bin/sh\n# DiskLizard packages intentionally have no install-time mutation.\nexit 0\n"
    expect(() => assertSafePackageScriptlets("deb", {})).not.toThrow()
    expect(() => assertSafePackageScriptlets("rpm", { postin: inert, postun: inert })).not.toThrow()
    expect(() => assertSafePackageScriptlets("deb", { postinst: "#!/bin/sh\nchmod 4755 /opt/app/chrome-sandbox\n" })).toThrow(
      "unsafe install script",
    )
    expect(() => assertSafePackageScriptlets("rpm", { trigger: "#!/bin/sh\necho changed\n" })).toThrow(
      "unsafe install script",
    )
  })

  test("a mounted DMG contains one expected app with its executable, ASAR runtime, and native scanner", async () => {
    const { mountRoot } = await createMacFixture()

    await expect(inspectMountedDmg(mountRoot, identity, async () => identity.appId)).resolves.toEqual({
      format: "dmg",
      application: `${identity.productName}.app`,
      executable: true,
      appAsar: true,
      nativeScanner: true,
      identityMetadata: true,
      desktopFile: null,
      metainfo: null,
    })
  })

  test("a DMG must carry the expected bundle identity", async () => {
    const { mountRoot } = await createMacFixture()
    await expect(inspectMountedDmg(mountRoot, identity, async () => "invalid.example")).rejects.toThrow(
      "bundle identity",
    )
  })

  test("macOS bundle identity is extracted structurally with plutil", async () => {
    const calls: Array<{ command: string; args: string[] }> = []
    const result = await readPlistBundleIdentifier("/fixture/Info.plist", async (command, args) => {
      calls.push({ command, args })
      return Buffer.from(`${identity.appId}\n`)
    })
    expect(result).toBe(identity.appId)
    expect(calls).toEqual([
      {
        command: "plutil",
        args: ["-extract", "CFBundleIdentifier", "raw", "-o", "-", "/fixture/Info.plist"],
      },
    ])
  })

  test("hdiutil attachment identity is confined to one private mount and one parent device", () => {
    const workspace = "/private/tmp/disklizard-dmg-fixture"
    expect(
      parseHdiutilAttachment(
        {
          "system-entities": [
            { "dev-entry": "/dev/disk9", "content-hint": "GUID_partition_scheme" },
            {
              "dev-entry": "/dev/disk9s1",
              "content-hint": "Apple_HFS",
              "mount-point": `${workspace}/DiskLizard Dev`,
            },
          ],
        },
        workspace,
      ),
    ).toEqual({ device: "/dev/disk9", mountRoot: `${workspace}/DiskLizard Dev` })
    expect(
      parseHdiutilAttachment(
        {
          "system-entities": [
            { "dev-entry": "/dev/disk10" },
            {
              "dev-entry": "/dev/disk10s1",
              "mount-point": "/private/var/folders/fixture/DiskLizard Dev",
            },
          ],
        },
        "/var/folders/fixture",
      ),
    ).toEqual({ device: "/dev/disk10", mountRoot: "/private/var/folders/fixture/DiskLizard Dev" })
    expect(() =>
      parseHdiutilAttachment(
        {
          "system-entities": [
            { "dev-entry": "/dev/disk9s1", "mount-point": `${workspace}/one` },
            { "dev-entry": "/dev/disk9s2", "mount-point": `${workspace}/two` },
          ],
        },
        workspace,
      ),
    ).toThrow("exactly one mounted filesystem")
    expect(() =>
      parseHdiutilAttachment(
        { "system-entities": [{ "dev-entry": "/dev/disk9s1", "mount-point": "/Volumes/Outside" }] },
        workspace,
      ),
    ).toThrow("private mount root")
  })

  test("a DMG cannot satisfy the contract with a non-file scanner or a second app", async () => {
    const { app, mountRoot } = await createMacFixture()
    const scanner = path.join(app, "Contents", "Resources", "native", "disklizard-scanner")
    await rm(scanner)
    await mkdir(scanner)
    await expect(inspectMountedDmg(mountRoot, identity, async () => identity.appId)).rejects.toThrow("regular file")

    await rm(scanner, { recursive: true })
    await writeExecutable(scanner)
    await mkdir(path.join(mountRoot, "Unexpected.app"))
    await expect(inspectMountedDmg(mountRoot, identity, async () => identity.appId)).rejects.toThrow(
      "exactly one application",
    )
  })

  for (const format of ["deb", "rpm"] as const) {
    test(`${format} contains one coherent Linux application and its desktop metadata`, async () => {
      const { root } = await createLinuxFixture()

      await expect(inspectExtractedLinuxPackage(root, format, identity)).resolves.toEqual({
        format,
        application: `opt/${identity.productName}`,
        executable: true,
        appAsar: true,
        nativeScanner: true,
        identityMetadata: true,
        desktopFile: `usr/share/applications/${identity.appId}.desktop`,
        metainfo: `usr/share/metainfo/${identity.appId}.metainfo.xml`,
      })
    })
  }

  test("Linux verification rejects incomplete metadata and unrelated ASAR locations", async () => {
    const { application, root } = await createLinuxFixture()
    await rm(path.join(root, "usr", "share", "metainfo", `${identity.appId}.metainfo.xml`))
    await expect(inspectExtractedLinuxPackage(root, "deb", identity)).rejects.toThrow("metainfo")

    await writeFile(
      path.join(root, "usr", "share", "metainfo", `${identity.appId}.metainfo.xml`),
      `<component><id>${identity.appId}</id></component>`,
    )
    await rm(path.join(application, identity.appId))
    await expect(inspectExtractedLinuxPackage(root, "rpm", identity)).rejects.toThrow("executable")
  })

  test("Linux desktop metadata must launch the verified packaged executable", async () => {
    const { root } = await createLinuxFixture()
    await writeFile(
      path.join(root, "usr", "share", "applications", `${identity.appId}.desktop`),
      `[Desktop Entry]\nExec=/opt/unrelated/application\nStartupWMClass=${identity.appId}\n`,
    )

    await expect(inspectExtractedLinuxPackage(root, "deb", identity)).rejects.toThrow("verified executable")
  })

  test("Linux metainfo must point to the verified desktop entry", async () => {
    const { root } = await createLinuxFixture()
    await writeFile(
      path.join(root, "usr", "share", "metainfo", `${identity.appId}.metainfo.xml`),
      `<component><id>${identity.appId}</id><launchable type="desktop-id">unrelated.desktop</launchable></component>`,
    )

    await expect(inspectExtractedLinuxPackage(root, "rpm", identity)).rejects.toThrow("desktop entry")
  })

  test("Linux extraction rejects traversal, links, and special archive entries before writing files", () => {
    expect(() =>
      validateArchiveExtractionListing(
        "./opt/DiskLizard Dev/resources/app.asar\n./usr/share/applications/example.desktop\n",
        "-rw-r--r-- root/root 128 2026-08-27 ./opt/DiskLizard Dev/resources/app.asar\n" +
          "-rw-r--r-- root/root 128 2026-08-27 ./usr/share/applications/example.desktop\n",
        "deb",
      ),
    ).not.toThrow()
    expect(() =>
      validateArchiveExtractionListing(
        "./opt/application\n../../outside\n",
        "-rwxr-xr-x root/root 128 2026-08-27 ./opt/application\n" +
          "-rw-r--r-- root/root 128 2026-08-27 ../../outside\n",
        "deb",
      ),
    ).toThrow("path traversal")
    expect(() =>
      validateArchiveExtractionListing(
        "./opt/application\n./opt/resources\n",
        "-rwxr-xr-x 1 root root 128 Aug 27 2026 ./opt/application\n" +
          "lrwxrwxrwx 1 root root 12 Aug 27 2026 ./opt/resources -> /outside\n",
        "rpm",
      ),
    ).toThrow("link or special")
  })

  test("archive evidence is strict and records all native formats", () => {
    const packageReport = {
      application: `opt/${identity.productName}`,
      executable: true as const,
      appAsar: true as const,
      nativeScanner: true as const,
      identityMetadata: true as const,
      desktopFile: `usr/share/applications/${identity.appId}.desktop`,
      metainfo: `usr/share/metainfo/${identity.appId}.metainfo.xml`,
    }
    expect(
      validatePackageArchiveEvidence({
        schemaVersion: 2,
        platform: "linux",
        identity,
        packages: [
          {
            format: "deb",
            artifact: "disklizard-linux-x64.deb",
            artifactBytes: 1024,
            sha512: fixtureSha512,
            ...packageReport,
          },
          {
            format: "rpm",
            artifact: "disklizard-linux-x64.rpm",
            artifactBytes: 2048,
            sha512: fixtureSha512,
            ...packageReport,
          },
        ],
      }),
    ).toMatchObject({ platform: "linux", packages: [{ format: "deb" }, { format: "rpm" }] })

    expect(() =>
      validatePackageArchiveEvidence({
        schemaVersion: 2,
        platform: "linux",
        identity,
        packages: [
          {
            format: "deb",
            artifact: "disklizard-linux-x64.deb",
            artifactBytes: 1024,
            sha512: fixtureSha512,
            ...packageReport,
          },
        ],
      }),
    ).toThrow("invalid package archive evidence")

    expect(() =>
      validatePackageArchiveEvidence({
        schemaVersion: 2,
        platform: "darwin",
        identity,
        packages: [
          {
            format: "dmg",
            artifact: "disklizard-mac-arm64.dmg",
            artifactBytes: 1024,
            sha512: "not-a-digest",
            application: `${identity.productName}.app`,
            executable: true,
            appAsar: true,
            nativeScanner: true,
            identityMetadata: true,
            desktopFile: null,
            metainfo: null,
          },
        ],
      }),
    ).toThrow("invalid package archive evidence")
  })

  test("writes validated archive evidence atomically without leaving staging files", async () => {
    const root = await fixtureRoot("disklizard-archive-evidence")
    const destination = path.join(root, "evidence", "packaged-archives-linux.json")
    const packageReport = {
      application: `opt/${identity.productName}`,
      executable: true as const,
      appAsar: true as const,
      nativeScanner: true as const,
      identityMetadata: true as const,
      desktopFile: `usr/share/applications/${identity.appId}.desktop`,
      metainfo: `usr/share/metainfo/${identity.appId}.metainfo.xml`,
    }
    const report = validatePackageArchiveEvidence({
      schemaVersion: 2,
      platform: "linux",
      identity,
      packages: [
        {
          format: "deb",
          artifact: "disklizard-linux-x64.deb",
          artifactBytes: 1024,
          sha512: fixtureSha512,
          ...packageReport,
        },
        {
          format: "rpm",
          artifact: "disklizard-linux-x64.rpm",
          artifactBytes: 2048,
          sha512: fixtureSha512,
          ...packageReport,
        },
      ],
    })

    await writePackageArchiveEvidence(report, destination)

    expect(JSON.parse(await readFile(destination, "utf8"))).toEqual(report)
    expect(await readdir(path.dirname(destination))).toEqual([path.basename(destination)])
  })
})
