import { afterEach, describe, expect, it } from "bun:test"
import { chmod, link, mkdir, mkdtemp, readdir, rm, stat, symlink, truncate, utimes, writeFile } from "node:fs/promises"
import { platform, tmpdir } from "node:os"
import { join } from "node:path"
import {
  assertSafeDeletionPath,
  mountExclusions,
  parseDfOutput,
  parseWindowsDriveOutput,
  scanPath,
  scanPathSync,
} from "./scan"
import type { ScanDiscovery } from "./types"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "disklizard-scan-"))
  roots.push(root)
  await Promise.all([mkdir(join(root, "$Recycle.Bin")), mkdir(join(root, "Windows.old")), mkdir(join(root, ".Trash"))])
  await Promise.all([
    writeFile(join(root, "$Recycle.Bin", "deleted.bin"), new Uint8Array(11)),
    writeFile(join(root, "Windows.old", "system.bin"), new Uint8Array(13)),
    writeFile(join(root, ".Trash", "item.bin"), new Uint8Array(17)),
    writeFile(join(root, "pagefile.sys"), new Uint8Array(19)),
  ])
  return root
}

describe("disk scanner", () => {
  it("accounts for large system and trash entries instead of hiding them", async () => {
    const root = await fixture()
    const result = await scanPathSync(root, {
      concurrency: 4,
      maxChildren: 100,
      maxDepth: 4,
      sizeMode: "logical",
    })

    expect(result.size).toBe(60)
    expect(result.children.map((child) => child.name).sort()).toEqual([
      "$Recycle.Bin",
      ".Trash",
      "Windows.old",
      "pagefile.sys",
    ])
  })

  it("keeps worker and in-process results identical", async () => {
    const root = await fixture()
    const options = { concurrency: 4, maxChildren: 100, maxDepth: 4 }
    const [worker, local] = await Promise.all([
      scanPath(root, { ...options, useWorker: true }),
      scanPathSync(root, options),
    ])

    expect(worker).toEqual(local)
  })

  it("retains named developer markers below the size cutoff in both scanners", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-preserve-"))
    roots.push(root)
    await Promise.all([
      writeFile(join(root, "large-a.bin"), new Uint8Array(50)),
      writeFile(join(root, "large-b.bin"), new Uint8Array(40)),
      writeFile(join(root, "large-c.bin"), new Uint8Array(30)),
      writeFile(join(root, ".git"), new Uint8Array(1)),
    ])
    const options = { maxChildren: 2, preserveNames: [".git"], sizeMode: "logical" as const }
    const [local, worker] = await Promise.all([
      scanPathSync(root, options),
      scanPath(root, { ...options, useWorker: true }),
    ])

    expect(worker).toEqual(local)
    expect(local.children.map((child) => child.name)).toContain(".git")
    expect(local.children.find((child) => child.isOther)).toMatchObject({ name: "Other (1 items)", size: 30 })
    expect(local.size).toBe(121)
  })

  it("retains the ancestry of developer artifacts hidden below a parent cutoff", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-preserve-branches-"))
    roots.push(root)
    const projects = Array.from({ length: 60 }, (_, index) => join(root, `project-${index}`, "node_modules"))
    await Promise.all(projects.map((path) => mkdir(path, { recursive: true })))
    await Promise.all(projects.map((path, index) => writeFile(join(path, `package-${index}.js`), new Uint8Array(1))))
    await Promise.all(
      Array.from({ length: 60 }, (_, index) => writeFile(join(root, `large-${index}.bin`), new Uint8Array(100))),
    )
    const options = {
      maxChildren: 2,
      maxDepth: 6,
      preserveNames: ["node_modules"],
      sizeMode: "logical" as const,
    }

    const [local, worker] = await Promise.all([
      scanPathSync(root, options),
      scanPath(root, { ...options, useWorker: true }),
    ])
    const retainedProjects = local.children.filter((child) => child.name.startsWith("project-"))

    expect(worker).toEqual(local)
    expect(retainedProjects).toHaveLength(60)
    expect(retainedProjects.every((project) => project.children.some((child) => child.name === "node_modules"))).toBe(
      true,
    )
    expect(local.size).toBe(6060)
  })

  it("collapses known artifact interiors until the user scans one directly", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-lazy-artifact-"))
    roots.push(root)
    const modules = join(root, "project", "node_modules")
    await mkdir(join(modules, "package", "nested"), { recursive: true })
    const moduleFile = join(modules, "package", "nested", "index.js")
    const changedAt = new Date("2022-04-05T12:00:00.000Z")
    await writeFile(moduleFile, new Uint8Array(31))
    await utimes(moduleFile, changedAt, changedAt)
    const options = {
      collapseNames: ["node_modules"],
      preserveNames: ["node_modules"],
      sizeMode: "logical" as const,
    }

    const [local, worker, focused] = await Promise.all([
      scanPathSync(root, options),
      scanPath(root, { ...options, useWorker: true }),
      scanPath(modules, { ...options, useWorker: true }),
    ])
    const collapsed = local.children[0].children[0]

    expect(worker).toEqual(local)
    expect(collapsed).toMatchObject({ name: "node_modules", size: 31, isCollapsed: true, children: [] })
    expect(Math.abs((collapsed.modifiedAt ?? 0) - changedAt.getTime())).toBeLessThan(2_000)
    expect(focused).toMatchObject({ name: "node_modules", size: 31 })
    expect(Math.abs((focused.modifiedAt ?? 0) - changedAt.getTime())).toBeLessThan(2_000)
    expect(focused.isCollapsed).toBeUndefined()
    expect(focused.children).not.toHaveLength(0)
  })

  it("retains only requested direct-entry signatures on collapsed build trees", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-build-signatures-"))
    roots.push(root)
    const target = join(root, "project", "target")
    await mkdir(join(target, "debug"), { recursive: true })
    await mkdir(join(target, "unrelated"), { recursive: true })
    await Promise.all([
      writeFile(join(target, ".rustc_info.json"), new Uint8Array(7)),
      writeFile(join(target, "debug", "app.bin"), new Uint8Array(23)),
      writeFile(join(target, "unrelated", "noise.bin"), new Uint8Array(11)),
    ])
    const options = {
      collapseNames: ["target"],
      preserveNames: ["target"],
      signatureNames: [".rustc_info.json", "debug", "release"],
      sizeMode: "logical" as const,
    }

    const [local, worker] = await Promise.all([
      scanPathSync(root, options),
      scanPath(root, { ...options, useWorker: true }),
    ])
    const collapsed = local.children[0].children[0]

    expect(worker).toEqual(local)
    expect(collapsed).toMatchObject({
      name: "target",
      size: 41,
      isCollapsed: true,
      children: [],
      signatures: [".rustc_info.json", "debug"],
    })
  })

  it("counts physical allocation and charges parallel hard links only once", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-hardlinks-"))
    roots.push(root)
    const primary = join(root, "primary.bin")
    await writeFile(primary, new Uint8Array(4096))
    await link(primary, join(root, "parallel.bin"))
    const stats = await stat(primary)
    const expectedPhysical = platform() === "win32" ? stats.size : stats.blocks * 512

    const [local, worker, logical] = await Promise.all([
      scanPathSync(root, { sizeMode: "physical" }),
      scanPath(root, { sizeMode: "physical", useWorker: true }),
      scanPathSync(root, { sizeMode: "logical" }),
    ])

    expect(worker.size).toBe(local.size)
    expect(worker.children.map((child) => child.hardLink).sort((a, b) => String(a).localeCompare(String(b)))).toEqual([
      "primary",
      "secondary",
    ])
    expect(local.size).toBe(expectedPhysical)
    expect(local.children.map((child) => child.hardLink).sort((a, b) => String(a).localeCompare(String(b)))).toEqual([
      "primary",
      "secondary",
    ])
    expect(logical.size).toBe(stats.size * 2)
  })

  it("does not mistake a sparse file's apparent length for occupied space", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-sparse-"))
    roots.push(root)
    const sparse = join(root, "sparse.bin")
    await writeFile(sparse, "")
    await truncate(sparse, 8 * 1024 * 1024)
    const stats = await stat(sparse)

    const physical = await scanPathSync(root, { sizeMode: "physical" })
    const logical = await scanPathSync(root, { sizeMode: "logical" })

    expect(physical.size).toBe(platform() === "win32" ? stats.size : stats.blocks * 512)
    expect(logical.size).toBe(stats.size)
  })

  it("does not cross explicitly excluded mount roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-mounts-"))
    roots.push(root)
    const mounted = join(root, "External")
    await mkdir(mounted)
    await Promise.all([
      writeFile(join(root, "local.bin"), new Uint8Array(23)),
      writeFile(join(mounted, "remote.bin"), new Uint8Array(41)),
    ])
    const options = { sizeMode: "logical" as const, excludePaths: [`${mounted}/`] }

    const [local, worker] = await Promise.all([
      scanPathSync(root, options),
      scanPath(root, { ...options, useWorker: true }),
    ])

    expect(worker).toEqual(local)
    expect(local.size).toBe(23)
    expect(local.children.map((child) => child.name)).toEqual(["local.bin"])
  })

  it("counts every byte below the visual depth limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-deep-"))
    roots.push(root)
    let leaf = root
    for (let depth = 0; depth < 18; depth++) leaf = join(leaf, `level-${depth}`)
    await mkdir(leaf, { recursive: true })
    await writeFile(join(leaf, "deep.bin"), new Uint8Array(37))

    const [local, worker] = await Promise.all([
      scanPathSync(root, { maxDepth: 1, sizeMode: "logical" }),
      scanPath(root, { maxDepth: 1, sizeMode: "logical", useWorker: true }),
    ])

    expect(worker).toEqual(local)
    expect(local.size).toBe(37)
  })

  it("reports unreadable subtrees instead of silently presenting a complete scan", async () => {
    if (platform() === "win32") return
    const root = await mkdtemp(join(tmpdir(), "disklizard-access-"))
    roots.push(root)
    const blocked = join(root, "private")
    await mkdir(blocked)
    await writeFile(join(blocked, "secret.bin"), new Uint8Array(41))
    await writeFile(join(root, "visible.bin"), new Uint8Array(23))
    await chmod(blocked, 0)

    try {
      const readable = await readdir(blocked).then(
        () => true,
        () => false,
      )
      if (readable) return

      const [local, worker] = await Promise.all([
        scanPathSync(root, { sizeMode: "logical" }),
        scanPath(root, { sizeMode: "logical", useWorker: true }),
      ])

      expect(worker).toEqual(local)
      expect(local.size).toBe(23)
      expect(local.scanIssues).toEqual({ unreadableCount: 1, samplePaths: [blocked] })
    } finally {
      await chmod(blocked, 0o700)
    }
  })

  it("maps a single dropped file as a valid scan target", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-file-"))
    roots.push(root)
    const target = join(root, "recording.MOV")
    await writeFile(target, new Uint8Array(29))

    const [local, worker] = await Promise.all([
      scanPathSync(target, { sizeMode: "logical" }),
      scanPath(target, { sizeMode: "logical", useWorker: true }),
    ])

    expect(worker).toEqual(local)
    expect(local).toMatchObject({ name: "recording.MOV", path: target, size: 29, isDir: false, ext: "mov" })
  })

  it("terminates a worker scan when cancelled", async () => {
    const root = await fixture()
    const controller = new AbortController()
    const scan = scanPath(root, { signal: controller.signal, useWorker: true })
    controller.abort(new Error("test cancellation"))

    const error = await scan.then(
      () => null,
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(Error)
    expect(error).toHaveProperty("message", "test cancellation")
  })

  it("rejects destructive paths that resolve through an alias into OS data", async () => {
    if (platform() === "win32") return
    const root = await mkdtemp(join(tmpdir(), "disklizard-alias-"))
    roots.push(root)
    const alias = join(root, "system-alias")
    await symlink("/etc", alias, "dir")

    const error = await assertSafeDeletionPath(join(alias, "hosts")).then(
      () => null,
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(Error)
    expect(error).toHaveProperty("message", expect.stringContaining("protected"))
  })

  it("emits a final progress snapshot", async () => {
    const root = await fixture()
    const progress: Array<{ filesScanned: number; size: number; done?: boolean }> = []
    const result = await scanPath(root, {
      useWorker: true,
      onProgress: (event) => progress.push(event),
    })

    expect(progress.at(-1)).toMatchObject({ filesScanned: 4, size: result.size, done: true })
  })

  it("streams compact completed root branches without changing the final tree", async () => {
    const root = await fixture()
    const localDiscoveries: ScanDiscovery[] = []
    const workerDiscoveries: ScanDiscovery[] = []
    const options = { maxChildren: 100, maxDepth: 4, sizeMode: "logical" as const }

    const [local, worker] = await Promise.all([
      scanPathSync(root, {
        ...options,
        onProgress: (event) => {
          if (event.discovery) localDiscoveries.push(event.discovery)
        },
      }),
      scanPath(root, {
        ...options,
        useWorker: true,
        onProgress: (event) => {
          if (event.discovery) workerDiscoveries.push(event.discovery)
        },
      }),
    ])

    expect(worker).toEqual(local)
    expect(localDiscoveries.sort((a, b) => a.path.localeCompare(b.path))).toEqual(
      workerDiscoveries.sort((a, b) => a.path.localeCompare(b.path)),
    )
    expect(localDiscoveries).toHaveLength(local.children.length)
    expect(localDiscoveries.every((item) => !("children" in item) && item.size > 0)).toBe(true)
  })

  it("caps root-file discoveries so a flat folder cannot flood progress IPC", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-discovery-cap-"))
    roots.push(root)
    await Promise.all(
      Array.from({ length: 40 }, (_, index) => writeFile(join(root, `file-${index}.bin`), new Uint8Array(1))),
    )
    const counts: number[] = []

    await Promise.all(
      [false, true].map(async (useWorker) => {
        let discoveries = 0
        await scanPath(root, {
          useWorker,
          sizeMode: "logical",
          onProgress: (event) => {
            if (event.discovery) discoveries++
          },
        })
        counts.push(discoveries)
      }),
    )

    expect(counts).toEqual([24, 24])
  })
})

