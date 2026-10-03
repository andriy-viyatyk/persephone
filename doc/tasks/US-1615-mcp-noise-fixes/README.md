# US-1615: MCP noise and metadata fixes from the external evaluation

## Status

**Status:** In Progress
**Started:** 2026-10-03
**Priority:** Medium
**Epic:** none (standalone)

## Goal

Remove repeated or meaningless text that the MCP `call` tool sends to agents, and fill the small
documentation gaps an external evaluation found (report: `C:\test\pesephone-mcp-evaluation\persephone-mcp-review.md`,
findings B2, B3, B4, B5, B8, §6.1, §3.2). Every item below was verified against the source and the
running app on 2026-10-03.

## Background

| Finding | Verified cause |
|---|---|
| B2 — `guides` hint repeats one warning 8 times (~1.5k tokens) | `annotateEditorIdDiagnostics()` in `src/shared/guides/index.ts:246-271` attaches the same "Duplicate editorId" sentence to every claiming page; `collectDiagnostics()` in `src/main/mcp/ai-vision/guides.ts:173-177` concatenates all of them for the folder summary. The claims are not even a defect: installed boards write `editorId: "board"`, which is `BOARD_SELF_EDITOR_ID` (`src/shared/guides/mounted-source.ts:27`) — a per-board self token that many boards legitimately share. |
| B3 — `agents/browser` has title `"browser"`, empty summary | `assets/guides/agents/browser.md` has no front matter (every other agent guide has `title` / `audience` / `summary`, e.g. `assets/guides/agents/events.md`). |
| B4 — internal notes in `window.screen.$help` | `src/renderer/scripting/ai-vision/namespaces/window-screen.ts:40-47` cites `node_modules/ai-vision/dist/core/resolver.js:85-87`, US-1335 / US-1336 and `doc/architecture/browser-editor.md`. |
| B5 — "inline Log View dialog is unanswered" on every call | `collectLogViewAttention()` in `src/renderer/scripting/ai-vision/attention.ts:132-146` runs inside `collectAttention()` on every `call`. Modal dialogs (`dialogsState`) block the app and must keep repeating; inline Log View dialogs do not block anything. |
| B8 — `events.wait` timeout undocumented | The parameter exists (`namespaces/events.ts:26`, `wait(timeoutMs?)`); default 50 000 ms and clamp 110 000 ms (`events.ts:40-41, 72`) are not in the summary. The report's "can't be set" is wrong. |
| §6.1 — first `logView.push` usually fails | `SERVER_INSTRUCTIONS` in `src/main/mcp/manifest.ts:22` names the call but not an entry type; the evaluator's first push used `type: "markdown"` (real: `output.markdown`). |
| §3.2 — "two documentation systems" | They are one: every `persephone://guides/*` resource in `manifest.ts:46+` serves a file from `assets/guides/`, the same corpus as `guides.*`. Nothing says so. |

## Implementation plan

1. **B2 — guides diagnostics** (`src/shared/guides/index.ts`)
   - In `annotateEditorIdDiagnostics()`, skip `BOARD_SELF_EDITOR_ID` when collecting claims (import it
     from `./mounted-source`). Add a one-line comment: the token means "this page's own board", so
     sharing it is expected.
   - In `src/main/mcp/ai-vision/guides.ts` `formatDiagnostics()`, de-duplicate the folder's collected
     diagnostics (`[...new Set(...)]`) so a real duplicate between built-in pages is reported once.
   - Verify: `call guides` shows `guides["installed-boards"]` with no bracketed warning.
2. **B3 — browser guide front matter** (`assets/guides/agents/browser.md`)
   ```yaml
   ---
   title: "Browser automation — drive web pages and boards"
   audience: agent
   summary: "Snapshot, refs, clicks, typing, waits, screenshots, dialogs, and private-page limits for pages[i].editor and window.screen."
   ---
   ```
   Check the `audience` value against how the page is listed today (`both`) and the other agent
   guides; use `agent` unless the user guide index links to it.
