# EPIC-125: Extract every UI string — interface languages, phase 2

## Status

**Status:** Active
**Created:** 2026-10-10

## Overview

Phase 2 of the [localization roadmap](../localization-roadmap.md). EPIC-124 built the translation
layer and converted the Settings page and the dialogs. This epic converts every remaining
app-owned UI string to the English catalog, area by area, and checks each area under the `en-XA`
pseudo-language. At the end the lint rule becomes an error, so new hardcoded text cannot land, and
Monaco's own widgets follow the language where Monaco ships a translation. Translated packs are
phase 4. This epic ships no new language. It makes one possible: once it closes, a pack can
translate the whole interface.

## Goals

- No app-owned interface text outside `src/shared/i18n/en/`: under `en-XA`, every screen reads as
  pseudo-text except data (file names, URLs, user content) and board-owned text (phase 3).
- Agents keep working in every language: the agent surface stays English (roadmap D3), and anything
  agents match on uses ids, never displayed text (D4).
- `vanilla-view/no-hardcoded-ui-strings` is an **error** with zero reports, and it covers every
  UI position the extraction found, not only the six properties it checks today.
- Monaco's find widget, command palette and context menu follow the language for the languages
  Monaco ships (D9).
- Layouts survive ~35% longer text: tabs, the pinned rail, sidebars, toolbars, dialogs.

## Decisions

Roadmap decisions D1–D16 stand (accepted 2026-10-09). This epic adds these. They are proposals for
the user to confirm or change:

- **E1 — Make the lint rule see everything first.** Before widening, the rule reported **892** literals
  in 196 files (measured 2026-10-10). After US-1653 widened the rule, it reports **975** literals in
  201 files (measured 2026-10-10). Before widening, it only checked `label`, `title`, `placeholder`,
  `tooltip`,
  `children`, `emptyText`, `textContent` / `title` / `placeholder` assignments,
  `createTextElement`, and `ui.notify` / `app.ui.notify` calls. A grep finds UI text it misses:
  `services.ui.notify(…)` and other receivers, `message:` (~28), `text:` (~18), `description:`
  (~16), `ariaLabel` / `aria-label` (~4), `emptyMessage` (~6), and editor display names
  (`register-editors.ts`, ~37 `name:` entries). US-1653 adds receiver-scoped toast/confirm/input
  checks, direct dialog `message` checks, `emptyMessage` and accessibility text positions, and the
  registry-only `name` check. It deliberately does not add global `message`, `text`, or `description`
  checks because those keys also carry data and agent-facing schemas.
- **E2 — Strings that are both UI and agent text are split, not shared.** Editor names
  (`register-editors.ts` `name`), the Tools hub and sidebar registries, and any MCP-visible
  description keep an English field for agents and get a catalog key for the UI, like
  `settings-catalog.ts` in US-1652 (`titleKey` beside English text, `englishMessage()` for the agent
  side). Each area task finds its own mixed files. `scripting/ai-vision/**` still matches by id.
- **E3 — Errors: the wrapper is translated, the cause is not.** Thrown `Error` messages stay English
  (D3; about 414 `throw new Error("…")` sites, read by logs, scripts and agents). Text the UI puts
  around them is translated: `t("browser.downloadFailed", { error: errMessage(e) })`.
- **E4 — One catalog area per task area.** Each task adds `src/shared/i18n/en/<area>.ts`
  (`shell`, `menus`, `browser`, `board`, `explorer`, `git`, `mneme`, `tools`, `editors`, …) and
  registers it in `en/index.ts`. Strings repeated across areas (`Copy`, `Open`, `Refresh`) go to
  `common`, and a task checks `common` before adding a duplicate.
- **E5 — What stays as it is.** Data (paths, URLs, user content, git refs, log payloads),
  language-neutral formats (D8), keyboard shortcut text (`Ctrl+S`; localizing `Ctrl` → `Strg` is
  out of scope), product and protocol names (`Persephone`, `MCP`, `Git`, `Tor`), and board-owned
  text (board names, board settings labels, board-shipped menu items: phase 3). Developer-only views
  that agents read stay English when the conventions doc says so.
- **E6 — Tasks run in order, one at a time.** The area tasks touch separate folders, but every one
  edits `en/index.ts` and may add to `common.ts`. Running them in sequence avoids the conflicts. They
  are independent, though, so the order below can change.
- **E7 — Verification is the same for every area task.** `npm run lint` shows zero
  `no-hardcoded-ui-strings` reports for the task's folders; `npm run i18n:check`, typecheck and
  build pass; under `en-XA`, a live snapshot of each screen in the area shows no plain English
  outside E5; agents still drive the area through MCP (ids and `data-name`, not labels).

## Current state (verified 2026-10-10; after US-1653 widening)

