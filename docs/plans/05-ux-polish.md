# 05 — Overall UX polish / cohesion

Workstream: raise general polish and cohesion of the browser workspace. Citations `file:line` under `frontend/workspace/src/`.

## Current state

The workspace runs **two-and-a-half parallel design systems**: (1) hand-rolled inline-styled "thesis" markup (`FONT_MONO/SANS/SERIF` + `var(--color-*)`, per-file style helpers) across almost all of `thesis/*` and 9 of 12 settings panels; (2) the `@hysci/ui` kit (`Dialog/List/Button/TextField/Icon`) in `DialogSelectServer`, the model dialogs, `FolderPicker`, and the settings `_shared.tsx` trio; (3) a third idiom in `session-new-view.tsx` (Tailwind tokens + `language.t`). A `.thesis-skeleton` shimmer exists (`styles/thesis.css:1061-1069`) with **zero `.tsx` usages** — surfaces render the literal string `loading…` instead.

## What's broken / missing

- **Bugs:** two `transition: … 1120ms` typos (almost certainly `120ms`) → ~1 s sluggish fades: `FilePreview.tsx:471` (backdrop), `FolderPicker.tsx:433` (loading desaturation).
- **Missing error states:** `FileView`'s `file.read` resource has no `catch` → silent-empty on failure (`FilePreview.tsx:133-144`); `FolderPicker` swallows errors to `[]` → shows "empty," never an error (`:80-83`); `FileExplorer` permission error has copy but **no retry button** (`FileExplorer.tsx:411-446`).
- **Missing loading states:** `SkillsBrowser` reads `sync.data.skill` synchronously → pre-sync shows "no matching skills," conflating not-loaded with empty (`SkillsBrowser.tsx:166,379`).
- **Copy-casing clash:** house style is lowercase-mono (`loading…`, `empty folder`) but empty/error states switch to Sans sentence-case: "No files here" (`HYscienceFileTree.tsx:207`), "Can't read this folder" (`FileExplorer.tsx:432`), "No file changes in this session yet." (`RightPane.tsx:785`), "Binary file — no inline preview." (`FilePreview.tsx:398`).
- **Dead/rough code:** `RightPane` ships a large unreachable block — `LogView` stub "activity log will stream here" (`RightPane.tsx:1565-1580`), a dev-grade `raw status` JSON dump (`:1247-1259`), unreferenced Files/Repo/Artifacts tabs (`:627-1562`); `thesis/store/files.ts` is legacy (both trees fetch via `sdk.client.file.list`); `session-new-view.tsx` is orphaned relative to `ChatWelcome`.
- **Settings inconsistency:** split error surface (inline red banner vs `showToast`), inconsistent first-load loading, heavy duplication (`fieldStyle()`/`Section`/`Row`/`ModeCard`≈`IntentCard` redeclared across Credentials/Spend/Usage/General/Compute/Storage), and **native browser dialogs** — `window.prompt` for MCP OAuth code paste (`Connectors.tsx:104`) and storage-relocation path (`Storage.tsx:68`), plus `window.confirm` for removes/sign-out.
- **Small cohesion gaps:** `Toast` has no exit animation (`Toast.tsx:75`); `Wordmark` `<img src="/hyscience-logo.png">` has no 404 fallback (`Wordmark.tsx:28-38`); `Credentials` has no success toast; brand/URL split (`config/urls.ts` → `hyscience.ai` while the product ships as "hyscience" at `hyscience.sh`).
- **Best-in-class references to standardize on:** `DialogSelectServer` (kit dialog + health dots), `HYscienceFileTree`'s FDA error with a System-Settings deep-link (`:211-263`), `RightPane`'s `KeepAlive` (`:597-617`), the reduced-motion handling (`styles/thesis.css:406-428`).

## Prioritized backlog (highest leverage first)

1. **Fix the `1120ms`→`120ms` transition typos** (`FilePreview.tsx:471`, `FolderPicker.tsx:433`). Trivial; removes visible lag. _(quick win)_
2. **Kill the no-model transient-toast dead-end** — route `Composer.tsx:719-727` / `:1188-1191` to the setup path (shared with WS4). Highest user-facing leverage.
3. **Add real error states** — catch on `FileView`'s `file.read` (`FilePreview.tsx:133-144`); a **retry button** on `FileExplorer` (`:411-446`); stop `FolderPicker` masking errors as empty (`:80-83`).
4. **Adopt one loading treatment** — wire the existing `.thesis-skeleton` (or `AsciiSpinner`), replace scattered literal `loading…`; give `SkillsBrowser` a loading state distinct from empty.
5. **Normalize empty/error copy** to lowercase-mono house style across `FileExplorer`/`HYscienceFileTree`/`RightPane`/`FilePreview`.
6. **Standardize settings loading/error** on one pattern (skeleton + inline banner) and replace `window.prompt`/`window.confirm` with kit dialogs (`confirmDialog`/`promptDialog` already in `thesis/dialogs.tsx`) — priority `Connectors.tsx:104`, `Storage.tsx:68`.
7. **Delete or wire dead code** — `RightPane` `LogView` stub + raw-status dump + unreachable tabs, legacy `store/files.ts`, orphaned `session-new-view.tsx` (confirm reachability first).
8. **Converge design systems incrementally** — extract repeated thesis style-helpers into shared primitives; migrate the 9 bespoke settings panels onto `_shared.tsx`; pick the kit for new dialogs.
9. **Small cohesion fixes** — `Toast` exit animation, `Wordmark` img fallback, `Credentials` success toast, a brand/URL copy pass.

## Risks

- **Dead-code removal needs reachability confirmation** (`RightPane` blocks, `store/files.ts`, `session-new-view`) before deleting.
- **Design-system convergence is broad** — do it incrementally (shared primitives first, then panel-by-panel) to avoid a big-bang refactor and reduced-motion regressions.
- **Copy normalization** touches many files — batch + snapshot-test.
- Low functional risk overall — mostly visual/state-handling.

## Acceptance criteria

- No transition longer than intended; no ~1 s fades.
- Every file/folder/skill surface has distinct loading, empty, and **error** states (with retry where a refetch exists); no silent-empty-on-failure.
- One loading treatment and one error-surface pattern across settings; no native `window.prompt`/`window.confirm` in the workspace.
- Empty/error copy follows a single documented casing convention.
- No unreachable/stub UI ships in `RightPane`; `store/files.ts` and `session-new-view` resolved.
- New UI defaults to `@hysci/ui`; thesis primitives are shared, not re-declared per file.

**Sequencing note:** items 1 and 3 are quick standalone wins; item 2 lands with WS4 (shared setup path). The design-system convergence (8) is the largest and should be incremental, likely spilling beyond this sprint — track leftovers in `notes/`.
