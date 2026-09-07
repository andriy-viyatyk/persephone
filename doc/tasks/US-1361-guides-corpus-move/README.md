# US-1361 — Move the corpus into `assets/guides/` with front matter

## Goal

Move the complete user and agent guide corpus into `assets/guides/` with `git mv`, preserving
the prose and file history. Add the agreed front matter to every Markdown page, remove only the
old first-line breadcrumb from moved user pages, leave the JSON fixture intact, preserve both sides
of every user/agent overlap, and keep the old GitHub paths alive with two short stubs.

This task is documentation and path preparation only. It does not implement the shared guide index,
the `guides` node, the About-page browser, layout schemas, or the final `docs/` deletion.

## Background

EPIC-092 decision 3 requires a move rather than a copy so `git log --follow` retains the corpus
history. Decision 4 permits exactly two kinds of content change in a moved page: the new front-matter
block at the top and deletion of the existing first-line breadcrumb such as
`[← Home](./index.md)`. Do not reword prose, merge duplicate pages, split `docs/editors.md`, or
change the JSON fixture. Splitting the editor catalogue is EPIC-094.

The roadmap's page sketch is incomplete relative to this checkout. The actual inventory is 15 root
Markdown files, 16 API Markdown files, `docs/examples/greek-gods.fg.json`, and 12
`assets/mcp-res-*.md` files. The sketch does not name the user topic pages for Grid, Notebook,
Browser, Boards, Agent Tools, Mneme, and MCP setup, nor the `mcp-res-ui.md` and
`mcp-res-ui-editors.md` resources. The mapping below resolves every one explicitly. The sketch's
`scripting/api/…` is treated as covering all 16 API files, whose exact rows are also listed.

### Front matter contract

Every moved Markdown page gets this shape, with the values from the mapping table:

```yaml
---
title: "..."
audience: user | agent | both
summary: "One line"
editorId: "..." # only where the table specifies one
---
```

`editorId` is omitted for catalogues, API/reference pages, and pages spanning multiple editor IDs.
The IDs were checked against `src/renderer/editors/register-editors.ts:132-180`: `browser-view`,
`graph-view`, `link-view`, `log-view`, and `notebook-view` are real registrations. The Grid guide
covers both `grid-json` and `grid-csv`, so it deliberately has no singular `editorId`; do not invent
a value that would imply the page belongs to only one variant.

Audience follows EPIC-092 decision 5: installation/setup and getting-started material is `user`,
screen and application features are `both`, all pages under `agents/` are `agent`, all pages under
`formats/` are `agent`, and the API reference is `user` per decision 7.

### Complete source → target mapping

The target paths are final for this task. An implementer must not choose another destination or merge
two rows. Summaries for the twelve former MCP resources are copied verbatim from
`src/main/mcp/manifest.ts:43-114`.

