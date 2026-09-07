import { test, expect } from "./fixtures"
import { modKey } from "./utils"

test("search palette opens and closes", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.locator("body").click({ position: { x: 8, y: 8 } })
  await page.keyboard.press(`${modKey}+K`)

  const dialog = page.getByRole("dialog", { name: "Command palette" })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("textbox").first()).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
})
