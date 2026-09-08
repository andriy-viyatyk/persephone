# EPIC-098: The todo board exposes its model

## Status

**Status:** Completed
**Created:** 2026-09-08
**Completed:** 2026-09-08

Epic 3 of 3 in the [AiVision library roadmap](../ai-vision-library-roadmap.md). It depends on
[EPIC-096](EPIC-096.md) (`ai-vision` published) and [EPIC-097](EPIC-097.md) (Persephone adopts the
library and mounts remote trees at `pages[i].editor.app`).

**Where the work happens:** `C:\projects\persephone-boards\boards\todo`, in the
`persephone-boards` repository. This document records the Persephone-side gate run and the
decisions; the code change is a board change.

## Overview

`persephone-boards/boards/todo` is a former built-in editor rebuilt as a content-host board. Today
an agent can only drive it as accessibility-snapshot text plus opaque refs — right for a web page,
wrong for an editor Persephone used to ship itself. EPIC-097 gave a board the ability to publish a
descriptor tree; this epic is the first real board to use it, and is deliberately the roadmap's
final test: if a weak agent can drive the todo board through `.app` alone, the pattern is ready for
the other built-in editors planned to move to boards.

It is also the reference example other migrated editors will copy, so the *descriptor prose* —
summaries, signatures, cautions, `$help` — is as much of the deliverable as the wiring.

## Goals

- `pages[i].editor.app` on a todo page resolves to a `TodoApp` node with lists, tags, items,
  the three selection properties, and the thirteen actions the board already implements.
- The board's seven curated controls are addressable by name in both frames, so `highlight` can
  point the user at them.
- The board's own `CLAUDE.md` documents the surface (and stops claiming `editorPriority: 0`),
  `WHATS-NEW.md` records the change, and the manifest is bumped so publishing is a push away.
- The roadmap gate passes, twice: mechanically over `call`, and by a weak agent with no
  instructions beyond the `call` tool description.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1394 | Expose the todo board's model through `persephone.aiVision.expose` | Done |
| US-1395 | Run the roadmap gate: mechanical verification and the weak-agent test | Done |

## Scope in detail

### US-1394 — The exposed surface

The roadmap's table, mapped onto the board's existing functions:

| Node / member | Backing code in `app.js` |
|---|---|
| `lists` (node, indexable), `addList`, `renameList`, `deleteList` | `data.lists`, `addList`, `renameList`, `deleteListCore` |
| `tags` (node, indexable), `addTag`, `renameTag`, `setTagColor`, `deleteTag` | `data.tags`, `addTag`, `renameTag`, `setTagColor`, `deleteTagCore` |
| `items` (node, indexable, filtered), `addItem`, `toggleItem`, `setItemTitle`, `setItemComment`, `setItemTag`, `deleteItem` | `filteredItems`, `addItem`, `toggleItem`, `updateItemTitle`, `setItemComment`, `setItemTag`, `deleteItemCore` |
| `selectedList`, `selectedTag`, `searchText` (writable) | `setSelectedList`, `setSelectedTag`, `setSearchText` over `persephone.state` |
| elements `quick-add-input`, `search`, `list-switch` (main); `add-list`, `add-tag`, `lists`, `tags` (view `lists`) | `data-name` on the controls in `index.html` |

Rendering, persistence (`persephone.host.*`) and the `persephone.state` wiring are untouched. The
board is content-host, so an agent could already edit the `.todo.json` text through `page.content`;
the structured surface exists so it does not have to.

### US-1395 — The gate

Two halves, both recorded in `qa/runs/2026-09-08-epic-098-todo-app.md`:

1. **Mechanical.** Open a `.todo.json` with the board, then verify every member, both frames'
   elements, `$help`, and `helpSearch` over `call`.
2. **Weak agent.** One subagent on a small model, given only the `call` tool description and a
   task in the user's words, told no paths. It must reach the answer through `.app` and the hints
   alone, never falling back to `snapshot()` or `evaluate()`. Up to three iterations; each
   iteration's failure and the descriptor text that fixed it is the evidence the roadmap wanted.

## Design decisions

**1. Agent-facing deletes skip the in-board confirmation.** `deleteItem`, `deleteList` and
`deleteTag` each open an in-board confirm overlay, which is right for a click and wrong for a
method call — an agent's invocation would simply hang until the host timeout. Each is therefore
split into a `*Core` mutation and a UI wrapper that confirms first; the exposed method calls the
core and carries a `caution` saying the deletion is immediate and has no undo. The agent already
made the decision by naming the method.

**2. `addItem(title, list?)` gains the optional list argument.** The UI's `addItem(title)` adds to
`selectedList` and is disabled until a list is chosen, which is the right affordance for a person
and a trap for an agent, whose first call would silently do nothing. The exposed form takes an
explicit list name, defaults to `selectedList`, and throws a message naming `addList` when the list
does not exist. The UI path keeps its exact behaviour by passing one argument.

**3. An unknown tag name is created rather than refused.** `setItemTag(id, "errand")` with no
`errand` tag adds it to the tag list. This is not leniency invented for the agent: the file format
already normalizes orphan tags on load (a tag referenced by an item but missing from `tags` is
appended), so refusing would be stricter than the format itself.

**4. The three selection properties validate on write.** A remote writable assignment is
fire-and-forget — a setter that throws is reported through `onWarning` and otherwise only becomes
visible on a later read. Setting `selectedList` to a name that does not exist is therefore refused
and left unapplied, so the read-back tells the agent what happened; the member summaries say to
take the name from `lists`.

