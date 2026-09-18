import { describe, expect, test } from "bun:test"
import { StreamGuard } from "../../src/session/stream-guard"

function clock() {
  let value = 0
  return {
    now: () => value,
    advance(ms: number) {
      value += ms
    },
  }
}

describe("StreamGuard", () => {
  test("stops a stream that has no tool or final text progress", () => {
    const time = clock()
    const guard = StreamGuard.create(time.now)

    time.advance(StreamGuard.NO_USEFUL_PROGRESS_MS + 1)

    expect(() => guard.check()).toThrow("No tool call or final response progress")
  })

  test("stops a single reasoning stream that runs too long", () => {
    const time = clock()
    const guard = StreamGuard.create(time.now)
    guard.reasoningStart("reasoning")

    time.advance(StreamGuard.MAX_REASONING_MS + 1)

    expect(() => guard.check()).toThrow("Reasoning exceeded the 240 second limit")
  })

  test("stops an oversized single reasoning stream", () => {
    const guard = StreamGuard.create()
    guard.reasoningStart("reasoning")
    guard.reasoningDelta("reasoning", "x".repeat(StreamGuard.MAX_REASONING_CHARS + 1))

    expect(() => guard.check()).toThrow("Reasoning exceeded the 200,000 character limit")
  })

  test("incoming reasoning counts as progress", () => {
    const time = clock()
    const guard = StreamGuard.create(time.now)
    guard.reasoningStart("reasoning")

    time.advance(StreamGuard.NO_USEFUL_PROGRESS_MS - 1)
    guard.reasoningDelta("reasoning", "still thinking")
    time.advance(StreamGuard.NO_USEFUL_PROGRESS_MS - 1)

    expect(() => guard.check()).not.toThrow()
  })

  test("does not time out while a tool is running", () => {
    const time = clock()
    const guard = StreamGuard.create(time.now)
    guard.toolStart()

    time.advance(StreamGuard.NO_USEFUL_PROGRESS_MS * 2)

    expect(() => guard.check()).not.toThrow()
  })

  test("counts final text deltas as forward progress", () => {
    const time = clock()
    const guard = StreamGuard.create(time.now)

    time.advance(StreamGuard.NO_USEFUL_PROGRESS_MS - 1)
    guard.textProgress()
    time.advance(StreamGuard.NO_USEFUL_PROGRESS_MS - 1)

    expect(() => guard.check()).not.toThrow()
  })

  test("settles shortly after the last text block when nothing else arrives", () => {
    const time = clock()
    const guard = StreamGuard.create(time.now)
    guard.textProgress()
    guard.textEnd()
    time.advance(StreamGuard.TEXT_SETTLE_MS + 1)

    expect(() => guard.check()).toThrow(StreamGuard.SettledError)
  })

  test("does not settle while a later text block is still arriving", () => {
    const time = clock()
    const guard = StreamGuard.create(time.now)
    guard.textEnd()
    time.advance(StreamGuard.TEXT_SETTLE_MS - 1)
    guard.textProgress()
    time.advance(StreamGuard.TEXT_SETTLE_MS)

    expect(() => guard.check()).not.toThrow()
  })

  test("does not settle while a tool is running after the last text", () => {
    const time = clock()
    const guard = StreamGuard.create(time.now)
    guard.textEnd()
    guard.toolStart()
    time.advance(StreamGuard.TEXT_SETTLE_MS + 1)

    expect(() => guard.check()).not.toThrow()
  })
})
