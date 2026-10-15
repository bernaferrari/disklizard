import { DiskUtilityView } from "./DiskUtilityView"
import { useDiskUtilityWorkspace } from "./use-disk-utility-workspace"

export default function DiskUtilityPage() {
  const model = useDiskUtilityWorkspace()
  return <DiskUtilityView model={model} />
}
