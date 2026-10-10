# US-1660: Git tree, file diff, compare, archive strings

**Epic:** [EPIC-125 — Extract every UI string](../../epics/EPIC-125.md) · **Status:** Implementation complete; live `en-XA` check pending

## Goal

Extract app-owned visible text in `src/renderer/editors/git-tree/`, `file-diff/`, `compare/`, and `archive/` into a new `git` English catalog area, reusing existing catalog messages where their context matches. Keep Git data, stable identities, script/MCP behavior, product names, and thrown errors in English.

## Progress

- [x] Review approved; apply scoped build fallback: report `spawn EPERM` from `npm run build-prod` and continue with the remaining work.
- [x] Skip `npm run i18n:check` because it is unavailable in the sandbox; the user will run it.
- [x] Add/register the Git catalog and extract the scoped UI copy (58 new catalog keys).
- [x] Keep stable data-name, menu IDs, persisted values and agent-facing data intact.
- [x] Run the requested scoped ESLint, full lint, typecheck and production build; record any sandbox failure.
- [ ] Inspect Git Tree, File Diff/File History, Compare and Archive live under `en-XA` using the routes below.

## Background

EPIC-125 decisions E1–E7 and the US-1660 description govern this work. The scope has 59 current `vanilla-view/no-hardcoded-ui-strings` reports, measured with the scoped ESLint command below. The manual pass found additional text passed positionally through helpers, shorthand props, and row builders. The component Git tree was converted in US-1655; its `menus.*` keys are already used by `src/renderer/components/git-tree/git-refs-tree.ts` and should be reused rather than duplicated.

The catalogs use flat two-part keys. Add `src/shared/i18n/en/git.ts` and register it in `src/shared/i18n/en/index.ts`. Resolve `t()` while building view props or rendering; do not cache translated values at module scope. Use whole-message placeholders for sentences and CLDR category objects for counts. `untranslated()` from `src/shared/i18n/t.ts` marks product/data/identity text that must remain English in a UI position. `englishMessage(key)` is for English identity values backed by a catalog key.

The worked extraction in [US-1652](../US-1652-pilot-extraction/README.md) establishes the same-key UI/agent split, lazy lookup, and live `en-XA` check patterns.

## Investigation findings

### Scoped lint baseline

Ran:

```powershell
$scope = @('src/renderer/editors/git-tree','src/renderer/editors/file-diff','src/renderer/editors/compare','src/renderer/editors/archive')
npx eslint $scope -f json -o "$env:TEMP\us1660-eslint.json"
```

The JSON report was filtered to `vanilla-view/no-hardcoded-ui-strings`: **59 reports in 13 files**. The exact reported literals/positions are:

| File | Reports | Reported UI text |
|---|---:|---|
| `src/renderer/editors/archive/ArchiveEditorView.ts` | 3 | `No archive loaded.`; `Collapse All`; `Refresh` |
| `src/renderer/editors/archive/ArchiveSecondaryView.ts` | 3 | `Close`; `Archive` (header title, used twice) |
| `src/renderer/editors/compare/CompareEditor.ts` | 1 | `Exit Compare Mode` |
| `src/renderer/editors/file-diff/FileDiffBodyView.ts` | 2 | `Nothing to compare — this file isn't in a git repository, or git is unavailable.`; `Switch to Text Editor` |
| `src/renderer/editors/file-diff/FileDiffToolbarView.ts` | 1 | `From` |
| `src/renderer/editors/file-diff/GitDiffRevisionsSecondaryView.ts` | 4 | `Git is unavailable.`; `Refresh`; `File History` (header title, used twice) |
| `src/renderer/editors/git-tree/CommitDiffPanel.ts` | 2 | `Select a commit to view its changes.`; `Open in new Tab` |
| `src/renderer/editors/git-tree/CommitInfoPanel.ts` | 1 | `Select a commit to see its details.` |
| `src/renderer/editors/git-tree/GitChangesView.ts` | 8 | `Git is unavailable.`; `Stage {count} file(s)`; `Reset {count} file(s)`; `Reset changes`; reset confirmation; `Commit`; `Stage selected`; `Unstage selected` |
| `src/renderer/editors/git-tree/GitPanelSecondaryView.ts` | 10 | `Changes`, `Branches`, `Tags` (segment labels, each rendered in both initial/update props); alphabetical-sort tooltip (off state); `Refresh`; `Close Git Tree`; `Git` |
| `src/renderer/editors/git-tree/GitRefsView.ts` | 4 | `Git is unavailable.`; `Switch to Branch '{refName}' (current)`; `Switch to Remote Branch '{refName}'`; `Switch to Tag '{refName}' Commit` |
| `src/renderer/editors/git-tree/GitTreeEditorModel.ts` | 8 | `Git Tree`; `Open Git Root Folder`; `Copy Remote URL`; `Failed to switch: {error}`; `Create branch`; `Create branch at {shortHash}`; `Failed to create branch: {error}`; `{folder} — Git` |
| `src/renderer/editors/git-tree/GitTreeEditorView.ts` | 12 | `Refresh` (used twice); `Repo:`; `Commit`; `Diff`; pull tooltip/`Pull (merge)`; `Fetch all`; push tooltip; switch-to-branch/current/remote/commit context actions; `Create branch here…` |

