import { expect, test } from "bun:test"
import { rightPaneMode } from "./right-pane-mode"

test("always uses inset fixed column regardless of viewport", () => {
  expect(rightPaneMode(1280, 360, true, true)).toBe("fixed")
  expect(rightPaneMode(1024, 360, true, true)).toBe("fixed")
  expect(rightPaneMode(1440, 360, false, true)).toBe("fixed")
  expect(rightPaneMode(1024, 360, false, false)).toBe("fixed")
})