| Source | Target | `title` | `audience` | `summary` | `editorId` |
|---|---|---|---|---|---|
| `docs/index.md` | `assets/guides/index.md` | `Persephone User Guide` | `user` | A powerful notepad for developers, built with Monaco Editor. | — |
| `docs/getting-started.md` | `assets/guides/getting-started.md` | `Getting Started` | `user` | Installation and first steps for Persephone. | — |
| `docs/whats-new.md` | `assets/guides/whats-new.md` | `What's New` | `both` | Release notes and changelog for Persephone (formerly js-notepad). | — |
| `docs/tabs-and-navigation.md` | `assets/guides/tabs-and-navigation.md` | `Tabs & Navigation` | `both` | Tab management, the sidebar, navigation, and session restore. | — |
| `docs/shortcuts.md` | `assets/guides/shortcuts.md` | `Keyboard Shortcuts` | `both` | Global and editor-specific keyboard shortcuts. | — |
| `docs/encryption.md` | `assets/guides/encryption.md` | `File Encryption` | `both` | Password-based AES-256-GCM encryption and decryption for text files. | — |
| `docs/editors.md` | `assets/guides/editors/index.md` | `Editors` | `both` | An overview of Persephone's editors and the file types and features they support. | — |
| `docs/grid-editor.md` | `assets/guides/editors/grid.md` | `Grid Editor` | `both` | Spreadsheet-like viewing and editing of structured JSON and CSV data. | — |
| `docs/notebook.md` | `assets/guides/editors/notebook.md` | `Notebook Editor` | `both` | Structured notes in `.note.json` files with code, categories, tags, and full-text search. | `notebook-view` |
| `docs/browser.md` | `assets/guides/editors/browser.md` | `Browser` | `both` | A built-in web browser for documentation, APIs, and web resources. | `browser-view` |
| `docs/scripting.md` | `assets/guides/scripting/index.md` | `Scripting` | `both` | JavaScript and TypeScript execution for transforming and processing content. | — |
| `docs/agent-tools.md` | `assets/guides/agent-tools.md` | `Agent Tools` | `both` | The Agent Tools registry is Persephone's executable memory for reusable, parameterized tools. | — |
| `docs/boards.md` | `assets/guides/boards.md` | `Boards` | `both` | Custom HTML-page applications hosted by Persephone and backed by local scripts. | — |
| `docs/mneme.md` | `assets/guides/mneme.md` | `Mneme — Knowledge Base` | `both` | An optional local knowledge base for full-text and semantic search over Markdown documents. | — |
| `docs/mcp-setup.md` | `assets/guides/mcp-setup.md` | `MCP Server Setup` | `user` | Enable and connect to Persephone's built-in Model Context Protocol server. | — |
| `docs/api/ai.md` | `assets/guides/scripting/api/ai.md` | `ai — AI Model Integrations` | `user` | AI model helpers for scripts, including multi-turn Claude sessions. | — |
| `docs/api/app.md` | `assets/guides/scripting/api/app.md` | `app` | `user` | The root application object and entry point to app functionality in scripts. | — |
| `docs/api/downloads.md` | `assets/guides/scripting/api/downloads.md` | `app.downloads` | `user` | Global download tracking synchronized from the main process. | — |
| `docs/api/editors.md` | `assets/guides/scripting/api/editors.md` | `app.editors` | `user` | The read-only registry for querying editors and resolving an editor for a file. | — |
| `docs/api/events.md` | `assets/guides/scripting/api/events.md` | `app.events` | `user` | Application event channels for scripting integration. | — |
| `docs/api/fs.md` | `assets/guides/scripting/api/fs.md` | `app.fs` | `user` | File-system operations, dialogs, and OS integration. | — |
| `docs/api/index.md` | `assets/guides/scripting/api/index.md` | `Scripting API Reference` | `user` | The `page`, `app`, `ui`, `io`, and `ai` globals and their scripting helpers. | — |
| `docs/api/io.md` | `assets/guides/scripting/api/io.md` | `io` | `user` | The content-pipe builder for files, HTTP URLs, and archives. | — |
| `docs/api/page.md` | `assets/guides/scripting/api/page.md` | `Page API` | `user` | The active tab and its editor and editor-switching APIs. | — |
| `docs/api/pages.md` | `assets/guides/scripting/api/pages.md` | `app.pages` | `user` | Manage open pages and tabs in the current window. | — |
| `docs/api/recent.md` | `assets/guides/scripting/api/recent.md` | `app.recent` | `user` | Access and manage recently opened files. | — |
| `docs/api/settings.md` | `assets/guides/scripting/api/settings.md` | `app.settings` | `user` | Read and write application configuration with change notifications. | — |
| `docs/api/shell.md` | `assets/guides/scripting/api/shell.md` | `app.shell` | `user` | OS integration for URLs, encryption, and version information. | — |
| `docs/api/ui.md` | `assets/guides/scripting/api/ui.md` | `app.ui` | `user` | Dialogs, toast notifications, progress indicators, and window highlights. | — |
| `docs/api/ui-log.md` | `assets/guides/scripting/api/ui-log.md` | `ui (Log View)` | `user` | The lazy-initialized Log View logging and interactive-dialog API. | — |
| `docs/api/window.md` | `assets/guides/scripting/api/window.md` | `app.window` | `user` | Minimize, maximize, zoom, and multi-window management. | — |
| `docs/examples/greek-gods.fg.json` | `assets/guides/examples/greek-gods.fg.json` | — | — | Sample force-graph data fixture; no front matter is added to JSON. | — |
| `assets/mcp-res-overview.md` | `assets/guides/agents/index.md` | `Persephone Overview — start here` | `agent` | Persephone's mental model: windows, pages, editors, boards, and the call-based object model. Start here when the application is unfamiliar. | — |
| `assets/mcp-res-ui-push.md` | `assets/guides/formats/ui-push.md` | `pages.logView.push — Log View Output Channel` | `agent` | Log View reference: messages, dialogs, entry types, and examples for pages.logView.push and the script ui object. | `log-view` |
| `assets/mcp-res-pages.md` | `assets/guides/agents/pages.md` | `Pages & Windows` | `agent` | Pages and windows reference: page properties, editor types, creating pages, and multi-window object-model paths. | — |
| `assets/mcp-res-scripting.md` | `assets/guides/agents/scripting.md` | `Scripting API — script.execute` | `agent` | Scripting API reference: app objects, editor facades, TypeScript, and Node.js access for script.execute. | — |
| `assets/mcp-res-graph.md` | `assets/guides/formats/graph.md` | `Force-Graph Editor — Data Format & Scripting API` | `agent` | Force-graph editor reference: JSON data format, editor paths, editing graph data, and grouping nodes. | `graph-view` |
| `assets/mcp-res-notebook.md` | `assets/guides/formats/notebook.md` | `Notebook Editor Format (notebook-view)` | `agent` | Notebook editor reference: NoteItem JSON format and text, markdown, code, mermaid, and grid content types. | `notebook-view` |
| `assets/mcp-res-links.md` | `assets/guides/formats/links.md` | `Links Editor Format (link-view)` | `agent` | Links editor reference: LinkItem JSON format, categories, and tags. | `link-view` |
| `assets/mcp-res-boards.md` | `assets/guides/agents/boards.md` | `Boards — build a custom board/editor for the user` | `agent` | Boards authoring reference: board lifecycle, the execute channel, theme contract, local vendoring, and automation. | — |
| `assets/mcp-res-tools.md` | `assets/guides/agents/tools.md` | `Agent Tools — reuse parameterized tools instead of re-writing scripts` | `agent` | Agent Tools registry reference: discovery and execution paths, the stdin JSON/result-marker contract, environment secrets, and self-repair. | — |
| `assets/mcp-res-ui.md` | `assets/guides/agents/ui.md` | `Persephone UI Guide — explaining the app to its user` | `agent` | Persephone UI reference: the application chrome, stable selectors, and highlighting an element for the user. | — |
| `assets/mcp-res-ui-editors.md` | `assets/guides/agents/ui-editors.md` | `Persephone Editors — the catalog, for explaining them to the user` | `agent` | Editor catalog: what each Persephone editor is for, how to open it, and what it can do. | — |
| `assets/mcp-res-browser.md` | `assets/guides/agents/browser.md` | `Browser automation through call` | `agent` | Browser automation reference: page targeting, snapshots, ref lifecycle, waiting, profiles, boards, and the app window. | `browser-view` |