This is the exact rule report, not the total visible-copy inventory. In particular, menu labels interpolated with counts, segment labels passed via view props, and repeated positions share catalog entries rather than creating per-call-site keys.

### Manual text missed by the rule

Review these in addition to the 59 lint reports:

- `src/renderer/editors/git-tree/GitChangesView.ts`: the positional `gridProps("Unstaged", ...)` / `gridProps("Staged", ...)` calls in `onMount()` and `applyState()` produce visible grid headings. `gridProps()` also lowercases that argument into `FileGridProps.name`; split this into a translated label and a stable name derived from `listKind`.
- `src/renderer/editors/git-tree/CommitInfoPanel.ts`: `row("Author", ...)`, `row("Date", ...)`, `row("Commit hash", ...)`, and `row("Refs", ...)` are visible labels passed positionally to a local helper.
- `src/renderer/editors/file-diff/FileDiffToolbarView.ts`: the positional `createTextElement("From", ...)` is the left revision caption (the scoped lint report also lists this call).
- `src/renderer/editors/git-tree/GitRefsView.ts`: the shorthand `emptyMessage` is `No branches` or `No tags`.
- `src/renderer/editors/git-tree/GitPanelSecondaryView.ts`: `showMainTitle: "Show Git Tree"` is passed to the shared panel-header helper; the sort tooltip also has the unreported `Sort alphabetically (on)` arm.
- `src/renderer/editors/git-tree/GitTreeEditorView.ts`: `showBodyMessage({ kind: "loading", text: "Loading history…" })` and the unavailable-state message `Git is unavailable — check that git is installed and on your PATH, and that Git integration is enabled in Settings.` render helper data as UI copy.
- `src/renderer/editors/file-diff/GitDiffRevisionsSecondaryView.ts`: synthetic rows use `Unstaged changes` (initial setup and state update) and `Staged changes` (state update); these strings reach the shared commit-grid subject renderer.
- `src/renderer/editors/file-diff/RevisionPickerView.ts`: `labelFor()` returns `Unstaged`, `Staged`, `HEAD`, or a commit short hash. Translate the first two based on `selection.kind`; keep `HEAD` as a Git ref and the short hash as data.

Also inspect the complete scoped files for new visible text passed through helper arguments, `text`/`message` fields consumed later, and array/map driven rendering. The items above are verified positions in the current source, not permission to ignore any additional app-owned copy found during implementation.

Implementation's second pass also found two File Diff placeholder messages in `CommitDiffPanel.ts` that were not in the first 59-report list: `No file changes in this commit.` and `Select a file to view its diff.` They are now represented by `git.noFileChangesInCommit` and `git.selectFileForDiff`; the original 59 is the pre-change ESLint report count, not the total number of unique catalog messages.

## Identity and agent-facing text

Treat visible labels and identity/data as separate values in these places. Do not make behavior depend on translated text.

