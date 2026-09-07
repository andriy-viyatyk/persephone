---
name: document
description: Update developer documentation in /doc/ after code changes
model: sonnet
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# Developer Documentation Update

You are updating the developer documentation in `/doc/` to reflect recent code changes.

## Scope

This command covers **developer docs** (the `/doc/` folder) **and the Board documentation in `assets/`** (the board authoring guide + the Demo board — consumer-facing references for the AI agents that build boards). User-facing app docs in `/assets/guides/` are handled by the `/userdoc` skill separately.

## What to check and update

### 1. Architecture docs (`doc/architecture/`)

Read each file and compare against the current code:

| File | Covers |
|------|--------|
| `overview.md` | Application layers, process boundaries, key patterns |
| `folder-structure.md` | Directory structure and what goes where |
| `state-management.md` | State primitives, Object Model APIs |
| `scripting.md` | Script execution, wrappers, facades |
| `editors.md` | Editor registry, content-view pattern |
| `pages-architecture.md` | Page model, tab lifecycle |
| `browser-editor.md` | Browser-specific architecture |

For each doc:
- Check if new files/folders need to be mentioned
- Check if moved/deleted files need to be removed
- Check if new patterns or APIs need to be documented
- Check if diagrams in `doc/architecture/diagrams/` need updates

### 2. Standards docs (`doc/standards/`)

| File | Covers |
|------|--------|
| `coding-style.md` | TypeScript, naming, imports, styling conventions |
| `editor-guide.md` | How to add/modify editors |
| `component-guide.md` | UI component patterns |
| `model-view-pattern.md` | Model-View separation |

Check if new patterns were established that should be standardized.

### 3. Shared agent guidelines (`doc/agents-common.md`)

The shared project instructions live in
[`/doc/agents-common.md`](../../../doc/agents-common.md) — the root `CLAUDE.md` and
`AGENTS.md` are thin agent-specific wrappers around it and rarely need updating. Check the
shared document:
- **Key Files** — the full purpose→path index lives in
  [`/doc/architecture/key-files.md`](../../../doc/architecture/key-files.md), **not** in
  `doc/agents-common.md`. New, changed and deleted key files go **there**.
  `doc/agents-common.md` keeps only a short starting-point list; add a row to it only when a
  file is genuinely needed on most tasks. The split exists because the shared guidelines are
  loaded into every session and the full index was ~73% of them — do not let the big table
  creep back in.
- **Folder Structure** — Does the summary match reality?
- **Critical Patterns** — Any new patterns to document?
- **Documentation Map** — Any new docs to link?

### 4. Screen guides (`assets/guides/screens/*`, `assets/guides/editors/*`)

EPIC-094 replaced the two standalone agent guides this section used to describe. `agents/ui.md` and
`agents/ui-editors.md` are **deleted**; their content lives in `assets/guides/screens/` (the chrome,
one page per screen) and `assets/guides/editors/` (one page per editor, each declaring its
`editorId`). The `persephone://guides/ui` and `ui-editors` URIs still work and alias
`screens/index.md` and `editors/index.md`.

These pages serve **both** audiences — the user reads them in the About guide browser, the agent
reads the same text through `guides.<path>` — so there is no longer a condensation to keep in sync
with a user doc. There is one page, and it is authoritative.

They describe a moving target and nothing fails when they rot: an agent simply tells the user
something untrue. Check them whenever a change touched:

- **The app shell** — `src/renderer/ui/` (header strip, tab strip, Menu Bar, sidebar, secondary
  views). Verify every `data-name` the page names still resolves, and that new always-visible chrome
  is described.
- **The selector contract** — [`doc/architecture/ui-element-contract.md`](../../../doc/architecture/ui-element-contract.md).
  A `data-name` quoted in a guide is agent-facing API: renaming one is a documentation change, and
  the guide and the contract must be updated in the same commit.
- **The editor set** — `src/renderer/editors/register-editors.ts` (an editor added, removed or
  renamed) or `editor-matchers.ts` (which files open in which editor, which switch buttons appear).
  A new editor needs its own page under `editors/`, with an `editorId` — which is **unique across
  the corpus**, since `F1` and the guide pointer resolve through it.
- **A feature moving out of the app into a board** — `editors/index.md` carries the *"Things that
  are no longer built in"* note so an agent never promises a removed feature.

**Layout is now documented deliberately, and this is a reversal of the old rule here.** This
section used to say "keep both thin on layout, thick on purpose" and to prefer "opens the Menu Bar"
over "third button from the left". That advice was right when position was undocumented and would
only rot. It is now wrong: EPIC-094 exists because an agent asked *"where is the control that
filters rows?"* answered with a CSS class, which is what "thick on purpose, thin on layout"
produces. Every screen and editor page carries a `## Layout` schema and every `elements` entry a
`where` phrase, on purpose, and they must be kept correct rather than removed.

