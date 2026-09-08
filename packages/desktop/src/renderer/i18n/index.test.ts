import { expect, test } from "bun:test"
import { loadRendererLanguage } from "."

test("loads the React app's English release catalog", async () => {
  const language = await loadRendererLanguage()
  expect(language).toMatchObject({ locale: "en", intl: "en", direction: "ltr" })
  expect(language.messages["disk.common.rescan"]).toBe("Rescan")
})