| Location | Identity/data relationship | Handling |
|---|---|---|
| `src/renderer/editors/git-tree/GitTreeEditorModel.ts`: `GitTreeEditorState.title` defaults to `Git Tree`; `initFromRepoRoot()` stores `{folder} — Git` in the same field. The page descriptor persists editor state, and the title is the tab/page title. | The displayed title is also persisted page state; `folder` is the repository basename and `Git` is a product name. | Keep the title English and mark its UI use with `untranslated(...)`. Use `englishMessage("editors.gitTree")` for the fixed default (existing key); mark the path-derived title with `untranslated(...)`. Keep `repoRoot`, `repoName`, and folder basename unchanged. Do not translate the persisted title in place.
| `src/renderer/editors/git-tree/GitChangesView.ts`: `gridProps()` uses the displayed `label` to generate the grid's `name` (`git-changes-${label.toLowerCase()}`); `FileGridItem.filePath` is used as a `Map` key and also shown as the row title. | Grid names are stable `data-name`/automation identity; paths are git/file data. | Derive stable names from `listKind` (`unstaged`/`staged`) and translate only the heading. Keep map lookup keyed by `change.path`; leave displayed path/title as data and keep the Git status code (`M`, `A`, `D`, `R`, `C`, `U`, `?`) raw.
| `src/renderer/editors/git-tree/GitPanelSecondaryView.ts`: segment `value`s `changes`, `branches`, `tags` are stored as `GitTreeEditorState.gitPanelTab`. `src/renderer/editors/git-tree/GitTreeEditorView.ts`: bottom-tab `value`s `commit` and `diff` are stored as `bottomPanelTab`. | Visible segment labels are backed by persisted enum values. | Translate labels only; preserve these values, comparisons, and serialization exactly.
| `src/renderer/editors/file-diff/FileDiffEditor.ts` and `src/renderer/editors/file-diff/RevisionPickerView.ts`: `RevSel.kind` values (`unstaged`, `staged`, `head`, `commit`) control revision selection, the diff side and generated selection keys; commit refs/hashes accompany commit values. | The picker button renders a name derived from the same selection model. | Keep selection kinds and keys English/stable; render translated labels for `unstaged`/`staged`, `untranslated("HEAD")` for the Git ref, and the short hash as data. Do not compare selection state to the translated label.
| `src/renderer/editors/git-tree/CommitDiffPanel.ts`, `GitChangesView.ts`, `GitRefsView.ts`, and shared `src/renderer/components/git-tree/GitTreeView.ts`: file paths, full/short hashes, ref names, author/subject/date, status codes and Git command results feed rows, lookups, selections or callbacks. | Many are displayed, but they are file/Git data; branch/tag names and commit values also drive selection and actions. | Keep paths, hashes, refs, commit text/author/date, status codes, and command output unmodified. Translate only fixed captions/actions around them. Never translate map keys, `GitRefNode.value`, `GitCommitRow.hash`, or callback arguments.
| Context menus in `GitTreeEditorModel.onGetMenuItems()`, `GitChangesView.gridProps()`, `GitRefsView.getContextMenu()`, `GitTreeEditorView.pullProps()` / `getContextMenuItems()`, and `CommitDiffPanel` currently create label-only items. | Agents and automation must not identify an action by its localized label (D4); repeated ref actions can coexist in one menu. | Add stable `id`s to every converted item. Use kebab-case English IDs such as `open-git-root-folder`, `copy-remote-url`, `stage-files`, `unstage-files`, `reset-files`, `pull-merge`, `fetch-all`, `open-in-new-tab`, and `create-branch-here`. For per-ref actions, include a deterministic kebab-case ref-name suffix (and short hash for commit actions) so IDs remain unique in the menu; if two refs normalize to the same slug, add a deterministic suffix. Keep labels separate and translate them. Preserve existing `data-name` selectors and action values.

The agent-facing consumers were checked directly. `src/renderer/scripting/api-wrapper/GitTreeEditorFacade.ts` returns copied repo paths, refs, hashes, commit subjects/authors/dates, changed paths/statuses, and enum values; keep them as English data. `src/renderer/scripting/ai-vision/page-panels.ts` returns the active tab and Git snapshots and locates controls by their `data-name` values. Preserve the existing selector names `git-panel-tabs`, `git-changes-unstaged`, `git-changes-staged`, `git-commit`, `git-stage`, and `git-unstage`; the grid name must remain based on `listKind`, not a translated heading. `src/renderer/editors/register-editors.ts` already separates the `git-tree` editor ID from its `editors.gitTree` name key, and `GitTreeEditorFacade.name` stays English via `englishMessage("editors.gitTree")` (US-1654). Keep developer-facing facade/help descriptions English per D3. The new menu IDs are the handles for newly translated actions.

