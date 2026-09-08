import { dict } from "../../../../app/src/i18n/en"

/** DiskLizard's release locale is English; catalogs remain available in the app. */
export async function loadRendererLanguage() {
  return { locale: "en" as const, intl: "en", direction: "ltr", messages: dict as Readonly<Record<string, string>> }
}