The `editors/` and `scripting/` folders contain real multi-page topics; the other user topic pages
remain flat at the guide root so a node lookup returns the page directly. In particular, the
following pairs
must remain separate: `editors/notebook.md` vs `formats/notebook.md`, `editors/browser.md` vs
`agents/browser.md`, `scripting/index.md` vs `agents/scripting.md`, `editors/index.md` vs
`agents/ui-editors.md`, `agent-tools.md` vs `agents/tools.md`, and `boards.md` vs
`agents/boards.md`. `docs/api/editors.md` and every other API row likewise remain separate pages.

### Docs stubs

After the moves, recreate only these two old paths as new short stubs; do not leave copies of the
corpus behind:

`docs/index.md`:

```markdown
# Persephone User Guide

The canonical guide corpus is now in [`assets/guides/`](../assets/guides/index.md).
```

`docs/api/index.md`:

```markdown
# Scripting API Reference

The canonical API reference is now in [`assets/guides/scripting/api/`](../../assets/guides/scripting/api/index.md).
```

These are the only new prose files in this task. `docs/` remains until EPIC-095; it is not deleted
here.

## Implementation plan

1. Create the target directories and move every row in the mapping with `git mv`. Move
   `docs/examples/greek-gods.fg.json` as a fixture without front matter. Do not use copy/delete,
   do not split `docs/editors.md`, and do not touch any prose while moving.

2. Add one front-matter block to each moved Markdown page using the table exactly. Keep `summary` on
   one physical line. Remove the existing first-line breadcrumb from pages that have one; do not
   remove ordinary in-page links or reword any sentence. The API pages' existing breadcrumb lines
   are also removed as the same permitted breadcrumb deletion.

3. Repair only relative Markdown hrefs made invalid by the new directory depth. Preserve link text,
   anchors, and prose. Use the mapping as the source of truth: for example, links from
   `editors/index.md` to the scripting API become `../scripting/api/page.md`, links from
   `scripting/index.md` to API pages remain `./api/...`, links from API pages to the scripting index
   become `../index.md`, and links from API pages to a flat user topic become `../../<topic>.md`.
   Update root and topic-page links against the final mapping (for example, a root link to
   `./boards.md` remains `./boards.md`, while a link from `editors/index.md` becomes
   `../boards.md`). Do not change external links or `assets/board-template`'s external av-grid
   links.

