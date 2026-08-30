import * as i18n from "@solid-primitives/i18n"
import { dict as uiEn } from "@opencode-ai/ui/i18n/en"
import { dict as en } from "./en"
import type { DesktopNativeLocale } from "./desktop-native"

export {
  DISKLIZARD_RELEASE_LOCALE,
  DISKLIZARD_RELEASE_LOCALES,
  resolveDiskLizardReleaseLocale,
  type DiskLizardReleaseLocale,
} from "./desktop-native"

type RawDictionary = typeof en & typeof uiEn
export type LocaleDictionary = i18n.Flatten<RawDictionary>

export const BASE_LOCALE_DICTIONARY = i18n.flatten({ ...en, ...uiEn })

// Release callers may pass a persisted/source locale. Until another locale is
// complete, both the synchronous peek and asynchronous loader fail closed to
// the one catalog DiskLizard advertises.
export function peekLocaleDictionary(_locale: DesktopNativeLocale): LocaleDictionary {
  return BASE_LOCALE_DICTIONARY
}

export function loadLocaleDictionary(_locale: DesktopNativeLocale): Promise<LocaleDictionary> {
  return Promise.resolve(BASE_LOCALE_DICTIONARY)
}