## Implementation Plan

### 1. Add the Git catalog area

- Add `src/shared/i18n/en/git.ts`, typed with `EnglishCatalogEntry` from `./common`.
- Register `gitCatalog` and `git: MessagesOf<typeof gitCatalog>` in `src/shared/i18n/en/index.ts` so keys are available as `git.<entry>` and generated `en-XA` includes them.
- Keep entries semantic and use notes where labels such as `From`, `Refs`, `Commit`, and `Reset` need context. Resolve messages lazily in view constructors/update/props methods.
- Reuse existing exact-context entries: `shell.git` for the Git panel/product label, `shell.archive` for Archive panel headings, `shell.fileHistory` for File History, `editors.gitTree` for the fixed English persisted default title, `menus.branches`, `menus.remotes`, `menus.tags`, `menus.commitColumn`, `menus.dateColumn`, and `menus.authorColumn` for shared Git tree/detail captions, `menus.failCreateBranch` and `menus.failCommit` for matching Git failure wrappers, `api.actionFailed` for the generic fixed `{action}: {error}` wrapper if used for the switch notification, and `dialogs.buttonCommit`, `dialogs.buttonReset`, and `dialogs.buttonCancel` for built-in dialog button labels where directly rendered. Use `common.cancel`, `common.open`, `common.remove`, or `common.loading` only where the wording/context is identical. Do not duplicate existing `menus.*` strings from US-1655.

Suggested new `git` keys cover the remaining unique copy: archive empty state and collapse action; compare exit; file-diff empty state, switch editor and revision labels; Git unavailable/history-loading states; commit-detail empty state and `Refs`; File History toolbar context only if `shell.fileHistory` does not fit; changes panel headings/actions/confirmations; branch/tag empty states and ref-switch action templates; Git history title/toolbar/sort/pull/push messages; repository menu actions; branch prompt and error wrapper; and change-count messages. Verify catalog keys by exact message and translator context before adding them.

### 2. Localize archive, compare, file diff, and Git panels

- `src/renderer/editors/archive/ArchiveEditorView.ts`: translate `No archive loaded.`, `Collapse All`, and `Refresh`. `src/renderer/editors/archive/ArchiveSecondaryView.ts`: translate the close-button title and use `shell.archive` for both panel-header title updates.
- `src/renderer/editors/compare/CompareEditor.ts`: translate `Exit Compare Mode`; keep both comparison labels as file path/page-title data.
- `src/renderer/editors/file-diff/FileDiffBodyView.ts`: translate the entire no-repository/unavailable sentence and `Switch to Text Editor`.
- `src/renderer/editors/file-diff/FileDiffToolbarView.ts`: translate `From`; retain the arrow as a symbol.
- `src/renderer/editors/file-diff/RevisionPickerView.ts`: map `unstaged` and `staged` to Git catalog labels inside `labelFor()`; retain `head` as the literal Git ref `HEAD`, marked `untranslated("HEAD")`; keep the commit short hash as data.
- `src/renderer/editors/file-diff/GitDiffRevisionsSecondaryView.ts`: translate unavailable text, refresh tooltip and synthetic endpoint row copy. Use `shell.fileHistory` for the panel heading on create and update. The panel is File History, with unstaged/staged endpoint rows.
- `src/renderer/editors/git-tree/CommitInfoPanel.ts`: translate the empty-selection sentence and fixed row captions; use `menus.authorColumn` / `menus.dateColumn` where context is identical. Commit messages, refs, author values, date, and hashes remain git output/data.
- `src/renderer/editors/git-tree/CommitDiffPanel.ts`: translate the empty-selection sentence and `Open in new Tab` menu label; add its item id. Paths, statuses, hashes and patch contents remain data.
- `src/renderer/editors/git-tree/GitChangesView.ts`: translate unavailable state, staged/unstaged headings, stage/unstage/reset selected tooltips, commit button, reset title/details, and context menu labels. Keep `listKind` as the stable heading/name discriminator. Reuse `dialogs.buttonCommit` for the Commit button where button context matches.
- `src/renderer/editors/git-tree/GitRefsView.ts`: translate unavailable and empty-state messages plus switch action templates; keep ref names and values as data, and add unique menu IDs.
- `src/renderer/editors/git-tree/GitPanelSecondaryView.ts`: translate the Changes/Branches/Tags visible segment labels (retain stored values), both sort-tooltip arms, refresh/close actions, and `Show Git Tree`. Use `untranslated(englishMessage("shell.git"))` for the product-name heading so Git stays English and the lint finding is explicit. Keep repo tag name/title as path/repository data.
- `src/renderer/editors/git-tree/GitTreeEditorView.ts`: translate refresh tooltips, `Repo:`, bottom segment labels and pull/push tooltips/actions; add IDs to pull/fetch and contextual switch/create actions. Keep ahead/behind numbers, branch/ref names, commit counts, hashes, and paths as data; localize surrounding text with placeholders.
- `src/renderer/editors/git-tree/GitTreeEditorModel.ts`: preserve the persisted English title as described in the identity section; add IDs and translated labels to its two page-menu items. Translate the create-branch dialog title/message and UI notification wrappers; reuse `menus.failCreateBranch` when message and meaning match.

