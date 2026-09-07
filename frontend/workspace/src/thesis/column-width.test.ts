import { describe, expect, test } from "bun:test"
import { CENTER_MIN, clampColumn } from "./column-width"

describe("clampColumn", () => {
  test("keeps a value inside min/max", () => {
    expect(clampColumn(300, 200, 480, 320, 1280)).toBe(300)
  })

  test("floors at min", () => {
    expect(clampColumn(80, 200, 480, 32, 1280)).toBe(200)
  })

  test("caps at max", () => {
    expect(clampColumn(900, 200, 480, 32, 1280)).toBe(480)
  })

  test("leaves room for the center column", () => {
    expect(clampColumn(480, 200, 480, 400, 1100)).toBe(1100 - 400 - CENTER_MIN)
  })

  test("never goes below min even when the viewport is tight", () => {
    expect(clampColumn(480, 200, 480, 400, 500)).toBe(200)
  })
})
