# 06 — Compute integrations audit + fixes

Workstream: verify each compute path and fix what's broken — BYOK GPU (confirm), cloud storage, SSH, managed compute via the Atlas CLI. Findings-first. Audited against the Atlas backend (cloned) and the installed `atlas` CLI (`0.13.1` = npm `@hysci/atlas`). Citations `file:line`.

## Status per path

| Path                                 | Verdict                     | One-line                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. BYOK GPU providers**            | ✅ works (with gaps)        | Key encrypt→env-injection is solid + unit-tested for the 4 providers with skills (Modal, Lambda, TensorPool, Prime). **Vast + RunPod keys inject but no skill reads them.**                                                                                                                                                                           |
| **B. Cloud storage**                 | ⚠️ creds-only, unverified   | No mount/rclone abstraction — AWS/GCP creds → env → whatever CLI a skill invokes. **Azure object storage is advertised but not backed.** Needs real creds+bucket to verify (FLAG).                                                                                                                                                                    |
| **C. SSH-based compute**             | ❌ dead-end                 | "SSH hosts" + "Model endpoints" panels persist data **nothing ever reads**. No SSH client, no dispatch, no routing.                                                                                                                                                                                                                                   |
| **D. Managed compute via atlas CLI** | ⚠️ real, but version-gapped | The atlas CLI **does** ship a full compute suite (`compute:up`/`catalog`/`list`/`ssh`/`release` → `/api/compute/leases`) in the **published 0.13.2** — but HYscience pins `@hysci/atlas@^0.5.12`, so the shipped CLI predates it and the prompt's `atlas compute:up` can't resolve. Resale off by default server-side; `billing.compute` prompt-only. |

Ground truth: `atlas doctor` on this machine is seeded (`~/.config/atlas-cli/config.json`), authed, backend reachable — so atlas **auth/config-seeding works**; only the **compute command surface** is broken.

## Path A — BYOK GPU providers (✅)

Compute panel (`Compute.tsx`, 6 cards) → `server/routes/settings/compute.ts`: keys AES-256-GCM at rest; `PROVIDER_ENV` maps to canonical var names (`:175-181`; Modal `ak-…:as-…` split into ID/SECRET); `applyComputeEnv()` injects at boot (`index.ts:111`) + after connect/disconnect (shell exports win, `:230`). Vars reach skill subprocesses via `subprocessEnv`. Consumers: Modal/Lambda/TensorPool/Prime skills. **Unit-tested** (`test/server/settings-compute.test.ts`).

- ✅ injection is correct + tested; Modal/Lambda/TensorPool/Prime have real skill consumers.
- ❌ **Vast/RunPod inject but no skill reads them** (`VAST_API_KEY`/`RUNPOD_API_KEY` set, no skill) — connecting does nothing.
- ⚠️ `last_used` is declared + rendered but **never written** → always "never".
- ⚠️ **Modal double-stored** — also in the Credentials panel, which injects the same vars and runs first at boot (`index.ts:107` before `:111`), so a Modal key set in both panels has the Credentials value silently win.
- ⚠️ latent: the atlas-bin fallback resolver walks for `@hyscience/atlas` while the dep is `@hysci/atlas` (`index.ts:225`) — dead fallback.
- **FLAG:** an actual job round-trip (Modal/Lambda/TensorPool/Prime) needs live provider accounts — plumbing verified, round-trip not.

**Fixes:** author Vast/RunPod skills or drop them from the catalog (interim: "key stored — skill coming"); populate or remove `last_used`; pick one home for Modal (recommend removing from Compute, Credentials owns it) or share one precedence; fix the `@hyscience→@hysci` scope typo.

## Path B — Cloud storage (⚠️)

`Storage.tsx` is local-disk only; its "Cloud storage" section just links to Credentials ("S3, GCS, Azure configured through service credentials"). Actual mechanism: `credentials.ts` injects AWS (`AWS_ACCESS_KEY_ID/…`) and GCP (service-account JSON → 0600 file + `GOOGLE_APPLICATION_CREDENTIALS`); skills call `aws s3`/`gcloud`/`boto3`/`rclone` (env-auth).

- ✅ **S3 + GCS viable** _if the CLI tool is installed_ — creds → env → tools honor them.
- ❌ **Azure object storage advertised but not backed** — the only Azure cred is **Azure OpenAI** (an LLM key), not Blob Storage. No `AZURE_STORAGE_*` field, so the panel's "Azure" promise can't be fulfilled.
- ⚠️ no managed abstraction (no mount, no rclone.conf seeding) — success depends on the tool being installed + the skill spelling the remote right.
- **FLAG:** end-to-end read/write needs live AWS/GCP creds + a real bucket + CLIs present — untested here.