### 3. Use CLDR counts and whole messages

Every count-bearing sentence/action gets a catalog plural object and `{count}` parameter; do not construct English plurals in the view. Candidate locations include:

- Stage/Unstage `{count} file(s)` and Reset `{count} file(s)` context-menu labels in `GitChangesView.gridProps()`.
- Reset confirmation for one/many files. Provide separate whole-message variants for tracked-only and untracked selections so the untracked warning is not spliced into a translated sentence.
- Pull `{count} commit(s)` and Push `{count} commit(s)` tooltips in `GitTreeEditorView`; remove the literal `(s)`.
- Keep the Git sidebar badge count (`Git ({fileCount})`) numeric and without an English count noun; no grammatical plural is needed there.

Before:

```ts
label: `${moveLabel} ${count} file${count > 1 ? "s" : ""}`
```

After:

```ts
label: t(listKind === "unstaged" ? "git.stageFiles" : "git.unstageFiles", { count })
```

Catalog messages use `{ one: "Stage {count} file", other: "Stage {count} files" }` (and corresponding Unstage/Reset forms), with any additional CLDR categories added where the language requires them. Confirmation messages are complete messages in each category, not concatenated title/detail fragments.

Keep complete sentences together with placeholders: the Git-unavailable notice, File Diff empty notice, Reset confirmation, branch-creation prompt, and translated fixed failure wrapper each get one catalog message. Interpolate paths, refs, hashes or runtime error strings only as named data placeholders.

### 4. Preserve English errors and data

E3: leave thrown exceptions in these scope files English. Specifically preserve `GitTreeEditorModel.ts` errors `Git revealRef unavailable: no page host attached.`, `Git revealRef unavailable: no repository is loaded.`, `Git revealRef unavailable: the Git Tree is not the page's main editor.`, `Git revealRef unavailable: no ${kind} ref named ${JSON.stringify(refName)}.`, `Git revealRef unavailable: Git is not available.`, `Git loadMore unavailable: no page host attached.`, and `Git loadMore unavailable: no repository is loaded.`; `GitTreeEditorView.ts` errors `Unhandled body message kind: ${exhaustive}`, `Unhandled body message signature kind: ${exhaustive}`, `Git Tree view received an invalid model.`, and `Git Tree view model identity cannot change while the view is mounted.`; `GitPanelSecondaryView.ts` error `Git panel model is unavailable.`; `FileDiffBodyView.ts` error `File Diff body received a different model instance.`; `FileDiffToolbarView.ts` error `File Diff toolbar received a different model instance.`; `file-diff/index.ts` errors `File Diff view received an invalid model.` and `File Diff view received a different model instance.`; `ArchiveEditor.ts` error `Archive action unavailable: no page host or archive loaded.`; and `ArchiveEditorView.ts` error `Archive view received an invalid model.` These are developer/script failures, not user-facing copy.

