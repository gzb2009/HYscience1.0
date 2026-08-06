# 08 — Wallet + usage in settings

Workstream: a settings **Wallet** view showing balance + usage, with "Add funds / capacity" redirecting to `app.hyscience.ai` (no in-app payment). Findings-first; citations `file:line`.

## Current state

Settings panels follow one contract (`components/settings/registry.ts:14-50`): a lazily-loaded one-file SolidJS component keyed by a stable `SettingsPanelId`. Data comes via the generated SDK (`sdk.client.*`) or a raw-fetch helper `settingsApi()` (`settings/api.ts`) hitting a local-server route. **Hard rule (`registry.ts:20-21`): no dead buttons** — a control wires to a real backend or is omitted.

Three money/usage-adjacent panels exist:

- **Spend** (`Spend.tsx`, id `spend`) — a Wallet card (signed-in state, balance, `buy credits`), LLM spend mode cards (Managed/BYOK/Auto), Compute spend mode cards. Data: `sdk.client.settings.billing.get()` → `routes/settings/billing.ts` → `HYscience.getSession()` + `getBalance()` → Atlas `GET /api/cli/balance` (`hyscience/index.ts:1118-1142`). `buy credits` → `platform.openLink(URLS.dashboardCli)` = `https://app.hyscience.ai/cli` (`Spend.tsx:124`, `config/urls.ts:22`). Only the **aggregate scalar balance** reaches the UI.
- **Usage** (`Usage.tsx`, id `usage`) — the richest surface. Pulls from three sources: `sdk.client.account.get()` (`routes/account.ts:37-76`; session + balance + billing_mode) → Plan & wallet card; `settingsApi(.../settings/usage)` → `routes/settings/usage.ts`, **fully local** (aggregates `Session.list()` + `Session.messages()`, summing assistant `info.cost`/`info.tokens` by model and by day, `usage.ts:51-122`) → weekly bar chart + per-model breakdown; `/settings/preferences` → the extra-budget ceiling. Refetches on window focus (`Usage.tsx:81-88`). `buy credits` → same redirect.
- **Storage** (`Storage.tsx`) — unrelated to money; the cleanest raw-fetch + card/size-bar template to reuse.

| Data                          | Source                                                     | Scope                                                    | In UI?                                                                                                                              |
| ----------------------------- | ---------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Aggregate balance             | Atlas `/api/cli/balance` (30s cache, `index.ts:1104-1142`) | account-global                                           | yes (a single number)                                                                                                               |
| Billing mode                  | Atlas `/api/cli/billing-mode` (`index.ts:1487-1500`)       | account-global                                           | yes (Usage)                                                                                                                         |
| Usage over time / per-model   | **local** session records (`usage.ts`)                     | **per-project, per-device** (`session/index.ts:295-305`) | yes (Usage)                                                                                                                         |
| Credit transactions / ledger  | Atlas `/api/credits/transactions`                          | —                                                        | **no — never called**                                                                                                               |
| Auto-topup status             | —                                                          | —                                                        | **no — does not exist**                                                                                                             |
| Proactive low-balance warning | —                                                          | —                                                        | **no** (only at call time: `InsufficientCreditsError` `index.ts:186-193`, billing-gate preflight `session/billing-gate.ts:106-108`) |

Confirmed by grep: `/api/credits` and `/api/credits/transactions` are never fetched anywhere; no transaction UI exists. The just-shipped `hyscience wallet` CLI (`cli/cmd/billing.ts`) is the visual counterpart.

## What's broken / missing (for a real wallet view)

1. **No Atlas-sourced usage history or ledger.** The only "usage over time" is the local session aggregation, which (a) counts BYOK + OAuth-free calls too, so it ≠ wallet debits (contrast `billing-gate.ts:106-117`); (b) is per-project + per-device (misses spend on other machines); (c) has no top-ups/refunds. A true ledger needs Atlas `/api/credits/transactions`.
2. **No credit/transaction endpoint proxied** — only `getBalance()` returns a scalar (`index.ts:1118`); no `/settings/wallet` route.
3. **No auto-topup status anywhere** — only descriptive copy in `wallet topup` (`billing.ts:54`).
4. **No proactive low-balance warning in the UI.**
5. **`-1` "unknown" balance is a wire artifact** (`account.ts:67`, `billing.ts:35,38`; `getBalance()` returns `null` vs a number, `index.ts:1114-1123`). Any wallet UI must keep distinguishing signed-out / unknown / real-negative or it renders "−$1.00".
6. **No dedicated Wallet panel** — money concerns split across Spend + Usage; no `"wallet"` id in the registry.

