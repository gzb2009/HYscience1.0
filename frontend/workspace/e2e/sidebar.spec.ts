import { test, expect } from "./fixtures"

test("sidebar can be collapsed and expanded", async ({ page, gotoSession }) => {
  await gotoSession()

  const sidebar = page.locator(".cs-sidebar")
  await expect(sidebar).toBeVisible()
  await expect(sidebar).not.toHaveClass(/cs-sidebar-collapsed/)

  await page.getByTitle("collapse sidebar").click()
  await expect(sidebar).toHaveClass(/cs-sidebar-collapsed/)

  await page.getByTitle("expand sidebar").click()
  await expect(sidebar).not.toHaveClass(/cs-sidebar-collapsed/)
})
