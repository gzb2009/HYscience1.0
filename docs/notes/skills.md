# Skills: where they come from and how they resolve

A **skill** is an instruction bundle (`SKILL.md` with `name`/`description`/`category`
frontmatter and a body) that the agent loads on demand to prime itself for a task.
This note explains where skills are discovered and how a bare name resolves —
useful when a skill is unexpectedly "not found".

## Sources (in load order)

The catalog is assembled in `backend/cli/src/skill/skill.ts` from several sources,
keyed by skill `name`:

1. **Project `.claude/skills/`** — skills committed to the repo being worked in,
   plus `~/.claude/skills/` (opt out with `HYSCIENCE_DISABLE_CLAUDE_CODE_SKILLS`).
2. **The Atlas skill catalog** — released builds fetch the index from
   `/api/cli/skills` (name + description only; content is fetched lazily on first
   use) and cache it. This is the primary source of the bundled library in a
   shipped binary, which carries no skills of its own.
3. **Dev / bundled tree** — when running from source, the repo's `skills/`
   directory is loaded directly.
4. **System skills** — a small set the product invokes directly (e.g.
   `initialize-atlas-graph`, which the canvas and research agent run) is embedded
   in the binary and materialized locally when the catalog omits it, so it
   resolves in every install.
5. **Learned skills** — distilled from prior runs (RSI), synced from the cloud
   and cached under the data directory.
6. **User skills** — authored locally via `hyscience skill new`, private by
   default.

All of steps 2–4 respect the `HYSCIENCE_DISABLE_BUNDLED_SKILLS` opt-out.

## Resolution

`Skill.get(name)` looks up the assembled name→skill map. Earlier sources win on a
name collision, so a local or system skill shadows a catalog entry of the same
name. If a name isn't present, the skill tool returns a "not found" error with the
closest fuzzy matches.

## Authoring

```bash
hyscience skill new leakage-checks --description "Checklists for spotting data leakage"
hyscience skill validate leakage-checks
hyscience skill list --all      # everything discovered on this install
```

Pin extra skill folders per project with `skills.paths` in `hyscience.json`.