E5: preserve Git refs and branch/tag names; commit hashes, subjects/messages, authors and dates; repository/file paths; status codes; Git command output/error causes; ahead/behind numeric values; the `HEAD` ref; and product/protocol names `Git`, `MCP`, and `Persephone`. There are no keyboard-shortcut text literals in the current four folders; the arrows in revision headers are symbols and stay as-is. Board-owned text does not occur in this scope. Translate app-authored status/action words and fixed labels when they are shown, but never transform Git's data values.

### 5. Live `en-XA` verification paths

Each scope surface has a concrete UI route for the live pseudo-locale walk:

| Surface | Reach it in the app |
|---|---|
| Git Tree editor/history and Git panel (Changes / Branches / Tags) | In Explorer, open a repository's `.git` entry with **Open Git Tree** (documented in `src/renderer/editors/git-tree/GitTreeEditorModel.ts`). In the editor's Git secondary panel, visit Changes, Branches, and Tags; inspect commit and diff bottom tabs. |
| File Diff and File History panel | In Git > Changes, open a changed file to show File Diff. Visit its File History secondary panel and both revision selectors. Also inspect the no-repository empty state by opening File Diff for a file outside a Git repository. |
| Compare | Open two text files, group the second page with Ctrl-click on its tab, then choose **Compare**; inspect the exit control and both data labels. |
| Archive editor and Archive secondary panel | Open a recognized archive such as `.zip`, `.xlsx`, or `.docx` in Archive Editor. Inspect its toolbar/entry tree and reveal the Archive secondary panel. Use an empty/no-provider state if reachable from the archive-open flow. |

The same UI actions may be driven through Persephone MCP `script.execute` when available; these views do not expose a separate stable MCP path for opening them. Under `en-XA`, inspect all toolbar/tooltips, segmented labels, menu items, dialogs, empty states, detail captions, and history rows. Expect English only for the E5 data/product cases above and verify translated menu actions remain callable by their IDs.

### 6. Re-scan and validate the scope