4. Recreate the two exact stubs above. Check that all old corpus files except those stubs are gone,
   and that every local Markdown link resolves in the new tree. The fixture link is the one at
   `assets/guides/editors/index.md:403`, formerly `docs/editors.md:403`; replace its href with
   `../examples/greek-gods.fg.json`. `assets/mcp-res-graph.md` has no fixture link and must not be
   described as owning one.

5. Update the live in-repo pointers below. These are path-only replacements; do not rewrite the
   guides or broaden EPIC-095 work.

   - `README.md:17,29,35,36,72,78-83`: replace `docs/mcp-setup.md` with
     `assets/guides/mcp-setup.md`, `docs/boards.md` with `assets/guides/boards.md`,
     `docs/mneme.md` with `assets/guides/mneme.md`, `docs/scripting.md` with
     `assets/guides/scripting/index.md`, `docs/index.md` with `assets/guides/index.md`, and
     `docs/api/index.md` with `assets/guides/scripting/api/index.md`. The resulting Documentation
     block must be exactly:

     ```markdown
     * **[User Guide](assets/guides/index.md)** — Getting started, editors, keyboard shortcuts
     * **[MCP Setup](assets/guides/mcp-setup.md)** — Connect AI agents to Persephone
     * **[Boards Guide](assets/guides/boards.md)** — Custom viewers, editors, and mini apps
     * **[Mneme Guide](assets/guides/mneme.md)** — Vector memory / Markdown knowledge base for AI agents
     * **[Scripting Guide](assets/guides/scripting/index.md)** — Script execution, `page`/`app` API, autoload scripts
     * **[API Reference](assets/guides/scripting/api/index.md)** — `app.pages`, `app.fs`, `app.settings`, `app.ui`, `app.fetch`
     ```

   - `.agents/skills/userdoc/SKILL.md:5,11,15,19-45,52,54`: the file has a table, so make the
     minimum path-only update needed for `/userdoc` to read the moved corpus. Change the description,
     scope, heading, and table root from `/docs/` to `/assets/guides/`; map `editors.md` to
     `editors/index.md`, `grid-editor.md` to `editors/grid.md`, `notebook.md` to
     `editors/notebook.md`, `browser.md` to `editors/browser.md`, `scripting.md` to
     `scripting/index.md`, and `api/*` to `scripting/api/*`; change `docs/whats-new.md` to
     `assets/guides/whats-new.md`. Do not rewrite the skill's workflow or style sections; that is
     EPIC-095. `.claude/skills/userdoc/SKILL.md` is only a pointer to this canonical file and has no
     file table, so it needs no edit in this task.

   - `doc/standards/release-process.md:29,53`: replace `docs/whats-new.md` with
     `assets/guides/whats-new.md` in the heading sentence and replace `git add docs/whats-new.md`
     with `git add assets/guides/whats-new.md`. Apply the same two path replacements to the live
     duplicate `.claude/commands/release.md:16,40`.

   - `build/README.txt:11`: replace
     `Documentation:  https://github.com/andriy-viyatyk/persephone/tree/main/docs` with
     `Documentation:  https://github.com/andriy-viyatyk/persephone/tree/main/assets/guides`.
     Replace the stale `resources\assets\mcp-res-*.md` list at `:28-39` with these final paths:

     ```text
         resources\assets\guides\agents\index.md       <- START HERE. The mental model plus a
                                                            task -> tool -> guide routing table.
         resources\assets\guides\agents\ui.md          <- The interface: visible elements and selectors.
         resources\assets\guides\agents\ui-editors.md  <- The editor catalog and how users open editors.
         resources\assets\guides\agents\pages.md      <- Pages, editor ids, and required languages.
         resources\assets\guides\agents\scripting.md  <- The scripting API (app, page, io, ai).
         resources\assets\guides\agents\boards.md     <- Boards: custom mini web-apps you build.

       Other pages under resources\assets\guides\agents\ and resources\assets\guides\formats\
       cover browser automation, Agent Tools, and the structured editor formats.
     ```

     Replace stale `read_guide` instructions at `:65-67` with: `Reconnect afterwards. Once
     connected, start with call("") and follow the guides paths; the same guides are available
     under resources\assets\guides if you are working offline.` This removes the already-retired
     tool name while keeping the installed README useful.

   - `assets/board-template/CLAUDE.md:724`: replace the exact URL
     `https://github.com/andriy-viyatyk/persephone/blob/main/docs/boards.md` with
     `https://github.com/andriy-viyatyk/persephone/blob/main/assets/guides/boards.md`.
     Leave the two `av-grid` URLs at `:626` and `:729` unchanged; they point to another repository.

   - `assets/script-library/autoload/register-all.ts:11`: replace the exact URL ending in
     `/docs/scripting.md` with
     `https://github.com/andriy-viyatyk/persephone/blob/main/assets/guides/scripting/index.md`.

   - `src/renderer/editors/about/AboutView.ts:261`: replace the external What's New URL ending in
     `/docs/whats-new.md` with
     `https://github.com/andriy-viyatyk/persephone/blob/main/assets/guides/whats-new.md`. EPIC-093
     later replaces this external link with the in-app guide route.

   - `doc/agents-common.md:144`: replace the exact Documentation Map row
     `| User documentation | [docs/index.md](../docs/index.md) |` with
     `| User documentation | [assets/guides/index.md](../assets/guides/index.md) |`. Leave
     `doc/agents-common.md:97` unchanged; its `/docs/` wording is EPIC-095-owned.

   - Update the live developer pointers that name the deleted MCP files:
     `doc/architecture/overview.md:216` should describe the aliases as pages under
     `assets/guides/agents/` and `assets/guides/formats/`; `doc/architecture/key-files.md:286,424,441`
     should point at `assets/guides/` (with the boards and tools rows pointing to
     `assets/guides/agents/boards.md` and `assets/guides/agents/tools.md`); and
     `doc/architecture/folder-structure.md:32-43` should show the new guide tree rather than
     twelve `assets/mcp-res-*.md` siblings. Update the path-only references in
     `.agents/skills/document/SKILL.md:66-124` to the mapped `assets/guides/agents/*`,
     `assets/guides/formats/*`, and `assets/guides/editors/index.md` pages so the skill remains
     operational. This is not a rewrite of that skill.