**Fixes:** add an Azure Storage cred or drop "Azure" from the copy; document the "creds-only, needs CLIs, no mount" contract; optionally seed an `rclone` remote from stored creds.

## Path C — SSH-based compute (❌)

Compute.tsx promises "SSH hosts" (dispatch runs over SSH) + "Model endpoints" (route inference). `compute.ts` persists `ssh_hosts` + `endpoints`.

- ❌ **store-only dead-ends** — no SSH client dep anywhere, no `ssh` spawn, `ssh_hosts` read only by its own CRUD/SDK-types/UI; `endpoints` has no inference-routing consumer. The agent cannot dispatch to a saved host or route to a saved endpoint.
- ⚠️ nuance: cloud-compute skills SSH into boxes **they provision** (lambda/tensorpool/skypilot) — real SSH, unrelated to the panel.

**Fixes (pick one):** (a) **remove** the SSH-hosts + model-endpoints sections + routes (recommended near-term — stop advertising vaporware); (b) **wire it** — a remote-exec tool reading `ssh_hosts` (needs an SSH client dep + key handling) + treat `endpoints` as selectable OpenAI-compatible targets, injected into compute-agent context. **Decision required + security sign-off** on private-key storage (the store has no key field today).

## Path D — Managed compute via the Atlas CLI (❌)

Config seeding works (`ensureAtlasCliConfig`, verified by `atlas doctor`). Intended UX: "Compute spend = Managed" (`Spend.tsx`) → `billing.compute` → a `<system-reminder>` injected by `insertReminders` (`prompt.ts:1321-1333`) telling the agent to run `atlas compute:up`. Atlas has the machinery: `POST /api/compute/leases` provisions Modal sandboxes + reseller GPU VMs, billed to the wallet (`compute.py:305-421`, `compute_billing_service.py`).

**Correction to the initial audit** (which tested the _installed 0.13.1_): the atlas CLI at the **published latest (0.13.2)** ships a real compute suite — `cli/src/atlas-runtime/commands.mjs:915-923` registers `compute:up` (aliases `launch`/`lease` → `POST /compute/leases`, _"zero flags = cheapest GPU; managed bills the wallet per hour; BYOK free"_), `compute:catalog`/`gpus`/`options` (browse GPUs → `/compute/options`), `compute:list`/`leases` (`GET /compute/leases`), `compute:ssh` (`/connection`), `compute:release`/`down` (`/release`). So `atlas compute:up` **is a real command in 0.13.2**, hitting the exact `/api/compute/leases` API — the prompt is _aspirationally correct_, not naming a phantom.

