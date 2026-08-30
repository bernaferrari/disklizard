import { describe, expect, test } from "bun:test"
import { dict as uiEn } from "@opencode-ai/ui/i18n/en"
import { DESKTOP_NATIVE_LOCALES } from "@disklizard/app/native-i18n"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createRendererUiI18n, loadRendererLanguageCatalog, type RendererLanguage } from "."

function language(messages: Readonly<Record<string, string>>): RendererLanguage {
  return {
    locale: "en",
    intl: "en",
    direction: "ltr",
    messages,
  }
}

describe("standalone renderer i18n", () => {
  test("loads the complete English beta catalog without selecting an OS locale", async () => {
    let loads = 0
    const loaded = await loadRendererLanguageCatalog(async () => {
      loads += 1
      return {
        "disk.accessGuidance.rescan": "Use Rescan in the top bar after changing access.",
        "ui.common.cancel": uiEn["ui.common.cancel"],
      }
    })

    expect(loads).toBe(1)
    expect(loaded).toEqual({
      locale: "en",
      intl: "en",
      direction: "ltr",
      messages: {
        "disk.accessGuidance.rescan": "Use Rescan in the top bar after changing access.",
        "ui.common.cancel": uiEn["ui.common.cancel"],
      },
    })
  })

  test("falls back to the bundled English catalog when loading fails", async () => {
    const loaded = await loadRendererLanguageCatalog(async () => {
      throw new Error("catalog unavailable")
    })
    expect(loaded).toMatchObject({ locale: "en", intl: "en", direction: "ltr" })
    expect(loaded.messages["disk.accessGuidance.rescan"]).toBe(
      "Use Rescan in the top bar after changing access.",
    )
    expect(loaded.messages["ui.common.cancel"]).toBe(uiEn["ui.common.cancel"])
  })

  test("interpolates and pluralizes the English UI catalog", () => {
    const i18n = createRendererUiI18n(language(uiEn))
    expect(i18n.locale()).toBe("en")
    expect(i18n.t("ui.sessionReview.selection.line", { line: 12 })).toBe("line 12")
    expect(i18n.plural("ui.sessionTurn.diffs.changed", 1)).toBe("1 Changed file")
    expect(i18n.plural("ui.sessionTurn.diffs.changed", 2)).toBe("2 Changed files")
  })

  test("falls back to English for missing UI messages", () => {
    const i18n = createRendererUiI18n(language({}))
    expect(i18n.t("ui.common.cancel")).toBe(uiEn["ui.common.cancel"])
  })

  test("does not statically import non-release desktop catalogs", () => {
    const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8")
    const imported = DESKTOP_NATIVE_LOCALES.filter(
      (locale) => locale !== "en" && source.includes(`from "./${locale}"`),
    )
    expect(imported).toEqual([])
    expect(source).not.toContain("detectDesktopNativeLocale")
    expect(source).not.toContain("storeGet")
  })
})