Purpose still comes first — a `purpose` says what a control is *for* and survives a refactor. But
position is now part of the contract, so when a screen changes, re-check its schema and phrases
rather than deleting them. `/userdoc` owns that step and describes the method
(`.agents/skills/userdoc/SKILL.md`); this skill's job is only to notice that a shell or registry
change makes it necessary.

The fastest verification is live, not by reading source. `call` is the only MCP tool, so:
`window.screen.snapshot()` for the shell, `pages[i].editor.elements` for a page's curated controls
(each entry carries `purpose`, `where`, `selector` and `visible`), and `ui.highlight(name)` or
`pages[i].editor.highlight(name)` to confirm a name still resolves — a name that highlights nothing
is the stale one.

### 5. Board documentation (`assets/` — consumer-facing)

Boards are built and debugged by AI agents, so their reference docs **are** documentation and must track changes to board functionality (the `persephone.*` bridge, the `--p-*` theme/token contract, the `board://` host, scaffolding, reload, MCP debugging). When board functionality changed, verify and update **both**:

| Doc | Covers | Update when… |
|-----|--------|--------------|
| `assets/board-template/CLAUDE.md` | The Board authoring guide — copied into every new board; the canonical reference a board-author agent reads. | The `persephone` bridge surface (`execute` handle, integration tier, theme/tokens), the `--p-*` contract list, `board-base.css`, the reload model, or the MCP debugging flow changes. |
| `assets/demo-board/` (`index.html`, `app.js`, `style.css`) | The living, self-documenting Demo board — Overview / Theming / Capabilities / Build Guide / Debugging tabs demonstrating the same surface. | A capability the demo showcases changes, or a new one should be demonstrated. Keep its Build Guide + Debugging prose accurate and refresh the live examples (buttons/probes) when the API changes. |
| `assets/guides/agents/boards.md` | The **agent-facing** boards guide served as the `guides.agents.boards` call path and the `persephone://guides/boards` resource — what a board is, the `execute_script` create→open lifecycle (`app.boards.createBoard`/`createDemoBoard` + `app.openRawLink`), develop & test. | The board lifecycle API (`app.boards`, `app.openRawLink`), the `persephone.*` bridge, the `--p-*` contract, or the `browser_*` testing flow changes. |

- `assets/demo-board/` is the **canonical** demo (edited directly; it is copied into a board on "Create Demo board") — there is no separate working copy to chase.
- `assets/board-base.css` is shared by both boards; if the shared defaults (page bg, scrollbar, monospace font) change, the authoring guide's note about it must match.
- **Reconcile drift across the three board docs each run.** They overlap on authoring content: `board-template/CLAUDE.md` is the canonical *authoring* reference; `agents/boards.md` is the condensed agent-facing copy **plus** the create/open lifecycle; `demo-board/` is the living example. Cross-check them for discrepancies and fix the drift — bring the condensed copy back in line with the canonical guide and the current API.
- These docs are **consumer-facing** — keep them **ticket-free** too (no `US-XXX` / `EPIC-XXX`), same rule as the architecture docs below.

## How to work

1. Use `git diff` or `git log` to understand what changed recently
2. Read each doc file that might be affected
3. Compare against actual source code
4. Make targeted edits — only change what's actually stale or missing
5. Do NOT rewrite docs that are already accurate

## Do NOT reference tasks or epics in architecture docs

Architecture and standards docs (`doc/architecture/`, `doc/standards/`, `doc/agents-common.md`)
describe the **current state of the system** — the architecture as it is now. They must
**not** cite the task or epic that produced a feature (`US-619`, `EPIC-031`, "added in
US-624", "pre-US-619 behavior", etc.).

- Describe **what the system does and why**, not **when/under-which-ticket it was added**.
  Reasoning and trade-offs are welcome; the ticket number that introduced them is not.
- When you add or edit content, write it ticket-free. When you touch a section that already
  carries a `US-XXX` / `EPIC-XXX` citation, strip the citation (keep the explanation).
- Never put a task/epic id in a heading.
- Task/epic tracking belongs in `doc/active-work.md`, `doc/epics/`, and `doc/tasks/` — not
  in the architecture record. (The `/review` and history in git already tie code to tickets.)

Keep prose out of table cells. A table cell holds a short identifying phrase; multi-sentence
behavior belongs in a prose paragraph under the table (linked from the cell if useful).

## Output

After making updates, provide a summary:
- Which docs were updated and why
- Which docs were checked and found to be current
- Any docs that need larger rewrites (flag for future task)

**Important:** Be precise. Only update what's actually wrong or missing. Do not add speculative content or over-document simple changes.