- ⚠️ **Version gap is the core defect.** HYscience pins `@hysci/atlas@^0.5.12` (`backend/cli/package.json`); the installed CLI is 0.13.1 (whose `--help` doesn't surface compute); **npm latest is 0.13.2** (which does). So the MANAGED prompt (`prompt.ts:1329` `atlas compute:up`) names a real command the **shipped/pinned atlas CLI predates** → it doesn't resolve for users today.
- ⚠️ **The surface has churned** — the CLI CHANGELOG shows a `compute:*` set removed then a richer one re-added; and it also describes provisioning as a **web-dashboard "Lambda Labs reseller" Compute tab**. Confirm the intended UX (CLI leasing vs web dashboard, Modal as agent-runtime-internal) is settled before wiring the prompt hard to it.
- ⚠️ `exec:start` is a **separate** graph-ledger command (INSERTs a bookkeeping row, no Modal/lease call, `execution_service.py:45-87`) — not the compute path; don't conflate the two.
- ⚠️ server-side managed GPU is **off by default** — `COMPUTE_RESELL_ENABLED="false"` (`config.py:387`).
- ⚠️ `billing.compute` is **prompt-only** — unlike `billing.llm` (mirrors to server + resyncs), it just persists + injects the reminder.
- ⚠️ substrate named 3 ways — "Daytona-backed" (`research.txt:229`) vs "Modal sandbox" (`atlas agent:run --help`) vs "Atlas-provisioned" (`config.ts:984`).
- **FLAG:** an actual lease still needs `COMPUTE_RESELL_ENABLED=true` + operator keys + a funded wallet + a Modal account to verify end-to-end.

**Fixes:** (1) **primary — bump `@hysci/atlas` `^0.5.12`→`^0.13.2`** (align the pin + the seeded/expected version to the published CLI that has compute) and verify `atlas compute:*` resolves against the installed version; then `prompt.ts:1329`'s `atlas compute:up` is truthful. Add a prompt-time guard: if the installed `atlas` lacks `compute:*`, the MANAGED reminder falls back to BYOK rather than naming an unresolvable command. (2) enable resale (`COMPUTE_RESELL_ENABLED`) + wire `billing.compute` to reality (mirror `billing.llm`) so the managed path actually leases. (3) reconcile the CLI-leasing vs web-dashboard-reseller UX (owner decision). (4) reconcile substrate naming. (5) decide the BYOK source of truth.

## Cross-cutting — overlapping BYOK stores

A user's Modal key can live in **three** places with no reconciliation: the local **Compute** panel (`compute.ts`), the local **Credentials** panel (`credentials.ts`), and Atlas's **server-side** `compute_keys_service` (injected into managed sandboxes, plan-gated). Different execution contexts (local skill subprocess vs Atlas-provisioned sandbox); needs a source-of-truth decision (cross-repo).

## Consolidated backlog (by effort)

| #   | Fix                                                                                                                                                                          | Path | Effort                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------- |
| 1   | Bump `@hysci/atlas` pin `^0.5.12`→`^0.13.2` so `atlas compute:up` resolves; add a "compute unavailable → BYOK" prompt guard (`prompt.ts:1329`); reconcile `research.txt:229` | D    | S                     |
| 2   | Azure: add Storage cred or drop "Azure" copy                                                                                                                                 | B    | XS                    |
| 3   | Vast/RunPod: "no skill yet" or remove from catalog                                                                                                                           | A    | XS                    |
| 4   | `last_used`: populate or remove                                                                                                                                              | A    | XS                    |
| 5   | Fix atlas-bin fallback scope `@hyscience→@hysci`                                                                                                                             | A    | XS                    |
| 6   | Modal de-dup across Compute vs Credentials                                                                                                                                   | A    | S                     |
| 7   | Remove or wire SSH-hosts + model-endpoints                                                                                                                                   | C    | S (remove) / L (wire) |
| 8   | Document cloud-storage contract + optional rclone seeding                                                                                                                    | B    | S                     |
| 9   | Enable resale + wire `billing.compute` to reality (mirror `billing.llm`) so managed leasing works end-to-end                                                                 | D    | M                     |
| 10  | Reconcile 3-way BYOK store + atlas version pin                                                                                                                               | A/D  | M                     |

## Risks / decisions needed from the owner

- **Is managed compute in scope this sprint?** Backend is built but the CLI surface + default-off flag mean it's not shippable today — if out of scope, stop advertising it (`Compute.tsx:159-162`, `Spend.tsx:42`).
- **SSH hosts / endpoints:** in scope (wire, +SSH dep + key security) or remove?
- **Infra to verify:** BYOK round-trips need provider accounts; cloud storage needs real creds+bucket+CLIs; managed leases need operator keys + `COMPUTE_RESELL_ENABLED=true` + funded wallet + Modal. **Do not mark any path "works" without exercising it.**
- **BYOK source-of-truth** is a cross-repo decision.

## Acceptance criteria

- No prompt instructs a command absent from the bundled CLI (grep prompts for every `atlas …` verb; assert each resolves in `atlas --help`).
- Connecting Vast/RunPod either drives a real run or the UI no longer implies it will.
- Storage lists only credential-backed backends (Azure fixed or removed); a documented smoke test (with creds) round-trips an object on S3 + GCS.
- SSH/endpoint panels are gone, or adding a host + "run nvidia-smi on <host>" executes over SSH.
- With managed enabled + infra: `Compute spend = Managed` starts a real lease, wallet debits per the 60 s tick, auto-releases — demonstrated once.
- One substrate name + one canonical atlas version documented; `billing.compute` changes behavior or is labeled advisory; `settings-compute` tests stay green.

**Key files:** `components/settings/{Compute,Storage,Spend}.tsx`, `server/routes/settings/{compute,storage,credentials,billing}.ts`, `hyscience/index.ts`, `session/{prompt,billing-gate}.ts`, `agent/prompt/research.txt`, `config/config.ts`. Atlas: `routes/compute.py`, `services/{execution,compute_billing,compute_keys}_service.py`, `compute/{lease_manager,modal_provider}.py`, `config.py`.