## Proposed change

**A. New "Wallet" settings panel.** Add `"wallet"` to `SettingsPanelId` + a `SETTINGS_PANELS` entry (section `workspace`, `registry.ts:25-38,53-116`); new one-file `components/settings/Wallet.tsx`. Reuse `money()` + Card/Row/SectionLabel/EmptyState from `Usage.tsx`/`_shared.tsx`, the `platform.openLink(URLS.dashboardCli)` hand-off, and the window-focus refetch. Sections (omit any whose backend isn't wired — no dead controls):

1. **Balance** — current balance, billing mode, signed-in state, and **"Add funds / capacity" → `openLink(URLS.dashboardCli)`** (Plan tab). Optional low-balance banner.
2. **Auto top-up (read-only)** — status from Atlas; "Manage in dashboard" → redirect. No in-app editing.
3. **Usage over time** — reuse the weekly bar chart + per-model breakdown; prefer Atlas usage if proxied, else keep local `/settings/usage`. **Label the source** (wallet vs local).
4. **Transactions (optional)** — a ledger list (date, description, delta, running balance), only if `/api/credits/transactions` is proxied.

Ownership decision (up front): Wallet = balance + credits + auto-topup + Atlas usage; **Spend** = mode toggles only; keep local per-model analytics in **Usage**. Avoids three panels showing balance.

**B. New local-server route(s) proxying Atlas.** Add `HYscience.getCredits()` → `GET ${API_BASE}/api/credits` and `getTransactions()` → `GET ${API_BASE}/api/credits/transactions` (mirror `getBalance`/`getBillingMode`: `getSession()` + `Bearer` + `API_BASE`). New `server/routes/settings/wallet.ts` mounted in the **account-global block** (`server.ts:154-161`, before the `Instance.provide` wrapper — it's project-independent), not with `/settings/usage`. Frontend consumes via the existing raw-fetch `settingsApi()` — no SDK regeneration. (`/api/cli/usage` is POST-only for reporting today, `index.ts:1176`; a GET usage-history variant must be verified on Atlas.)

**C. Redirect, payment stays out.** Every "Add funds" / "Manage auto top-up" = `platform.openLink(URLS.dashboardCli)` (already `https://app.hyscience.ai/cli`). No checkout/amount UI in-app. Keep the focus-refetch so a dashboard top-up reflects on return.

## Risks

- **Atlas contract unverified** — `/api/credits`, `/api/credits/transactions`, and a GET usage-history are used nowhere in-repo; schemas assumed. Sections must degrade gracefully (omit, not error) if absent. → **flag for the owner / Atlas team.**
- **Semantic mismatch / double-counting** — local usage (BYOK+OAuth, per-device) vs Atlas credits (managed debits, cross-device). Label each source.
- **Balance staleness** — 30s cache; use `invalidateBalance()` (`index.ts:1110`) + focus refetch.
- **Unknown-balance `-1`** — must be handled in route + UI.
- **Hard constraints** — loopback origin guard; no in-app payment; registry no-dead-controls rule; don't rename provider id `hysci`.

## Acceptance criteria

- A "Wallet" row under Settings → Workspace opens a panel with current balance, billing mode, and signed-in state from a real endpoint.
- "Add funds / capacity" opens `https://app.hyscience.ai/cli`; no payment UI in-app.
- Balance refreshes on focus and distinguishes signed-out / unknown / real (no "−$1.00").
- Usage-over-time + per-model render (reused), source labeled.
- If Atlas endpoints wired: auto-topup read-only + redirect, transactions list, low-balance banner. If not: those sections omitted (no dead controls).
- `/settings/wallet*` returns a signed-out state (not 500) with no session; mounted account-global; typecheck + format clean.

**Depends on:** the Atlas contract questions above (workstream 3/7 overlap). **Key files:** `components/settings/{Spend,Usage,_shared,registry,api}.tsx/.ts`, `server/routes/{account,settings/billing,settings/usage}.ts`, mount `server/server.ts:154-161`, `hyscience/index.ts` (getBalance 1118, getBillingMode 1487), `config/urls.ts:22`, `cli/cmd/billing.ts`.
