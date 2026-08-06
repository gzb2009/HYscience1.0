# CLAUDE.md: HYscience

## Project Overview

**HYscience (`hyscience`)** is an open-source, model-agnostic AI research agent for ML engineering and scientific work. Built with Bun and TypeScript, it ships as native binaries for Linux, macOS, and Windows.

- **npm package**: `@hysci/hyscience`
- **Binary name**: `hyscience`
- **Config dir**: `~/.config/hyscience/` (also `~/.hyscience/`; legacy `~/.synsc` auto-migrates)
- **Config file**: `hyscience.json`
- **Provider ID**: `hysci` (Atlas wire contract, do not rename)

## Repository Structure

Single git repo organized by runtime boundary.

```text
frontend/          workspace (browser UI), docs/share site, and shared UI
backend/           CLI/server, skills, sessions, and provider integrations
tooling/           SDK, plugin runtime, repo automation, launcher, utilities, and patches
```

## Development

```bash
# Run CLI in dev mode
bun run dev

# Build all platform binaries
cd backend/cli && bun run build

# Typecheck
bun run typecheck

# Run tests
cd backend/cli && bun test
```

## Prompt Architecture (Dual-Layer)

The CLI uses a **dual-layer prompt system**: provider-level system prompts + agent-level workflow prompts.

```
User request with agent name (e.g., "research")
  │
  ├─ Layer 1: SYSTEM role ← unified base + provider tail
  │   src/session/system.ts composes base-system.txt with model-specific rules
  │
  └─ Layer 2: USER role injection ← agent prompt (task-specific)
      src/session/prompt.ts selects by agent name + tier
```

### Session prompts (`src/session/prompt/`) (1 base + 5 provider + 5 utility)

| File                                                       | Purpose          |
| ---------------------------------------------------------- | ---------------- |
| `base-system.txt`                                          | All models       |
| `anthropic.txt`                                            | Claude models    |
| `beast.txt`                                                | GPT-4o / o1 / o3 |
| `codex_header.txt`                                         | GPT-5 / Codex    |
| `gemini.txt`                                               | Gemini models    |
| `qwen.txt`                                                 | Qwen / fallback  |
| `plan.txt`, `plan-enter.txt`                               | Plan mode        |
| `build-switch.txt`, `max-steps.txt`, `result-delivery.txt` | Utility          |

Routing logic: `src/session/system.ts` → `SystemPrompt.provider(model)`.

### Agent prompts (`src/agent/prompt/`)

| File                    | Agent(s)                                |
| ----------------------- | --------------------------------------- |
| `research.txt`          | `research` (default harness)            |
| `biology.txt`           | `biology` (specialist)                  |
| `physics.txt`           | `physics` (specialist)                  |
| `ml.txt`                | `ml` (specialist)                       |
| `physics-critique.txt`  | `physics-critique` (subagent)           |
| `critique.txt`          | `critique` (subagent)                   |
| `reviewer.txt`          | `reviewer` (subagent)                   |
| `literature-review.txt` | `literature-review` (subagent)          |
| `write.txt`             | `write` (subagent)                      |
| `explore.txt`           | `explore` (subagent)                    |
| `plan.txt`              | `plan` (mode, in `src/session/prompt/`) |
| `compaction.txt`        | `compaction` (system)                   |
| `title.txt`             | `title` (system)                        |

Routing logic: `src/session/prompt.ts` injects agent workflow prompts by agent name (an if-chain in `insertReminders`).

### Agent registry (`src/agent/agent.ts`)

Defines built-in agents with `Agent.Info` schema: `name`, `mode` (primary/subagent/all), `hidden`, `model`, `prompt`, `permission`, `temperature`, `steps`.

**Default harness**: `research` (the single user-facing default; also the plan-exit target)
**Specialists**: `biology`, `physics`, `ml`
**Mode**: `plan` (read-only)
**Subagents** (hidden from users): `task`, `explore`, `literature-review`, `critique`, `reviewer`, `physics-critique`, `write`
**System agents**: `compaction`, `title`

Custom agents can be added via config file (`hyscience.json` → `agent` key). See `src/cli/cmd/agent.ts` for the creation CLI.

## RCA & Debugging Guide

### Agent misbehaving? Trace the prompt chain:

1. **Which agent is active?** → `src/agent/agent.ts`, find the agent by name, check its `mode`, `model`, `prompt` fields
2. **Which prompt is injected?** → `src/session/prompt.ts`, follow the `input.agent.name` switch
3. **Which system prompt?** → `src/session/system.ts`, `SystemPrompt.provider(model)` selects by provider

### Common failure patterns:

| Symptom                    | Likely cause                                   | Where to look                                                       |
| -------------------------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| Agent ignores skills       | Skill catalog missing/truncated in prompt      | `src/agent/prompt/{agent}.txt`, check toolkit section               |
| Wrong model used           | Agent/model config incorrect                   | `src/agent/agent.ts` + `hyscience.json` `agent` config              |
| Agent skips stages         | Stage gates not mandatory in prompt            | `src/agent/prompt/{agent}.txt`, check BLOCKING vs advisory language |
| Critique not triggered     | Critique is advisory, not mandatory            | `src/agent/prompt/critique.txt` + parent prompt's critique section  |
| Sub-agent returns empty    | Context window exhaustion or bad prompt        | `src/agent/agent.ts`, check subagent's `steps` limit                |
| Custom agent not appearing | Config not in `hyscience.json` or wrong `mode` | Config file `agent` key → `src/agent/agent.ts`                      |

### Key files for prompt debugging (read these first):

```
src/agent/agent.ts          # Agent definitions, what agents exist and their config
src/agent/prompt/*.txt      # Agent behavior, what the agent is told to do
src/session/prompt.ts       # Routing, which prompt gets injected for which agent
src/session/system.ts       # Provider routing, which system prompt for which model
```

## Style Guide

See `AGENTS.md` for full style guide. Key points:

- Prefer `const` over `let`, avoid `else`, single-word variable names
- Use Bun APIs (`Bun.file()`, etc.)
- Rely on type inference, avoid explicit annotations
- No mocks in tests, test real implementations
- No `any` type