- [x] Re-run scoped ESLint and filter the JSON output to `vanilla-view/no-hardcoded-ui-strings`: **0 reports** across all four scope folders. No deliberate hardcoded-UI reports remain.
- [x] Run `npm run lint`: exit 0, no errors; repository-wide lint emitted its existing warnings (344 total, including hardcoded-string warnings outside this task's folders).
- [x] Run `npm run typecheck`: exit 0.
- [x] Run `npm run build-prod`: exit 0; production build completed. The sandbox `spawn EPERM` fallback was not needed.
- [x] Skip `npm run i18n:check` per user instruction; the user will run it outside this sandbox.
- [ ] Perform the live `en-XA` screen walk in the table above; verify Git action IDs, persisted panel/tab selections, file-diff navigation, compare exit and archive entry navigation still work. This requires opening the app and remains for the user.

## Concerns

- **Persisted title:** `GitTreeEditorState.title` is both visible and persisted. Keep it English (`untranslated`) rather than allowing locale changes to contaminate stored page state.
- **Grid identity:** `GitChangesView.gridProps()` currently derives an identity/name from a display label. Split the two before translating to preserve data-name automation.
- **Menu IDs:** several dynamic ref menus can contain multiple similar actions. IDs need a deterministic ref/hash suffix for uniqueness within each menu and must not derive from translated labels.
- **Git output:** commit subjects, paths, refs, statuses and command failures can remain English under en-XA because they are data. The fixed UI wrapper around an error is translated; its error cause is interpolated unchanged.
- **Shared component boundary:** the component Git tree was converted in US-1655 and is outside this task's folder scope. Reuse its existing `menus.*` catalog keys; do not modify its behavior as part of this extraction.

## Acceptance Criteria

- [x] `src/shared/i18n/en/git.ts` is registered through `src/shared/i18n/en/index.ts`; all new keys use the supported flat `<area>.<entryName>` shape.
- [x] All 59 baseline lint reports and every verified/manual UI literal in the four scoped editor folders are either localized or explicitly marked with `untranslated()` when English must stay visible.
- [x] Counts use CLDR message objects; sentences and error wrappers are complete catalog messages with placeholders.
- [x] Every converted menu action has a unique, stable English `id`; no agent or callback behavior depends on a translated label.
- [x] Persisted titles, selection values, grid names, paths, refs, hashes, status codes and script/MCP data retain their English/data identity.
- [x] Thrown errors remain English; only user-facing wrapper text is localized.
- [x] Scoped lint reports zero `vanilla-view/no-hardcoded-ui-strings` findings; `npm run lint`, typecheck and build pass. `npm run i18n:check` is skipped in this sandbox per user instruction.
- [ ] Git Tree, File Diff/File History, Compare and Archive surfaces have been inspected live under `en-XA` by the listed routes.

Files investigated that need **no changes** for this task: `src/renderer/components/git-tree/**` (converted by US-1655; reuse its menu catalog keys), the thrown-error messages in `src/renderer/editors/git-tree/GitTreeEditorModel.ts` (remain English per E3), `src/renderer/editors/git-tree/git-tree-preferences.ts` (persisted numeric/layout preferences), `src/renderer/editors/register-editors.ts` (Git editor-name split already handled by US-1654), `src/renderer/scripting/api-wrapper/GitTreeEditorFacade.ts`, `src/renderer/scripting/ai-vision/page-panels.ts`, and script API type declarations (agent-facing identity/data already English), `src/renderer/editors/archive/ArchiveEditor.ts` apart from its English thrown errors, `src/renderer/editors/file-diff/FileDiffEditor.ts` selection/data values, `src/renderer/editors/file-diff/FileDiffBodyModel.ts` (diff data/model only), `src/renderer/editors/file-diff/index.ts` registration except English thrown errors, `src/renderer/editors/compare/index.ts`, `src/renderer/editors/archive/index.ts`, and localization runtime files other than the catalog registration.

## Files Changed Summary

| File | Planned change |
|---|---|
| `doc/tasks/US-1660-git-diff-strings/README.md` | This investigation and implementation plan. |
| `src/shared/i18n/en/git.ts` | New Git/diff/archive catalog area (58 keys). |
| `src/shared/i18n/en/index.ts` | Register and type the `git` catalog. |
| `src/renderer/editors/git-tree/GitChangesView.ts` | Localize changes panel copy, separate grid identity from translated heading, pluralize actions, add menu IDs. |
| `src/renderer/editors/git-tree/GitRefsView.ts` | Localize states and action labels; add stable ref action IDs. |
| `src/renderer/editors/git-tree/GitPanelSecondaryView.ts` | Localize Git panel labels/actions while retaining persisted segment values and title identity. |
| `src/renderer/editors/git-tree/GitTreeEditorModel.ts` | Preserve English persisted title; localize menu/dialog/notification copy and add menu IDs. |
| `src/renderer/editors/git-tree/GitTreeEditorView.ts` | Localize history/toolbar/bottom-panel text and plural tooltips; add menu IDs. |
| `src/renderer/editors/git-tree/CommitInfoPanel.ts` | Localize fixed empty state and detail captions. |
| `src/renderer/editors/git-tree/CommitDiffPanel.ts` | Localize empty state and context action; add stable action ID. |
| `src/renderer/editors/file-diff/FileDiffBodyView.ts` | Localize empty state and switch-editor action. |
| `src/renderer/editors/file-diff/FileDiffToolbarView.ts` | Localize the revision caption. |
| `src/renderer/editors/file-diff/RevisionPickerView.ts` | Localize staged/unstaged selection labels; retain HEAD/hash data. |
| `src/renderer/editors/file-diff/GitDiffRevisionsSecondaryView.ts` | Localize File History panel and synthetic endpoint labels. |
| `src/renderer/editors/compare/CompareEditor.ts` | Localize compare exit tooltip. |
| `src/renderer/editors/archive/ArchiveEditorView.ts` | Localize archive empty state and toolbar tooltips. |
| `src/renderer/editors/archive/ArchiveSecondaryView.ts` | Localize close tooltip and reuse Archive panel title. |
