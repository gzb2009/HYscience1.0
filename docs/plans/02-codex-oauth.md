# 02 — Codex OAuth login (Sign in with ChatGPT)

Workstream: make "Sign in with ChatGPT / Codex" smooth and reliable end to end — initiate → callback → token storage → refresh → logout, clear errors on every unhappy path, no dead ends. HYscience under `backend/cli/`; Atlas under `backend/app/` (cloned reference).

## Current state

There are **two independent OAuth flows + two token stores**, loosely coupled by a fire-and-forget push and a status probe.

- **CLI flow (what users use)** — `plugin/codex.ts`, the auth plugin for provider `openai-codex` (`:396-400`). Two methods: **browser (default)** binds a Bun server to `localhost:1455` (`:290-359`), PKCE+CSRF-state, authorize against `auth.openai.com/oauth/authorize` with the hardcoded CLI `client_id`, waits with a **5-min timeout** (`:369-394`), validates error/code/state, exchanges at `/oauth/token`; **device-code** (`:633-738`) polls `/deviceauth/token` in a `while(true)`. On success: `extractAccountId` from the JWT (`:98-117`), **fire-and-forget `pushTokensToBackend`** to `${managedApiBase}/api/keys/openai-codex` (failures swallowed, `:31-38`), `syncServices()`, and persist to **local `auth.json`** via `Auth.set("openai-codex", {type:"oauth",...})`.
- **Web flow (backend-complete, UI-unwired)** — `routes/codex_oauth.py`: `GET /authorize-url` (pending row, 10-min TTL) → `CodexCallbackPage` postMessage → `POST /exchange` (validates state/user/expiry, guards missing refresh_token, stores, deletes pending). Expired rows swept hourly (`jobs/codex_oauth_sweeper.py`).
- **Refresh** — CLI: at **request time** inside the plugin `fetch` (if `!access || expires < now` → `refreshAccessTokenSingleFlight` → persist rotated pair → inject bearer + `ChatGPT-Account-Id`, route to `chatgpt.com/backend-api/codex/responses`), with a same-process single-flight + re-read-after-loss recovery (`:276-288,437-459`). Backend: lazy refresh with per-user lock + 60 s slack (`openai_codex_service.py:99-163`); 4xx→invalid, 5xx→upstream error.
- **Request-time use (CLI):** provider synthesis happens **only if a local `Auth.get("openai-codex")` exists** (`provider.ts:962`) — the custom `fetch` does all routing.
- **Logout** — `auth.ts:476-527`: remove picker → `Auth.remove`; if codex, also `revokeCodexOnBackend()` (DELETE, best-effort OpenAI revoke + audit + row delete) + `syncServices()`.

## What's broken / missing

1. **Backend token consumption is not wired.** `get_valid_access_token()` has **zero non-test callers** in Atlas — the pushed tokens power **only the status dot**; the "managed proxy can use them" promise is unrealized. All working codex inference is CLI-local.
2. **Web "Sign in with ChatGPT" is a dead end.** Endpoints, pending repo, sweeper, `CodexCallbackPage`, and the API client all exist — but **nothing calls them**; `CodexProviderCard.tsx` only renders status and tells users to run the CLI.
3. **Refresh-token rotation is a cross-store landmine.** OpenAI rotates the refresh token on every use; the CLI pushes the _same_ token to the backend; the single-flight guard is per-process; there's **no CLI↔backend coordination**. Masked today only because the backend never refreshes (item 1) — the instant a backend proxy is wired, the two stores fight over the rotating token and one is permanently locked out.
4. **`backendHasCodex()` checks `connected`, not `is_valid`** (`auth.ts:416-420`) — a dead backend credential still shows "Already signed in?"
5. **Login-time push failure is silent** — "Login successful" while the dashboard shows "not connected."
6. **Unhappy-path errors are swallowed/crash** — `handlePluginAuth` only inspects `result.type`; a rejected callback (denied consent, CSRF, timeout, exchange failure) throws a raw exception, not a clean message.
7. **Device-code has no overall timeout** — `while(true)` can hang on persistent 403s; thin errors.
8. **Headless/CI dead-ends** — browser is the default (needs a real browser + free port 1455); `keys signin` doesn't detect non-TTY to prefer device-code; port-1455-in-use makes `Bun.serve` throw unhandled.
9. **Refresh has no retry and no proactive window** — only refreshes _after_ expiry (request-time latency + mid-request failure); a single transient 5xx throws "reconnect"; no 4xx/5xx split like the backend.
10. **Logout revoke is silently best-effort** — a failed OpenAI revoke leaves the token live upstream with no signal.
11. **`enabled_providers` allowlist edge** — a local-only login can be filtered out if the allowlist lacks `openai-codex`.

