# 04 — Onboarding → setup (browser)

Workstream: smoother first-run→setup **in the browser workspace** (the terminal wizard shipped in v1.2.5). Citations `file:line`; frontend under `frontend/workspace/src/`, backend under `backend/cli/src/`.

## Current state — what a brand-new user sees

- **No first-run detection anywhere.** `app.tsx` gates only on a server URL existing (`ServerKey`, `app.tsx:88-95`), then routes straight to `Home` / `Session` (`app.tsx:142-170`). No onboarding route or gate.
- **Server health is the only connection surface.** `context/server.tsx:110-165` polls `/health`; `DisconnectedPanel` (`thesis/DisconnectedPanel.tsx:18`) renders **only** when `healthy()===false` (server-down) — never "no model / no account."
- **Home** (`pages/home.tsx`) has good empty states (`EmptyHero` "open folder…", `home.tsx:892`) but opening a folder just navigates to a session with **no credential/account awareness** (`home.tsx:129-138`).
- **The dead-end:** with nothing configured, `providers.connected()` is empty → `models.list()` empty → the default-model effect never resolves → `model()` stays `undefined` (`Composer.tsx:251-269`, `hooks/use-providers.ts:22`). The model button shows faint "connect a model" (`Composer.tsx:1188-1191`); submitting fires a **transient** `toast.error("no model selected", …${BYOK_URL})` where `BYOK_URL = URLS.dashboard` = the **external** `app.hyscience.ai` (`Composer.tsx:719-727`). `ChatWelcome` (`session.tsx:958-1053`) offers suggested prompts that lead straight into this dead-end, with no model/credential awareness.
- **Settings** opens on the **Skills** panel (`registry.ts:127`), with Credentials/Spend below the fold — not surfaced on first run.
- **BYOK is fully self-serve in the browser, no account:** `Credentials.tsx:184-186` → `sdk.client.auth.set({...})` + `global.sync()`; copy "Stored on this machine … free and unmetered here."
- **Managed/Atlas is view-toggle-logout only, with NO in-browser login:** `Spend.tsx:130-133` literally says "run **hyscience login**"; `Usage.tsx:191` says "run `hyscience connect login` in a terminal"; `General.tsx` has sign-out but no sign-in. **`HYscience.browserLogin` (loopback device flow, `hyscience/index.ts:624-680`) exists but is not wrapped in any HTTP route** — `server/routes/account.ts` exposes `GET /account`, balance, devices, billing-mode, and **`POST /account/logout`**, but **no login route**. This is why every managed surface punts to a terminal.

The terminal `cli/onboard.ts` is the fork to mirror: `needsOnboarding()` (`onboard.ts:72-79`) + a 3-option select (managed ★ / BYOK / skip, `onboard.ts:164-172`).

## What's broken / missing

1. **No browser first-run/setup flow.** New user + running server + zero config → folder → `ChatWelcome` prompts → type → transient toast to an external site. Full dead-end.
2. **No in-browser Atlas/managed login** — the recommended branch has zero browser equivalent; the backend function exists but is unexposed (needs one bridge route).
3. **No in-browser wallet top-up** — "buy credits" always bounces to the external dashboard.
4. **Settings tells a browser user to open a terminal** (`Spend.tsx:130-133`, `Usage.tsx:191`, `General.tsx:177`).
5. **The unconfigured state is undetected by the UI shell** — `ChatWelcome`/`DisconnectedPanel` have no "no model / not set up" variant.
6. **Setup is undiscoverable** — settings opens on Skills; the gear isn't highlighted on first run.
7. **"Skip → demo models" viability is unverified signed-out** — the `"public"` sentinel enables zero-cost models (`provider.ts:108-110`), but the hosted demo fallback requires `hasManagedSession()` (`provider.ts:1403-1411`), so a signed-out user may still have an empty model list. **Must be confirmed.**

## Proposed change — browser first-run/setup flow (mirror the terminal fork)

