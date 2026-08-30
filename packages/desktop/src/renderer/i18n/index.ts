import { pluralCategory, pluralKey, type UiI18n, type UiI18nKey, type UiI18nParams } from "@opencode-ai/ui/context/i18n"
import { dict as uiEn } from "@opencode-ai/ui/i18n/en"
import {
  BASE_LOCALE_DICTIONARY,
  DISKLIZARD_RELEASE_LOCALE,
  loadLocaleDictionary,
  type DiskLizardReleaseLocale,
} from "@disklizard/app/i18n"

/** The public beta intentionally advertises and renders one complete locale. */
export type Locale = DiskLizardReleaseLocale

export type RendererLanguage = {
  locale: Locale
  intl: "en"
  direction: "ltr"
  messages: Readonly<Record<string, string>>
}

function resolveUiTemplate(text: string, params?: UiI18nParams) {
  if (!params) return text
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, rawKey) => {
    const value = params[String(rawKey)]
    return value === undefined ? "" : String(value)
  })
}

export function createRendererUiI18n(language: RendererLanguage): UiI18n {
  const resolve = (key: UiI18nKey, params?: UiI18nParams) =>
    resolveUiTemplate(language.messages[key] ?? uiEn[key] ?? key, params)

  return {
    locale: () => language.intl,
    t: resolve,
    plural: (key, count, params) => {
      const category = pluralCategory(language.intl, count)
      const candidate = pluralKey(key, category)
      const fallback = pluralKey(key, "other")
      return resolveUiTemplate(language.messages[candidate] ?? language.messages[fallback] ?? uiEn[fallback], {
        ...params,
        count,
      })
    },
  }
}

type ReleaseDictionaryLoader = () => Promise<Readonly<Record<string, string>>>

function rendererLanguage(messages: Readonly<Record<string, string>>): RendererLanguage {
  return {
    locale: DISKLIZARD_RELEASE_LOCALE,
    intl: "en",
    direction: "ltr",
    messages,
  }
}

export async function loadRendererLanguageCatalog(
  load: ReleaseDictionaryLoader = () => loadLocaleDictionary(DISKLIZARD_RELEASE_LOCALE),
): Promise<RendererLanguage> {
  try {
    return rendererLanguage(await load())
  } catch {
    return rendererLanguage(BASE_LOCALE_DICTIONARY)
  }
}

export function loadRendererLanguage(): Promise<RendererLanguage> {
  return loadRendererLanguageCatalog()
}