`no-hardcoded-ui-strings` reports, by area. Counts include only this rule; paths are bucketed relative
to `src/`, collapsing the leading `renderer/` for display and retaining the existing area labels:

| Area | Reports | Files |
|---|---|---|
| `editors/browser` | 103 | 15 |
| `ui/sidebar` | 66 | 11 |
| `editors/link-editor` | 61 | 10 |
| `components/tree-provider` | 57 | 7 |
| `editors/explorer` | 55 | 5 |
| `editors/mneme-config` | 51 | 4 |
| `editors/git-tree` | 45 | 7 |
| `editors/notebook` | 44 | 8 |
| `editors` | 43 | 1 |
| `editors/mcp-inspector` | 41 | 7 |
| `api` | 34 | 16 |
| `editors/tools-hub` | 30 | 4 |
| `editors/board` | 21 | 9 |
| `editors/about` | 21 | 4 |
| `editors/shared` | 20 | 4 |
| `editors/text` | 18 | 6 |
| `editors/storybook`, `content` | 16 each | 5 / 5 |
| `editors/board-info` | 16 | 2 |
| everything else (27 areas) | ≤ 14 each | — |
| **Total** | **975** | **201** |

Phase 1 leftovers, which belong to this epic: the uikit tree's `Collapse` / `Expand` aria-labels,
the browser-profile color names (`Dodger Blue`, …), and long Settings tree labels, which are
ellipsized under `en-XA`.

## Linked Tasks

Each task document is written when its task starts (investigation delegated to Codex, reviewed by
Claude), as in EPIC-124.

| Task | Title | Status |
|------|-------|--------|
| [US-1653](../tasks/US-1653-lint-coverage/README.md) | Widen the lint rule to every UI position; per-area baseline | Planned |
| [US-1654](../tasks/US-1654-shell-strings/README.md) | App shell, tabs, sidebar, editor display names | Planned |
| [US-1655](../tasks/US-1655-menu-strings/README.md) | Menus and context menus, tree providers, shared editor menus, file components | Planned |
| US-1656 | API layer, content pipeline, notifications outside editors | Planned |
| US-1657 | Browser editor (toolbar, downloads, profiles, Tor, context menu) | Planned |
| US-1658 | Board host: board editor, board info, env vars, toolsets, board context menu | Planned |
| US-1659 | Explorer and link editor | Planned |
| US-1660 | Git tree, file diff, compare, archive | Planned |
| US-1661 | Mneme editors and About | Planned |
| US-1662 | MCP inspector, Tools hub, Storybook | Planned |
| US-1663 | Remaining editors and uikit defaults | Planned |
| US-1664 | Monaco UI language (D9) | Planned |
| US-1665 | Layout fixes, lint rule to error, closing sweep | Planned |

### US-1653 — Lint coverage and baseline

- `no-hardcoded-ui-strings` now uses one receiver predicate for `ui.x`, `app.ui.x`, and
  `services.ui.x`; it reports arguments to `notify`, `confirm`, and `input`. It also checks `message`
  only on direct object literals passed to `show…Dialog` functions, adds `emptyMessage`, `ariaLabel`,
  and `"aria-label"` property keys, checks exact `setAttribute("aria-label" | "title" |
  "placeholder", value)` calls, and checks literal editor `name` values only in
  `src/renderer/editors/register-editors.ts`.
- Do not add generic `message`, `text`, or `description` property checks. No new finding landed in the
  excluded MCP/API declaration, MCP implementation, AI-vision, API-wrapper, or Settings catalog
  files. The registry names remain intentionally visible to the rule and are split under US-1654.
- The rule remains warning-level; `npm run lint` and `npm run typecheck` pass. The Current state table
  records 975 reports in 201 files, bucketed by the US-1653 per-area method.

### US-1654 — App shell, tabs, sidebar, editor names

- `ui/app`, `ui/tabs`, `ui/sidebar` (menu bar, pinned rail, tools/editors registry, open tabs, recent
  files), `editors/register-editors.ts` display names split per E2, `editors/category`.
- **Acceptance:** E7; the editor list over MCP still shows English names.

### US-1655 — Menus and tree providers

- `components/tree-provider` (item menus, CRUD and drop actions), `editors/shared` (editor menu
  items), `components/file-search`, `components/file-list`, `components/git-tree`,
  `components/pipe-status`. `src/board-context-menu.ts` moved to phase 3: it runs inside the board
  webview (bundled into `board-shim.ts`), which has no locale until D10's `persephone.locale`.
- Menu items keep their `id` (D4); only `label` moves to the catalog.
- **Acceptance:** E7; ai-vision still clicks the converted menu items by id.

### US-1656 — API layer, content pipeline, notifications

- `renderer/api/**` (outside the D3 folders), `renderer/content/**`, `renderer/scripting/**` UI
  text, `core/**`: notifications, confirmations and statuses raised from the API layer, with E3
  for error text.
