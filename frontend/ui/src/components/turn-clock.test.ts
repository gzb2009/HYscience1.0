import { expect, test } from "bun:test"
import { partStamp, turnClockEnd } from "./turn-clock"

test("ticks with wall clock only while the model is live", () => {
  expect(
    turnClockEnd({
      created: 1000,
      now: 5000,
      live: true,
    }),
  ).toBe(5000)
})

test("freezes at last activity when the turn is no longer live", () => {
  expect(
    turnClockEnd({
      created: 1000,
      now: 999_000,
      live: false,
      lastActivity: 4000,
    }),
  ).toBe(4000)
})

test("completed and paused beats a running now", () => {
  expect(
    turnClockEnd({
      created: 1000,
      now: 9000,
      live: true,
      completed: 3000,
    }),
  ).toBe(3000)
  expect(
    turnClockEnd({
      created: 1000,
      now: 9000,
      live: false,
      paused: 2500,
      lastActivity: 2000,
    }),
  ).toBe(2500)
})

test("partStamp prefers end over start", () => {
  expect(partStamp({ time: { start: 1, end: 8 } })).toBe(8)
  expect(partStamp({ time: { start: 3 } })).toBe(3)
  expect(partStamp(undefined)).toBe(0)
})
