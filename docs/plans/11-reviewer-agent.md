# 11 — Reviewer agent + agent-platform ideas

Workstream: a "reviewer agent" = a fresh-context agent that critiques another agent's output **before it's finalized** (a reliable review pass). Findings-first; citations `file:line`.

**TL;DR:** three well-written read-only review subagents exist, but every review is **advisory** — triggered only by prompt-level "MANDATORY" text the primary LLM may or may not honor. There is **no code path that guarantees a review before the final answer is emitted**. The one post-finalize hook (`RSITrajectory.pipeline`, `prompt.ts:330`) is fire-and-forget skill-distillation, not a review gate. The flagship `reviewer` agent is wired into exactly one primary prompt (`ml`). The fix is a code-level reviewer gate at the loop-exit hook that reuses the existing prompts.

## Current state

**The three review subagents** (`agent/agent.ts:255-318`), all `mode: subagent`, all read-only-enforced (`"*": deny` + allow read/glob/grep/…):

- `critique` (`:255-275`) — blocking-error checklist for methodology/stats/leakage (`critique.txt`), PASS/BLOCK.
- `physics-critique` (`:276-296`) — computational-physics validation under the Aletheia blind pattern, CORRECT/MINOR_FIXES/CRITICALLY_FLAWED/INSUFFICIENT.
- `reviewer` (`:297-318`) — a blind adversarial auditor ("critic half of an actor-critic loop", `reviewer.txt:2-5`): hunts citation-mismatch / untraceable-number / figure-stat-mismatch, walks the **provenance DAG** via `provenance_query`, records findings via `provenance_review`, emits `{claim,issue,severity,evidence}` + CLEAN/FLAGGED.

Config facts: **no `model` override** → reviewers run on the caller's model (`task.ts:105-109`) — fresh context, not fresh model; **no `steps`** → `maxSteps = agent.steps ?? Infinity` (`prompt.ts:586`), unbounded; **no `task` permission** → can't recurse (`task.ts:63,85-93`).

**Invocation is pull-based.** The `task` tool (`tool/task.ts`) is the sole entry: catalog (`:27-40`) → permission (`:48-58`) → resolve (`:60`) → **fresh child session** `parentID = ctx.sessionID` (`:71-101`) → model (`:105-109`) → prompt injection as the **system** message (`llm.ts:72`, since subagents set `Info.prompt`) → return last text part (`:182`), compressed to `<task_result>` for `ARTIFACT_AGENTS = ["research","biology","ml"]` (`:16,184-204`). **Nothing forces the parent to call it.**

**"Mandatory" gates are prompt text only**, enforced by nothing but model compliance: `research.txt:420-441` (critique gates 1&2), `biology.txt:846-877`, `physics.txt:304-341` (physics-critique "blocking gate"), `ml.txt:243-270` (critique + **reviewer**). **The generic `reviewer` is referenced by only `ml.txt`** — `research` (default harness), `biology`, `physics` never call it. Per-tier iteration caps ("fast: 1 cycle … ultra: 4") are advisory prose with no enforcing code.

**Adjacent infra that looks like review but isn't a gate:** `provenance_review` (`tool/provenance.ts:104-150` → `review.ts:43-71`) writes durable DAG findings — but only if `reviewer` runs. `RSITrajectory.pipeline` (`prompt.ts:330-331`, fire-and-forget) does capture → `RSICritic.evaluate` (a **deterministic heuristic**, `rsi/critic.ts:106-142`; the LLM critic path `:24-101` is dead code) → distill a learned skill if score ≥75. It never reads/blocks/annotates the user answer.

## What's broken / missing

1. **No guaranteed review** — every pass is at the LLM's discretion via `task`; a model that skips it (or whose context was compacted past the instruction) silently finalizes unreviewed. Zero runtime enforcement in the loop (`prompt.ts:322-334`).
2. **The loop-exit hook ignores review** — `prompt.ts:322-334` is where a finalize gate belongs; only RSI skill-distillation is wired there.
3. **The best reviewer is barely wired** — `reviewer` (provenance claim/citation/number audit) only in `ml.txt`.
4. **Verdicts non-binding** — even a FLAGGED/BLOCK verdict forces no fix-and-recheck.
5. **Blindness not enforced** — the actor-critic asymmetry depends on the parent passing artifacts not reasoning; nothing enforces it.
6. **Unbounded review cost once mandatory** — `steps ?? Infinity` + caller's frontier model.
7. **Physics excluded** from `ARTIFACT_AGENTS` (`task.ts:16`) and RSI capture (`prompt.ts:330`).