**5. The shape is refreshed when a collection stops being empty.** `expose()` probes `index(0)` once
to derive the shape of an indexed item, so a board that registers before its file has loaded — which
this one does, because `load()` is async — publishes `lists`, `tags` and `items` with no item shape,
and `items[0]` would not resolve. The board therefore tracks which of the three collections are
non-empty and calls the remote's `refresh()` when that changes. Rare (only on the empty↔non-empty
transitions) and cheap. It is the one non-obvious thing a board author copying this example needs
to know, so it is commented in place and written up in the board's `CLAUDE.md`.

**6. Two host defects were fixed here, not deferred.** The board is the proving board, so what it
finds in Persephone is this epic's work (see "Host fixes" below).

## Relationship to the "Publish the todo board" backlog item

[tasks/backlog.md](../tasks/backlog.md) carries a "Publish the todo board" item — the todo board is
the last of the persephone-boards set that has never been published to the catalog. This epic bumps
`board-manifest.json` to `1.1.0` and `minAppVersion` to `5.0.1` and writes the `WHATS-NEW.md` entry,
which is exactly what publishing needs, but **does not push** `persephone-boards`: publication is
triggered by a version bump reaching `main`, and that is the user's decision. The backlog item stays
open and this epic is its precondition, not its replacement.

## Host fixes found by the proving board

Both shipped green under EPIC-097 against a synthetic scratch board and failed against the first
real one. Both are in the Persephone repository, on `upcoming-v5.0.1`.

**H1. `remote.refresh()` was indistinguishable from a new registration.** `expose()` probes
`index(0)` once to derive an indexed item's shape, so a board that registers before its async load
publishes empty collections and must call `refresh()` when the first item appears (decision 5).
On the host, `BoardWebview.handleAiVisionRegistration` rejected every in-flight leaf request on any
registration, and `BoardEditorFacade.sendAiVision` refused any request whose registration token had
moved — correct for a reload, wrong for a refresh, and the request it killed was invariably the very
call that triggered the refresh. So the first mutation on any empty board reported a failure it had
in fact completed.
`BoardAiVisionRegistrationMsg` now carries `reason: "register" | "refresh"` (absent ⇒ `"register"`,
so an older shim still reads correctly); the shim tags `refresh()`; and the stored registration
separates `token` (bumped always — the proxy-cache key, because a refresh means the shape really did
change) from `incarnation` (bumped only for a new remote — what an in-flight request is validated
against). Files: `src/ipc/board-bridge-channels.ts`, `src/board-shim.ts`,
`src/renderer/editors/board/BoardEditorModel.ts`, `src/renderer/editors/board/BoardWebview.ts`,
`src/renderer/scripting/api-wrapper/BoardEditorFacade.ts`.

**H2. `board://` served documents with no charset.** `Content-Type: text/html` left the encoding to
the document's `<meta charset>`, which the injected head fragment (theme style + boot + the ~100 kB
shim) pushes well past the 1024-byte sniffing window — so every board document was decoded as
windows-1252 and every non-ASCII character *in the shim* reached the agent mojibaked (the
`highlight` caution's em dash read `â€”`). `boardContentType()` in
`src/main/board-protocol-service.ts` now appends `; charset=utf-8` to every text MIME type the
protocol serves. This affects every board, not only AiVision.

## Gate

The roadmap's gate: an agent session that, from a bare `call`, finds the todo page, reads its lists,
adds an item to a named list, tags it, toggles it, highlights the quick-add input, and does all of
it through `.app` without falling back to `snapshot()`.

## Gate results (2026-09-08) — PASS

Full record: [qa/runs/2026-09-08-epic-098-todo-app.md](../../qa/runs/2026-09-08-epic-098-todo-app.md).

**Mechanical half:** `.app` resolves and describes itself; `items` / `lists` / `tags` index by
position and by key; the three writable properties round-trip and refuse an unknown name; all
thirteen methods work and their validation errors name the fix; `elements` reports all seven
controls and `highlight` draws in the main frame and inside `board-secondary:lists`; reload
re-registers. `npx tsc --noEmit` and `npm run lint` clean.

**Weak-agent half: passed on iteration 1 of a budget of 3.** One `mcp-test-agent-call` subagent on
haiku, one tool, no paths given, told to ignore every project file. It reached the goal in **14
calls** with no dead ends and **never called `snapshot()` or `evaluate()`**: overview → `pages` →
`page` → `page.editor` → `.app` → `lists` → `addList` → `addItem` → `tags` → `addTag` →
`setItemTag` → `toggleItem` → `elements` → `highlight`. Its own verdict was "no missing hints".

**One wording defect, fixed before the weak-agent run.** `helpSearch("add a todo item")` did not
return `addItem`: the library's `matches()` requires every query token as a substring, so a summary
reading "Add an item and return its id" cannot match a query containing "todo". Six method summaries
were rewritten in user words rather than API words ("Add a new **todo item** to a list…", "**Mark** a
todo item **done, or undo it**…"), after which `addItem` is the first hit. This is the transferable
lesson for every editor that copies this board: descriptor prose is search text, so write the words
a person would type.

## Notes

### 2026-09-08

- Epic opened.
- Implementation delegated to Codex against a written spec; the two host fixes and the descriptor
  wording changes were made directly, being defects and QA-judgement calls respectively.
- The roadmap's final gate passes, so the pattern is available to the other built-in editors
  planned to move to boards.
