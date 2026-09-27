import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useLanguage } from "./runtime"

export function DiskUtilityWorkspaceTabs(props: {
  value: "all" | "cleanup" | "changes"
  onChange: (value: "all" | "cleanup" | "changes") => void
  className?: string
}) {
  const language = useLanguage()
  return (
    <Tabs
      value={props.value}
      onValueChange={(value) =>
        props.onChange(value as "all" | "cleanup" | "changes")
      }
      className={props.className}
    >
      <TabsList
        className="h-9 w-full rounded-[9px] border border-border-weaker-base/70 bg-surface-raised-base/70 p-[3px]"
        aria-label={language.t("disk.explore.choose")}
      >
        <TabsTrigger
          value="all"
          className="text-xs text-text-weak data-active:bg-surface-raised-strong data-active:text-text-strong data-active:shadow-[0_1px_3px_rgb(0_0_0/0.16)]"
        >
          {language.t("disk.common.explore")}
        </TabsTrigger>
        <TabsTrigger
          value="cleanup"
          className="text-xs text-text-weak data-active:bg-surface-raised-strong data-active:text-text-strong data-active:shadow-[0_1px_3px_rgb(0_0_0/0.16)]"
        >
          {language.t("disk.common.cleanup")}
        </TabsTrigger>
        <TabsTrigger
          value="changes"
          className="text-xs text-text-weak data-active:bg-surface-raised-strong data-active:text-text-strong data-active:shadow-[0_1px_3px_rgb(0_0_0/0.16)]"
        >
          {language.t("disk.common.activity")}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