## Proposed change — a reliably-triggered reviewer gate

**Where it hooks:** a finalize gate at the loop-exit branch (`prompt.ts:322-334`), mirroring the `RSITrajectory.pipeline` hook — the one place guaranteed to run regardless of whether the model self-invoked `task`.

**What it reviews:** the final answer text + the artifacts/claims it references (+ the provenance DAG when present) — feed it the last assistant text, the artifact paths already in the `<task_result>` path (`task.ts:188-204`), and `provenance_query` access. Reviews key claims/numbers/citations/figure-stat consistency (exactly `reviewer.txt`'s remit), not style.

**Config-graded (shippable):**

- **Level 0 — annotate (default, non-blocking):** run the reviewer, append verdict + findings as a footer note. Zero regression; immediate "reviewed: CLEAN/FLAGGED (N)" signal.
- **Level 1 — soft gate:** on FLAGGED/blocking, inject the report back as a user-role reminder and continue the loop for a **bounded** number of fix cycles (a real cap, not prose), then finalize with an honest "unresolved findings" note.
- **Level 2 — hard gate (opt-in / autonomous mode):** refuse to finalize while any blocking finding is unresolved, up to the cap.

Gate by `hyscience.json` config, defaulting to Level 0/1. Domain-map the reviewer prompt (physics-critique for physics, reviewer for research/biology/ml, critique for methodology), **reusing the existing `.txt` prompts unchanged** and the existing `task`/session machinery (fresh child session ⇒ blindness + fresh context for free). Science-reviewer angle: make `reviewer.txt` the default gate for artifact agents (traces every number/citation to the DAG, records durable `provenance_review`); pass artifacts, not reasoning.

**Cheap prototype:** `SessionReview.gate(sessionID, agent)` at `prompt.ts:329-333` behind `config.experimental.reviewGate`, implemented by reusing `SessionPrompt.prompt` against a fresh child session with the domain-mapped reviewer (same call `task.ts:151` makes). Start Level 0 annotate-only; add a real `steps` cap; fold `physics` into `ARTIFACT_AGENTS`. Promote to Level 1 once trusted.

## Open-ended menu (owner picks)

- Wire `reviewer` into `research`/`biology`/`physics` prompts (currently `ml`-only) — one-line additions, immediate coverage win.
- Give review subagents a real `steps` budget (`agent.ts:255-318`) — bounds cost/latency once mandatory.
- Assign reviewers an independent/cheaper `model` — true actor-critic independence + cost control.
- Enforce blindness structurally (strip generator reasoning, pass artifact paths only).
- Wire the unused LLM critic path (`rsi/critic.ts:24-101`) or delete it.
- Surface `provenance_review` findings in the UI (a "review panel").
- Consolidate the reviewer family (overlapping output-integrity checklists) into a shared include.
- Add tests for the gate (only `test/permission-task.test.ts` is adjacent today).
- Make per-tier iteration caps real config, not prose.

## Risks

Latency & cost (mandatory reviewer doubles model calls; unbounded steps) → cap steps + cheaper reviewer model + annotate-only default. False-positive gating trapping trivial lookups → Level 0 default + low cap + skip trivial/no-artifact turns (mirror `research.txt:454`). Prompt-vs-code double review → make prompt gates advisory once the code gate exists. Blindness regression → pass artifacts only. Compaction interaction → re-injected reports must persist like `research-state.md`.

## Acceptance criteria

1. Every finalized answer from a primary/artifact agent has an associated reviewer verdict (verifiable in session metadata).
2. The reviewer runs in a fresh child session and receives artifacts, not reasoning.
3. The gate is bounded (configurable max fix-cycles + reviewer `steps` cap); no unbounded loops.
4. Findings on DAG-backed outputs are recorded via `provenance_review` and retrievable (`review.ts:77-87`).
5. Default is non-breaking (annotate-only, flag-gated); the soft gate demonstrably forces ≥1 fix cycle on a seeded blocking finding.
6. Non-artifact/trivial turns are unchanged (gate skipped) and both paths are tested.

**Key files:** `session/prompt.ts` (loop-exit `:322-334`, injection `:1314+`, steps `:586`), `tool/task.ts` (spawn `:151-168`, `ARTIFACT_AGENTS :16`), `session/llm.ts:72`, `agent/agent.ts:255-318` (add model/steps), `agent/prompt/{reviewer,critique,physics-critique}.txt` (reused), `science/provenance/review.ts` + `tool/provenance.ts`, `agent/prompt/{research,biology,physics}.txt` (wire in reviewer).