6. During this move, update the twelve `resourceFiles[].file` values in
   `src/main/mcp/manifest.ts:43-114` to the mapped paths, preserving every URI, `name`, and
   `description`. This is the recommended small exception to the “US-1363 owns resource aliases”
   boundary: `getAssetPath` already accepts subdirectories (`path.join(resourcesPath, ...paths)`),
   so the resource entries can point directly to `guides/...md` and the tree never has a broken
   resource state between US-1361 and US-1363. US-1363 still owns the final alias/full-resource
   behavior and any guide-node path validation. Do not change `readGuideFile` in this task.

7. Verify the move mechanically: inspect `git diff --find-renames`, confirm moved-file history with
   `git log --follow`, run `git diff --check`, grep for real remaining pointers to `docs/` and
   `mcp-res-` excluding `node_modules/`, `.git/`, `doc/tasks/`, `doc/epics/completed.md`, and the
   roadmap, and validate that only the intentional stubs, historical records, external URLs, and
   explicitly listed no-change references remain.

### Packaging confirmation

`electron-builder.yml:16-18` already contains:

```yaml
extraResources:
  - from: assets
    to: assets
```

Yes: electron-builder copies the `assets` directory recursively, so `assets/guides/**` is packaged
under `resources/assets/guides/**`. No packaging change is required for this subdirectory.

### References intentionally not changed in this task

- `CONTRIBUTING.md:164`, `doc/README.md:15`, and the `/docs/` wording at
  `doc/agents-common.md:97` remain valid while the two stubs and the `docs/` directory remain;
  EPIC-095 owns the final wording and deletion.
- Historical epic documents, completed-epic records, and QA run records retain historical paths;
  they are not live pointers. The requested grep excludes the roadmap and completed-epic file, and
  the implementation audit should classify the remaining historical references rather than rewrite
  them.
- External `av-grid` documentation URLs containing another project's `/docs/` path are unrelated.
- `src/main/mcp/manifest.ts` resource descriptions, names, and URIs are not changed; only the twelve
  `file` values are re-pointed as described above.
- No tests or test harnesses are added. No dashboard entry is added; the existing
  `doc/active-work.md:12` entry already links this task.

## Concerns / Open questions