## Proposed change

**Decide the backend's role first (unblocks everything):**

- **P0 — pick one token owner.** Either (a) **finish the managed proxy** (add the Atlas inference route calling `get_valid_access_token()`, and make the CLI fetch short-lived access tokens from the backend instead of holding the refresh token), or (b) **make codex CLI-local** (stop pushing tokens; derive status from a light flag). **Do not ship today's half-state** where both stores hold the same rotating token but only one refreshes.
- **P0 — single source of truth for refresh.** Guarantee only one party ever exchanges a given rotating refresh token; if the CLI stays owner, **re-push the rotated pair after every successful CLI refresh**.

**Reliability fixes:**

- **P1** reconcile on `is_valid` not just `connected` (`auth.ts:416-447`); **P1** await + surface push failure at login; **P1** robust refresh (4xx→reconnect vs 5xx/network→bounded retry+backoff, mirror the backend; refresh ~60 s before expiry); **P1** clean CLI error surfacing (map OAuth error codes to friendly lines; never leave a half-written `auth.json` or a dangling :1455 server); **P1** headless/CI (auto-detect non-TTY + `--device`; overall device-poll timeout; port-in-use → device-code fallback).
- **P2** web flow — either wire the popup (`CodexProviderCard` → `getAuthorizeUrl` → popup → `exchangeCode`) **plus** an import-to-CLI path, **or remove** the unused endpoints/sweeper/callback. **P2** logout — retry + surface `revocation_status`.

## Risks

Hot-path fragility (refresh lives in the codex request `fetch` — a bug locks out every codex request; land the existing single-flight+re-read pattern). Ordering: wiring the backend proxy **before** the single-source-of-truth change makes the rotation bug strictly worse — sequence P0 first. False logouts: making `is_valid=false` wipe local is safe only because the backend sets it false **only on true 4xx** — keep that invariant. Client_id binding: refresh must use the client_id that issued the token. Removing web endpoints could break external callers of `/api/auth/codex/*`.

## Acceptance criteria

1. **First-try success** — new user runs `hyscience keys signin`, approves once, lands on "Login successful" with codex models usable, no second command (with and without an Atlas session).
2. **Graceful failures** — denied consent / closed browser / timeout / port-1455-in-use / network failure each give a clear one-line message, leave no half-written `auth.json` or dangling server, allow immediate retry.
3. **Headless/CI** — `keys signin --device` (or auto-detected) prints code+URL, polls with a bounded timeout, succeeds with no browser.
4. **Refresh** — expired token refreshes transparently; the rotated token is persisted to every store that holds it; two concurrent processes never lock each other out; a transient 5xx recovers.
5. **No silent drift** — backend `connected && is_valid` ⇔ a working CLI provider, or the divergence is surfaced; web disconnect reconciles on next `keys signin`; logout revokes at OpenAI (or says it couldn't) and clears both stores.
6. **No dead ends** — the web card either actually connects (and yields a CLI-usable session) or is removed.

**Atlas-side involvement:** P0(a) (managed proxy) and the web-flow decision are cross-repo — flagged for the owner. **Key files:** HYscience `plugin/codex.ts`, `cli/cmd/auth.ts`, `auth/index.ts`, `provider/provider.ts:955-998`, `hyscience/index.ts:708-747`. Atlas `routes/{codex_oauth,keys,cli}.py`, `services/{openai_codex_service,user_provider_key_service}.py`, `jobs/codex_oauth_sweeper.py`, `frontend/src/components/settings/CodexProviderCard.tsx`.
