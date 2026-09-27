import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  BASE_LOCALE_DICTIONARY,
  DISKLIZARD_RELEASE_LOCALE,
  DISKLIZARD_RELEASE_LOCALES,
  loadLocaleDictionary,
  peekLocaleDictionary,
  resolveDiskLizardReleaseLocale,
} from "./catalog"
import { DESKTOP_NATIVE_LOCALES } from "./desktop-native"

describe("DiskLizard beta language policy", () => {
  test("advertises only the complete English release locale", () => {
    expect(DISKLIZARD_RELEASE_LOCALE).toBe("en")
    expect(DISKLIZARD_RELEASE_LOCALES).toEqual(["en"])
    expect(resolveDiskLizardReleaseLocale(["de-DE", "ar", "zh-TW"])).toBe("en")
  })

  test("never serves a partial source catalog as a release catalog", async () => {
    for (const locale of DESKTOP_NATIVE_LOCALES) {
      expect(peekLocaleDictionary(locale)).toBe(BASE_LOCALE_DICTIONARY)
      expect(await loadLocaleDictionary(locale)).toBe(BASE_LOCALE_DICTIONARY)
    }
  })

  test("does not make non-release catalogs into production bundle entry points", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./catalog.ts", import.meta.url)),
      "utf8"
    )
    const imported = DESKTOP_NATIVE_LOCALES.filter(
      (locale) =>
        locale !== DISKLIZARD_RELEASE_LOCALE &&
        (source.includes(`import("./${locale}")`) ||
          source.includes(`import("@opencode-ai/ui/i18n/${locale}")`))
    )
    expect(imported).toEqual([])
  })
})