1. **Relative links are the main move hazard.** Nested topic folders change the base directory for
   existing links. The implementer must update hrefs, not prose, and run a local-link audit. A link
   to `docs/boards.md` in a source file is not the same problem as a `./boards.md` link inside a
   moved page; use the final mapping in both cases.

2. **The roadmap count is stale.** This checkout verifies 15 root Markdown files and 16 API files,
   not the roadmap's “17 root” wording or EPIC-092's “17 API pages” wording. The table is based on
   the actual filesystem and must be treated as authoritative for US-1361.

3. **The Grid page spans two real editor IDs.** `grid-json` and `grid-csv` are both registered at
   `register-editors.ts:149-150`; no singular `editorId` is emitted. If the later guide index needs
   multi-editor associations, that is a schema decision for US-1362, not a reason to add a guessed
   value here.

4. **Resource loader security remains downstream work.** Nested paths work today, but
   `getAssetPath` is a general `path.join` helper and `readGuideFile` performs no containment check.
   US-1362/US-1363 must validate guide paths before accepting agent-supplied paths (`..`, absolute
   paths, and drive-qualified paths must not escape `assets/guides/`). Static manifest entries in
   this task do not introduce user-controlled input.

5. **The front matter is intentionally not a rewrite.** Summaries are new metadata, and breadcrumb
   deletion is explicitly allowed; all existing body wording, section order, examples, and fixture
   bytes must otherwise remain unchanged. Do not “correct” stale prose while moving it.

## Acceptance criteria

- [ ] Every row in the mapping exists at its exact target; every source corpus file is moved with
      `git mv`, with no duplicate corpus copy left under `docs/` or directly under `assets/`.
- [ ] All 31 moved Markdown pages plus all 12 former MCP pages have the three required front-matter
      fields (`title`, `audience`, `summary`); `editorId` appears on exactly the rows specified in
      the mapping and nowhere else.
- [ ] `docs/editors.md` remains one file at `assets/guides/editors/index.md`; no editor-page split
      or user/agent merge is performed.
- [ ] The JSON fixture is at `assets/guides/examples/greek-gods.fg.json` byte-for-byte unchanged,
      and `assets/guides/editors/index.md:403` points to it with
      `../examples/greek-gods.fg.json`; the graph guide is not treated as the fixture owner.
- [ ] Only front matter, permitted breadcrumb deletion, and path-only link repairs differ in moved
      Markdown bodies; no prose is reworded.
- [ ] `docs/index.md` and `docs/api/index.md` contain exactly the two short stubs specified above;
      no other old documentation file remains under `docs/`.
- [ ] README, both release-process copies, the canonical `/userdoc` table, build README, board
      template, autoload sample, About What's New URL, and live architecture/skill pointers resolve
      to the final target paths. The Claude userdoc pointer remains intact.
- [ ] All twelve `resourceFiles[].file` values point at the mapped nested guide paths, while URI,
      name, and description values are unchanged.
- [ ] `electron-builder.yml` is unchanged because its recursive `extraResources` block already
      covers `assets/guides/**`.
- [ ] `git diff --find-renames`, `git log --follow`, `git diff --check`, the local-link audit, and
      the scoped pointer grep all pass; no tests or commits are added by this task.

## Files Changed

| Category | Files |
|---|---|
| New task document | `doc/tasks/US-1361-guides-corpus-move/README.md` |
| Moved corpus | All 15 `docs/*.md`, all 16 `docs/api/*.md`, `docs/examples/greek-gods.fg.json`, and all 12 `assets/mcp-res-*.md`, exactly as mapped above |
| Recreated compatibility stubs | `docs/index.md`, `docs/api/index.md` |
| Live path/reference updates | `README.md`, `.agents/skills/userdoc/SKILL.md`, `doc/agents-common.md:144`, `doc/standards/release-process.md`, `.claude/commands/release.md`, `build/README.txt`, `assets/board-template/CLAUDE.md`, `assets/script-library/autoload/register-all.ts`, `src/renderer/editors/about/AboutView.ts`, `doc/architecture/overview.md`, `doc/architecture/key-files.md`, `doc/architecture/folder-structure.md`, `.agents/skills/document/SKILL.md`, and `src/main/mcp/manifest.ts` (`resourceFiles[].file` only) |
| No change | `.claude/skills/userdoc/SKILL.md`, `electron-builder.yml`, `CONTRIBUTING.md`, `doc/README.md`, `doc/agents-common.md:97`, historical epic/QA records, external av-grid URLs, and `doc/active-work.md` |
