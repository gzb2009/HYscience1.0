# 01 — CI + test suite: trustworthy + deterministic

Workstream: make the suite trustworthy and deterministic, and add coverage on the paths this sprint touches. Findings-first; citations `file:line` under `backend/cli`.

## Current state

- Tests in `test/**` (69 files) + `src/skill/install/__tests__/**` (5). Measured `bun test` (from `backend/cli`): **853 pass / 0 fail, 69 files, ~25.6 s wall — but only 6.4 s user / 51% CPU**, so ~19 s is network wait. `bunfig.toml` preloads `test/preload.ts` (redirects XDG/home/cache to a per-PID tmp, disables plugins/bundled skills, clears provider-key env before any `src/` import — solid isolation) and sets `timeout=10000`. Root `bunfig.toml` points `bun test` at a non-existent dir (the "no tests from root" guard). **No skipped/`.only`/`.todo` tests.**
- CI (`.github/workflows/ci.yml`, push→main + all PRs, cancel-in-progress): jobs `typecheck`, `format`, `test` (`bun run --cwd backend/cli test`), `build` (workspace+docs), `landing` (own lockfile, frozen), `smoke` (release scripts), `actionlint`. Gitleaks is a separate workflow. **The Test job invokes `bun test` directly, bypassing turbo**, so the `^build` dep (which generates the models snapshot) never fires.
- **No coverage tooling anywhere** (no `--coverage`, no threshold, no codecov).
- **The one live-network coupling: the models.dev catalog** (`provider/models.ts`). `models-snapshot.ts` is generated only at build (`script/build.ts:26-27`) and is **absent from the source tree**, so in dev/test `Data()` falls through to a live `fetch(https://models.dev/api.json)` (`models.ts:98-104`), plus a module-load `refresh()` + hourly interval. `preload.ts` does **not** set `HYSCIENCE_DISABLE_MODELS_FETCH`, so provider-touching tests do a **blocking live fetch** — the ~19 s and the flakiness source.
- **#91 pinned the catalog** (`SONNET`/`OPUS` constants + a "pinned models still exist upstream" tripwire that runs first in `provider.test.ts`). Good ergonomics — converts ~10 scattered failures into one legible one with a fix instruction — but **it does not remove the network dependency** (the tripwire itself fetches live), and a real delisting still reds `main` until a human bumps the pins.

Coverage on this sprint's paths is thin: existing tests cover adjacent store/helper code, not the command/sync/network surface — `cli/cmd/auth.ts` commands untested (only `src/auth` store), `syncServices` status handling (401/403/402/ok) untested, `routes/settings/usage.ts` has **no test**, arXiv `parse`/`toHit` are module-private with no fetch-injection point, codex refresh/exchange untested, `cli/onboard.ts` untested. `test/server/settings-compute.test.ts` is the good route-level template to copy.

## What's broken / missing

1. **Nondeterminism = the live models.dev fetch** (blocking in provider tests, background on module load). Everything else is deterministic.
2. **The Test job can red on models.dev availability/latency/delisting**, independent of code.
3. **No coverage floor** — regressions in coverage are invisible.
4. **Zero coverage** on the sprint's exact change surfaces (auth commands, sync status handling, usage route, arXiv parsing, codex refresh, onboarding).
5. `setup-bun` runs plain `bun install` (not frozen) for the root — lockfile drift won't fail CI.

## Proposed change

**A. Make the suite deterministic (highest leverage).** In `preload.ts`, set `HYSCIENCE_DISABLE_MODELS_FETCH="true"` **and** seed a committed catalog fixture into `Global.Path.cache/models.json` before any `src/` import → `Data()` returns the fixture, module-load `refresh()` is skipped → zero network, reproducible, ~19 s faster. Base the fixture on the existing `test/tool/fixtures/models-api.json` (verify it's a full catalog). **Move the delisting tripwire to a dedicated `live-catalog` test gated to a nightly / `workflow_dispatch` job** (flag unset) — PR CI stays green regardless of models.dev; the scheduled job surfaces real delistings and carries the "bump SONNET/OPUS" instruction. Shipped binaries still fetch live via `build.ts`, so production freshness is unaffected.

**B. Add coverage for the sprint's areas** (model on `settings-compute.test.ts`: route-level `.request()`, `VARS`+`afterAll` cleanup): `test/cli/onboard.test.ts` (`isConfigured` across the four signals, `hasProviderEnv`); `test/hyscience/sync-services.test.ts` (point `HYSC_API_BASE` at a `fetch` stub; assert 401→clearSession, 403→keep, 402→keep+warn, ok→credential-value dedupe); `test/hyscience/secrets.test.ts` (the pure classifiers); `test/science/arxiv.test.ts` (export/inject `fetch`, feed an Atom fixture; + `http` retry/backoff — supports WS9); `test/server/settings-usage.test.ts`; `test/cli/auth-cmd.test.ts`; extend `test/plugin/codex.test.ts` toward refresh/exchange with a stub (supports WS2); billing `getBalance`/`reportUsage` against a stub.

**C. CI ergonomics.** Add `[test] coverage = true` + `coverageThreshold` to `backend/cli/bunfig.toml` (Bun-native, no new dep), floor at the observed number and ratchet up; switch `setup-bun` to `--frozen-lockfile`; optional `--reporter=junit` for PR annotations.

## Risks

- **Fixture staleness** → mitigated by the nightly `live-catalog` job + the build-time snapshot for shipped binaries.
- **Masking a real fetch regression** → keep 1–2 live assertions in the opt-in job.
- **Coverage-gate friction** → floor at current level, ratchet deliberately.
- **Env/stub leakage across files** → follow the `settings-compute.test.ts` `VARS`+`afterAll` discipline.
- **Wider public surface** for arXiv helpers (minor; or stub `fetch`).

## Acceptance criteria

1. `bun test` performs **zero outbound network** (verify with models.dev blackholed → 0 fail); wall < ~10 s.
2. No module-load live fetch during tests (flag honored in `preload.ts`; cache seeded from a committed fixture).
3. models.dev delisting is caught by a **scheduled** job, not PR CI; PR CI is green independent of models.dev.
4. New passing test files exist for onboarding, `syncServices` status handling, secret classifiers, arXiv parsing + `http` retry, and the usage route.
5. Coverage is reported with a floor gate that fails on regression; `setup-bun` uses `--frozen-lockfile`.
6. Suite stays 0-fail; count grows by the added cases.

**This underpins the whole sprint** — land A (determinism) first, then B grows alongside each feature workstream. **Key refs:** catalog `provider/models.ts:98-131,148-156`; snapshot `script/build.ts:26-27`; flag `flag/flag.ts:20`; pins/tripwire `test/provider/provider.test.ts`; isolation `test/preload.ts:9-63`; CI `.github/workflows/ci.yml:17-113`.