**Detection + persistence:** a `useSetup()` derivation of "configured" mirroring `isConfigured()` — a connected non-demo provider **OR** an Atlas session (`account.get().session`) **OR** `sync.data.config.model`. Persist a dismissal marker in `localStorage` (pattern of `home.tsx:77` / `FdaBanner.tsx:12`). Gate on `server.healthy()===true` so it never flashes during the `undefined` checking phase.

**Where to hook (three coordinated surfaces):**

- **Primary — a `SetupDialog` modal** on the `@hysci/ui` `Dialog` kit, using `components/dialog-select-server.tsx` as the polished reference (health dots, `TextField`, `Button`, `List`). Auto-shown on first unconfigured load; dismissible; re-openable from settings + the Composer.
- **`ChatWelcome`** — when `model()` is undefined, a single primary "Set up models" CTA that opens `SetupDialog` (`session.tsx:958`).
- **`DisconnectedPanel` pattern** — a sibling **non-error** banner "No model configured — finish setup" for the unconfigured-but-connected state, so the affordance is persistent, not a transient toast. Rewire the Composer "connect a model" button and no-model submit (`Composer.tsx:719-727,1188-1191`) to open `SetupDialog` instead of toasting an external URL.

**Three branches mirroring `onboard.ts:164-172`:**
| Branch | Browser implementation | Endpoints |
| --- | --- | --- |
| **Managed (recommended)** | **NEW bridge route** wrapping `browserLogin`: server runs start→poll→redeem, hands the `approval_url` to the page (open in a new tab; poll `account.get` for `session:true`), then show balance, offer top-up (open `dashboardCli`), set managed mode. | **NEW** `POST /account/login` (+ poll); reuse `GET /account`, `POST /account/billing-mode` |
| **BYOK** | Reuse the already-complete Credentials flow (provider picker + key → `auth.set` → `global.sync`). | `sdk.client.auth.set` / `global.sync` |
| **Skip / demo** | Dismiss + mark onboarded; land on demo models. **Depends on** confirming the demo provider is connected signed-out (risk 7). | `provider.ts:108-110` |

**Only net-new backend work: the browser-login bridge route.** Wallet, billing-mode, BYOK, and logout are already exposed.

## Risks

- **Net-new login route** — `browserLogin` is written for a loopback CLI; the bridge must run start→poll→redeem server-side and return the approval URL (poll/timeout/error handling).
- **Skip/demo may be empty signed-out** (`provider.ts:1403-1411`) — verify; else make "skip" require a signed-out demo provider or steer to BYOK.
- **Managed credential-injection timing** — managed mode relies on `syncServices()` injecting proxy creds; the wizard must resync before the first send (ties to WS3).
- **Health-probe race** — gate strictly on `healthy()===true`.
- **Brand/URL split** — login/top-up land on `app.hyscience.ai` while the app is "hyscience" (ties to WS5 copy).

## Acceptance criteria

- New user + running server + zero config sees a **setup affordance within the first screen** (modal or persistent banner), not a transient toast, and reaches a working model **without opening a terminal**.
- All three branches are selectable in-browser: managed completes login and shows live wallet balance in-app (only hosted checkout leaves the app); BYOK adds a key and immediately enables a model; skip lands on a genuinely usable demo model (or is removed if unbacked).
- Composer "connect a model" and no-model submit open setup (no external dead-ends).
- Setup is re-openable from settings; the marker prevents re-prompting once configured/dismissed.
- Signed-in state is reflected consistently across `Spend`/`Usage`/`General` without terminal instructions.

**Depends on:** WS3 (sync must be reliable before managed login is smooth). **Feeds:** WS5 item 2 (kill the no-model dead-end). **Key files:** `app.tsx`, `context/server.tsx`, `thesis/{DisconnectedPanel,Composer}.tsx`, `pages/{home,session}.tsx`, `components/settings/{Credentials,Spend,Usage,General}.tsx`, `components/dialog-select-server.tsx`, `server/routes/account.ts`, `hyscience/index.ts:624-680`, `provider.ts:108-110,1403-1411`.
