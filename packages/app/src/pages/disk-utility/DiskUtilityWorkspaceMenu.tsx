import { Button } from "@/components/dl/button"
import { DropdownMenu } from "@/components/dl/dropdown-menu"
import { Icon } from "@/components/dl/icon"
import { useLanguage } from "./runtime"

export function DiskUtilityWorkspaceMenu(props: {
  value: "all" | "cleanup" | "changes"
  onChange: (value: "all" | "cleanup" | "changes") => void
  className?: string
}) {
  const language = useLanguage()
  const labels = {
    all: language.t("disk.common.explore"),
    cleanup: language.t("disk.common.cleanup"),
    changes: language.t("disk.common.activity"),
  }
  return (
    <div className={props.className}>
      <DropdownMenu placement="bottom-end" gutter={6}>
        <DropdownMenu.Trigger
          as={Button}
          size="small"
          variant="ghost"
          className="min-h-10 gap-2 px-3 text-text-strong"
          title={labels[props.value]}
        >
          <span className="text-13-medium">{labels[props.value]}</span>
          <Icon name="chevron-down" className="text-icon-weak size-3" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.RadioGroup
              value={props.value}
              onChange={(value) =>
                props.onChange(value as "all" | "cleanup" | "changes")
              }
              aria-label={language.t("disk.explore.choose")}
            >
              {(["all", "cleanup", "changes"] as const).map((value) => (
                <DropdownMenu.RadioItem key={value} value={value}>
                  <DropdownMenu.ItemLabel>
                    {labels[value]}
                  </DropdownMenu.ItemLabel>
                  <DropdownMenu.ItemIndicator>
                    <Icon name="check" />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  )
}