describe("drive discovery", () => {
  it("identifies nested mounts without excluding the selected volume itself", () => {
    const drive = (path: string) => ({
      path,
      name: path,
      label: path,
      total: 1,
      free: 0,
      used: 1,
      type: "local" as const,
    })

    expect(mountExclusions("/", [drive("/"), drive("/home"), drive("/media/Archive")], "linux")).toEqual([
      "/home",
      "/media/Archive",
    ])
    expect(mountExclusions("/media/Archive/", [drive("/"), drive("/media/Archive")], "linux")).toEqual([])
    expect(mountExclusions("C:\\", [drive("C:\\"), drive("D:\\")], "win32")).toEqual([])
  })

  it("parses single and multiple Windows volumes with the right device types", () => {
    const output = JSON.stringify([
      { DeviceID: "c:", VolumeName: "Workstation", Size: "1000", FreeSpace: "400", DriveType: 3 },
      { DeviceID: "d:", VolumeName: "Camera", Size: 500, FreeSpace: 300, DriveType: 2 },
      { DeviceID: "z:", VolumeName: "Studio NAS", Size: 9000, FreeSpace: 2000, DriveType: 4 },
      { DeviceID: "e:", VolumeName: "Installer", Size: 700, FreeSpace: 0, DriveType: 5 },
    ])

    expect(parseWindowsDriveOutput(output)).toEqual([
      {
        path: "C:\\",
        name: "Workstation",
        label: "Workstation (C:)",
        total: 1000,
        free: 400,
        used: 600,
        type: "local",
      },
      {
        path: "D:\\",
        name: "Camera",
        label: "Camera (D:)",
        total: 500,
        free: 300,
        used: 200,
        type: "removable",
      },
      {
        path: "Z:\\",
        name: "Studio NAS",
        label: "Studio NAS (Z:)",
        total: 9000,
        free: 2000,
        used: 7000,
        type: "network",
      },
    ])
    expect(parseWindowsDriveOutput('{"DeviceID":"f:","Size":50,"FreeSpace":10,"DriveType":3}')).toEqual([
      {
        path: "F:\\",
        name: "Drive F:",
        label: "(F:)",
        total: 50,
        free: 10,
        used: 40,
        type: "local",
      },
    ])
  })

  it("collapses APFS support volumes while keeping external disks", () => {
    const output = `Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/disk3s1s1 1000000000 100 200000000 80% /
/dev/disk3s5 1000000000 700000000 200000000 80% /System/Volumes/Data
/dev/disk8s1 500000000 100000000 400000000 20% /Volumes/Studio\\040Drive
/dev/disk9s1 20000000 19000000 1000000 95% /Library/Developer/CoreSimulator/Volumes/iOS_23F77`

    expect(parseDfOutput(output, "darwin")).toEqual([
      {
        path: "/",
        name: "Macintosh HD",
        label: "Macintosh HD (/)",
        total: 1_024_000_000_000,
        free: 204_800_000_000,
        used: 819_200_000_000,
        type: "local",
      },
      {
        path: "/Volumes/Studio Drive",
        name: "Studio Drive",
        label: "Studio Drive (/Volumes/Studio Drive)",
        total: 512_000_000_000,
        free: 409_600_000_000,
        used: 102_400_000_000,
        type: "removable",
      },
    ])
  })

  it("labels Linux roots, removable media, and network mounts correctly", () => {
    const output = `Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/nvme0n1p2 900000000 500000000 400000000 56% /
/dev/sdb1 200000000 1000000 199000000 1% /media/alex/Archive\\040SSD
server:/team 300000000 100000000 200000000 34% /mnt/team
overlay 900000000 500000000 400000000 56% /var/lib/docker/overlay2/demo`
    const drives = parseDfOutput(output, "linux")

    expect(drives.map((drive) => [drive.name, drive.type])).toEqual([
      ["System", "local"],
      ["Archive SSD", "removable"],
      ["team", "network"],
    ])
  })
})
