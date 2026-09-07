import { test, expect } from "./fixtures"
import { promptSelector } from "./utils"

test("sidebar session links navigate to the selected session", async ({ page, slug, sdk, gotoSession }) => {
  const stamp = Date.now()
  const one = await sdk.session.create({ title: `e2e sidebar nav 1 ${stamp}` }).then((r) => r.data)
  const two = await sdk.session.create({ title: `e2e sidebar nav 2 ${stamp}` }).then((r) => r.data)

  if (!one?.id) throw new Error("Session create did not return an id")
  if (!two?.id) throw new Error("Session create did not return an id")

  try {
    await gotoSession(one.id)

    const sidebar = page.locator(".cs-sidebar")
    if (await sidebar.evaluate((node) => node.classList.contains("cs-sidebar-collapsed"))) {
      await page.getByTitle("expand sidebar").click()
    }

    const target = page.locator(`[data-session-id="${two.id}"]`)
    await expect(target).toBeVisible({ timeout: 15_000 })
    await target.scrollIntoViewIfNeeded()
    await target.click({ force: true })

    await expect(page).toHaveURL(new RegExp(`/${slug}/session/${two.id}(?:\\?|#|$)`))
    await expect(page.locator(promptSelector)).toBeVisible()
    await expect(page.locator(`[data-session-id="${two.id}"]`)).toHaveClass(/cs-session-row-active/)
  } finally {
    await sdk.session.delete({ sessionID: one.id }).catch(() => undefined)
    await sdk.session.delete({ sessionID: two.id }).catch(() => undefined)
  }
})