3. **B4 — window.screen help** (`namespaces/window-screen.ts:40-47`): replace the paragraph with
   agent-facing facts only, e.g.:
   > summarize() returns only `{ kind: "WindowScreen" }`; it never exposes the active page's content,
   > title, URL, editor id, or privacy state. screenshot() may return undefined when its CDP session is
   > unavailable. Unavailable fields are omitted rather than returned as null. Snapshots never include
   > password or input values, may omit hidden frame subtrees, and cover only the active page.
   Then grep every `$help`/`help:` text under `src/renderer/scripting/ai-vision/` and
   `src/main/mcp/ai-vision/` for `US-\d+`, `EPIC-\d+`, `doc/`, `node_modules/` and `.js:` and rewrite
   any other hits the same way (code comments are fine; only agent-visible strings matter).
4. **B5 — report each inline dialog once** (`attention.ts`)
   - Keep a module-level `Set<string>` of reported inline-dialog keys (`${page.id}:${entry.id}`) in
     `collectLogViewAttention()`; emit a section only for keys not yet in the set, then add them.
   - Prune keys whose dialog is answered or whose page is gone, so the set stays bounded.
   - Modal dialogs and popups are unchanged.
   - The renderer is shared by all MCP sessions; "once per renderer" is acceptable — `pages.logView.dialogResult(id)`
     and the events log (`[seq] The user answered a dialog`) remain the way to check later. State this
     in the comment.
5. **B8 — events.wait summary** (`namespaces/events.ts:26`): "Wait up to timeoutMs (default 50000,
   max 110000) for an event newer than this call's cursor; if pending is true, call events.wait() again."
6. **§6.1 and §3.2 — server instructions** (`src/main/mcp/manifest.ts`)
   - Line 22 → ``"Use `pages.logView.push(...)` for output, rich results, and questions, e.g. `push([{ type: \"output.markdown\", text: \"# Done\" }])`; entry types are listed in `guides[\"formats/ui-push\"]`."``
   - Last line: replace "The focused `persephone://guides/*` resources remain available as an alternative."
     with "The `persephone://guides/*` resources are the same files as `guides.*`."

## Concerns

- **B5 across sessions:** a second agent connecting later will not see an old inline dialog in the
  attention block. Acceptable: it is non-blocking and visible through `events` and `pages.logView`.
- **Out of scope (decided 2026-10-03):** B1 screenshots → US-1616 (ai-vision); B6 search → US-1617;
  B7 `page.grouped` getter (documented core pattern, breaking change); §5.1/§5.2 access tiers (design
  decision: browser automation is core, MCP is opt-in, private pages already blocked); §5.3 stale
  trusted boards in temp folders (user revokes them in Tools & Editors → Boards).

## Acceptance criteria

- [x] `call guides` shows no duplicate-editorId warning for installed boards.
- [x] `guides.agents` lists `agents/browser` with a real title and summary.
- [x] `window.screen.$help` contains no task IDs, doc paths, or node_modules paths; no other agent-visible help does.
- [x] After pushing one inline dialog, the "unanswered" notice appears on the next call only.
- [x] `events.wait` hint states the default and maximum timeout.
- [x] Server instructions carry a working `logView.push` example and say resources = `guides.*`.
- [x] `npm run typecheck`, `npm run lint`, `npm run build-prod` pass.

## Files changed

| File | Change |
|---|---|
| `src/shared/guides/index.ts` | Skip `BOARD_SELF_EDITOR_ID` in duplicate detection |
| `src/main/mcp/ai-vision/guides.ts` | De-duplicate folder diagnostics |
| `assets/guides/agents/browser.md` | Add front matter |
| `src/renderer/scripting/ai-vision/namespaces/window-screen.ts` | Agent-facing help text |
| `src/renderer/scripting/ai-vision/attention.ts` | Report inline Log View dialogs once |
| `src/renderer/scripting/ai-vision/namespaces/events.ts` | Document wait timeout |
| `src/main/mcp/manifest.ts` | push example; resources note |

No changes needed: `call-tools.ts`, `LogViewEditor.ts`, `board-guide-mounts.ts`, `mounted-source.ts`.