- **Acceptance:** E7 for these folders; a script calling the API still gets English errors.

### US-1657 — Browser editor

- `editors/browser/**`: toolbar, URL bar, bookmarks, downloads popup, profiles (including the
  profile color names), Tor and proxy status, webview context menu, find bar.
- **Acceptance:** E7.

### US-1658 — Board host

- `editors/board`, `editors/board-info`, `editors/env-vars`, `editors/toolset`: host toolbar,
  status bar, trust dialog (its agent half stays English, as split in US-1648), board info,
  install and update flows. Board-owned text stays under E5.
- **Acceptance:** E7; trusting and installing a board through MCP still works.

### US-1659 — Explorer and link editor

- `editors/explorer`, `editors/link-editor`: panels, filters, clipboard history, link categories,
  editing forms, empty states.
- **Acceptance:** E7.

### US-1660 — Git and diff

- `editors/git-tree`, `editors/file-diff`, `editors/compare`, `editors/archive`: commit and branch
  panels, status names, diff headers, archive browser.
- Git status words shown to the user are translated; git refs, hashes and command output are data.
- **Acceptance:** E7.

### US-1661 — Mneme editors and About

- `editors/mneme-config`, `editors/mneme-root`, `editors/about` (`AboutView`,
  `AboutGuideBrowserView`). The guides themselves stay English (D3); the About page around them is
  translated.
- **Acceptance:** E7.

### US-1662 — MCP inspector, Tools hub, Storybook

- `editors/mcp-inspector`, `editors/tools-hub`, `editors/storybook`. Tool names, JSON schemas and
  server messages are data; the inspector's own UI is translated. Story content (`*.story.ts`) stays
  exempt.
- **Acceptance:** E7.

### US-1663 — Remaining editors and uikit defaults

- `editors/notebook`, `log-view`, `text`, `grid`, `video`, `image`, `markdown`, `html`, `mermaid`,
  `svg`, `monaco`, `base`, and anything else lint still reports outside the other tasks.
- `uikit/**` default texts (`emptyText`-style defaults, tree `Collapse` / `Expand` aria-labels): a
  uikit component must not import the app catalog. It takes the text as a prop with an English
  default, and Persephone passes `t(...)`. The task doc confirms the pattern against
  `src/renderer/uikit/CLAUDE.md`.
- **Acceptance:** E7; lint reports zero across `src/renderer` and `src/*.ts` host files.

### US-1664 — Monaco UI language

- Load `monaco-editor/esm/nls.messages.<lang>.js` before Monaco initializes, for the shipped
  languages in the built-in set (de, es, fr, it, ja, ko, pl, pt-br, zh-cn); never `ru` (D15).
  The active locale is fixed per window (D5), so this is a startup choice.
- Verify that Vite / `vite-plugin-monaco-editor-esm` keeps the import lazy, so English users load
  nothing extra.
- **Acceptance:** with a stub `de` pack active, Monaco's find widget and context menu are German;
  English startup bundle size is unchanged.

### US-1665 — Layout fixes, lint to error, closing sweep

- Fix the layouts `en-XA` breaks across the app, collected from every area task's notes: tab width,
  pinned rail, toolbars, the Settings tree (wider, or a tooltip on the ellipsized label), the
  520px dialogs.
- Switch `vanilla-view/no-hardcoded-ui-strings` to `error`. Exempt `src/board-context-menu.ts` by file, with a comment pointing
  at phase 3, if phase 3 has not translated it yet.
- Update `doc/standards/localization.md` with what the extraction taught (new lint positions, the
  E2 split pattern, the uikit prop pattern).
- Prepare the phase-4 inputs: count the final catalog size by area for the roadmap.
- **Acceptance:** `npm run lint` passes with the rule at error; an `en-XA` walk through the main
  screens finds no plain English outside E5.

## For the user to test

Each task is checked live by Claude under `en-XA` (Settings > General > Language > Pseudo-English in a
dev build) before it is committed. Things worth a human look, and layout notes for US-1665:

- **US-1654 — shell.** Header buttons and window controls, tab strip, editor switch buttons
  (`[ţéxţ éðîţöŕ]`), the menu bar (built-in folders, "Add folder"), Open Tabs window groups,
  Tools & Editors, Recent Files, Script Library. Editor names over MCP / `app.editors.list` stay
  English. Layout: the menu bar's left column cuts off "Tools & Editors" under `en-XA`.

## Notes

### 2026-10-10
- Epic created from phase 2 of the localization roadmap. Lint baseline measured: 892 reports in 196
  files before widening; the roadmap's ~2,000 estimate included patterns the rule did not yet see (E1).
- US-1653 widened lint coverage and measured 975 reports in 201 files after widening.
