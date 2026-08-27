import { describe, expect, it } from "bun:test"
import {
  mountExclusions,
  parseApfsSnapshotOutput,
  parseApfsSnapshotPlist,
  parseDfMountDiscovery,
  parseDfOutput,
  parseLinuxMountInfo,
  parseMacDriveInfoPlist,
  parseWindowsDriveDiscoveryOutput,
  parseWindowsDriveOutput,
} from "./drive-discovery"

describe("macOS storage facts", () => {
  it("keeps APFS shared capacity distinct from ordinary available space", () => {
    expect(
      parseMacDriveInfoPlist(`
        <plist><dict>
          <key>FilesystemType</key><string>apfs</string>
          <key>APFSContainerFree</key><integer>123456</integer>
        </dict></plist>
      `),
    ).toEqual({ filesystem: "apfs", sharedFree: 123456 })
  })

  it("explains snapshot pressure without inventing a byte size", () => {
    const facts = parseApfsSnapshotOutput(`
Snapshot for disk3s1 (2 found)
|
+-- one
    Name:        com.apple.TimeMachine.2026-08-10
    Purgeable:   Yes
+-- two
    Name:        com.apple.os.update
    Purgeable:   No
`)
    expect(facts).toEqual({
      snapshotCount: 2,
      purgeableSnapshotCount: 1,
      timeMachineSnapshotCount: 1,
      apfsSnapshots: [
        { name: "com.apple.TimeMachine.2026-08-10", purgeable: true, isTimeMachine: true },
        { name: "com.apple.os.update", purgeable: false },
      ],
    })
  })

  it("keeps bounded, read-only APFS snapshot identities from diskutil plist output", () => {
    const facts = parseApfsSnapshotPlist(`
      <plist version="1.0"><dict><key>Snapshots</key><array>
        <dict>
          <key>SnapshotName</key><string>com.apple.TimeMachine.2026-08-10 &amp; 11</string>
          <key>SnapshotUUID</key><string>F8D5D41E-7A4E-4F53-90EC-4E516CA98003</string>
          <key>SnapshotPurgeable</key><true/>
        </dict>
        <dict>
          <key>Name</key><string>com.apple.os.update</string>
          <key>UUID</key><string>0847BBE4-0B21-458E-82A5-7AF1C2C4BCB4</string>
          <key>Purgeable</key><string>No</string>
        </dict>
      </array></dict></plist>
    `)
    expect(facts).toEqual({
      snapshotCount: 2,
      purgeableSnapshotCount: 1,
      timeMachineSnapshotCount: 1,
      apfsSnapshots: [
        {
          name: "com.apple.TimeMachine.2026-08-10 & 11",
          uuid: "F8D5D41E-7A4E-4F53-90EC-4E516CA98003",
          purgeable: true,
          isTimeMachine: true,
        },
        {
          name: "com.apple.os.update",
          uuid: "0847BBE4-0B21-458E-82A5-7AF1C2C4BCB4",
          purgeable: false,
        },
      ],
    })
  })

  it("reports an empty snapshot list without inventing storage bytes", () => {
    expect(parseApfsSnapshotOutput("Snapshot for disk3s1 (0 found)\n")).toEqual({
      snapshotCount: 0,
      apfsSnapshots: [],
    })
  })

  it("leaves an unrecognized human snapshot status unknown", () => {
    expect(
      parseApfsSnapshotOutput(`
Snapshot for disk3s1 (1 found)
|
+-- one
    Name:        com.apple.os.update
    Purgeable:   Unknown
`),
    ).toEqual({
      snapshotCount: 1,
      apfsSnapshots: [{ name: "com.apple.os.update" }],
    })
  })

  it("bounds snapshot identity evidence while retaining the full reported count", () => {
    const snapshots = Array.from(
      { length: 50 },
      (_, index) => `<dict><key>SnapshotName</key><string>snapshot-${index}</string></dict>`,
    ).join("")
    const facts = parseApfsSnapshotPlist(`<plist><array>${snapshots}</array></plist>`)

    expect(facts.snapshotCount).toBe(50)
    expect(facts.apfsSnapshots).toHaveLength(48)
    expect(facts.apfsSnapshots?.[0]).toEqual({ name: "snapshot-0" })
    expect(facts.apfsSnapshots?.[47]).toEqual({ name: "snapshot-47" })
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

  it("keeps Windows directory mount points separate from visible drives", () => {
    const discovery = parseWindowsDriveDiscoveryOutput(
      JSON.stringify({
        Drives: [{ DeviceID: "c:", VolumeName: "Workstation", Size: 1000, FreeSpace: 400, DriveType: 3 }],
        MountRoots: ["C:\\", "C:\\Volumes\\Archive\\", "\\\\?\\Volume{hidden}\\"],
        Complete: true,
      }),
    )

    expect(discovery.complete).toBe(true)
    expect(discovery.drives.map((drive) => drive.path)).toEqual(["C:\\"])
    expect(discovery.mountRoots).toEqual(["C:\\", "C:\\Volumes\\Archive\\"])
    expect(parseWindowsDriveDiscoveryOutput('{"Drives":[],"Complete":false}').complete).toBe(false)
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

  it("retains filtered and tiny df mounts for deletion safety and exposes parse completeness", () => {
    const output = `Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/nvme0n1p2 900000000 500000000 400000000 56% /
tmpfs 1024 1 1023 1% /run/credentials
/dev/sdb1 200000000 1000000 199000000 1% /media/alex/Archive\\040SSD`

    expect(parseDfOutput(output, "linux").map((drive) => drive.path)).toEqual(["/", "/media/alex/Archive SSD"])
    expect(parseDfMountDiscovery(output)).toEqual({
      mountRoots: ["/", "/run/credentials", "/media/alex/Archive SSD"],
      complete: true,
    })
    expect(parseDfMountDiscovery(`${output}\nmalformed row`).complete).toBe(false)
  })

  it("uses Linux mountinfo to retain bind, file, and escaped mount roots", () => {
    const output = `24 1 8:1 / / rw,relatime - ext4 /dev/root rw
25 24 8:1 /projects /home/alex/Projects rw,relatime - ext4 /dev/root rw
26 24 0:42 /hosts /home/alex/Archive\\040Drive/hosts rw - tmpfs tmpfs rw`

    expect(parseLinuxMountInfo(output)).toEqual({
      mountRoots: ["/", "/home/alex/Projects", "/home/alex/Archive Drive/hosts"],
      complete: true,
    })
    expect(parseLinuxMountInfo(`${output}\nmalformed row`).complete).toBe(false)
  })
})
