import { test, expect } from "bun:test"

// Live check that models.dev still lists the models the suite pins. This is the
// ONLY test that talks to real models.dev, so it runs solely in the scheduled
// catalog job (gated on HYSCIENCE_LIVE_CATALOG). PR CI uses the committed
// fixture (test/preload.ts seeds it) and never hits the network.
//
// When this fails, models.dev delisted a pinned model — do BOTH:
//   1. update the SONNET/OPUS pins in provider.test.ts, and
//   2. regenerate the fixture: curl -fsSL https://models.dev/api.json | (minify) >
//      test/fixture/models-catalog.json, then gzip it to models-catalog.json.gz.
//
// Keep ANTHROPIC_PINS in sync with SONNET/OPUS in provider.test.ts.
const ANTHROPIC_PINS = ["claude-sonnet-4-6", "claude-opus-4-5"]

test.skipIf(!process.env["HYSCIENCE_LIVE_CATALOG"])("models.dev still lists the pinned catalog models", async () => {
  const res = await fetch("https://models.dev/api.json", { signal: AbortSignal.timeout(20_000) })
  expect(res.ok).toBe(true)
  const catalog = (await res.json()) as Record<string, { models?: Record<string, unknown> }>
  const anthropic = Object.keys(catalog["anthropic"]?.models ?? {})
  expect(anthropic.length).toBeGreaterThan(0)
  for (const id of ANTHROPIC_PINS) {
    if (!anthropic.includes(id))
      throw new Error(
        `models.dev no longer lists anthropic/${id} — update the pins in provider.test.ts and regenerate test/fixture/models-catalog.json.gz`,
      )
  }
})
