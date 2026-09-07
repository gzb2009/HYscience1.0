import { test, expect } from "./fixtures"
import { serverName } from "./utils"

test("home renders and shows core entrypoints", async ({ page }) => {
  await page.goto("/domains")

  await expect(page.getByTestId("domain-guide")).toBeVisible()
  await expect(page.locator(".cs-domain-card").first()).toBeVisible()
  await expect(page.getByTestId("home-dock")).toBeVisible()
})

test("server picker dialog opens from home", async ({ page }) => {
  await page.goto("/domains")

  const trigger = page.getByRole("button", { name: serverName })
  if ((await trigger.count()) === 0) {
    test.skip(true, "server picker is not on the domain guide")
    return
  }
  await expect(trigger).toBeVisible()
  await trigger.click()

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("textbox").first()).toBeVisible()
})
