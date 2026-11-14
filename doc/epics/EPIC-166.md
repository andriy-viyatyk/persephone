# EPIC-166: Refactoring Phase 6.5 part 1 — Settings editor: field kit, declarative sections, shell-owned headers, `SettingsLayoutModel`

## Status

**Status:** Completed
**Created:** 2026-11-14

## Overview

This is the twenty-sixth epic of the [refactoring roadmap](../refactoring-roadmap.md) and part 1 of roadmap item
**6.5, Settings editor** (findings **EDT-1**, **EDT-2**, **EDT-4** in
`doc/reviews/refactoring-2026-11/08-editors-tools.md`). EDT-3 (the settings schema with `settingDefault`,
`settingOptions` and `settingRange`) was already done in [EPIC-155](EPIC-155.md), and `settings.watch` replaced the
hand-filtered `onChanged` subscribers there, so the fields built here read ranges, options and defaults from the schema
and subscribe through `settings.watch`.

The code was checked on 2026-11-14, after EPIC-165. The current state:

- **`editors/settings/`** — `SettingsView.ts` (641 lines), `settings-catalog.ts` (274),
  `sections/SettingsSections.ts` (904, the simple sections plus Voice typing and Microphone),
  `BrowserProfilesSection.ts` (673), `ThemeSection.ts` (361), `BoardSettingsSection.ts` (346), `McpSection.ts` (314),
  `LanguageSection.ts` (182), `BrowserProfilesSectionModel.ts` (175), `McpSectionModel.ts` (157),
  `ProfileNetworkLineView.ts` (151), `DefaultBrowserSection.ts` (129), `ClipboardSection.ts` (122),
  `SiteExtensionsSection.ts` (110), `FileSearchSection.ts` (99), `settings-native.ts` (79),
  `ClipboardSectionModel.ts` (55).
- **No field framework.** Number drafts are committed on blur by three mechanisms, path pickers come in two idioms,
  sections call `helpHeader(...)` themselves (19 call sites) while the shell special-cases `link-behavior` and
  `default-browser` (`SettingsView.ts:308-309`), and eight English messages are duplicated as `groupTitleX` / `xTitle`.
  `BoardSettingsSectionView` has its own declaration-driven renderer with a five-optional-field control record and an
  untranslated `"Reset"`.
- **Sections bypass services.** `LanguageSection` re-implements `languages.list()` / `apply()` with fake packs;
  `ThemeSection` imports `theme/themes`, `theme/theme-state` and `custom-theme-storage` instead of `app.themes` and
  detects custom themes by the `"custom-"` prefix; `McpSection` hard-codes the client URL format.
- **The shell** (`SettingsView`) recomputes the section list on every scroll event, reads board manifests itself
  (`ensureBoardDisplayText`), runs a `MutationObserver` on every `hidden` attribute, and writes descriptor fields
  (`groupTitle`, `description`) it never reads.

## Goals

- **A settings field kit** in `editors/settings/fields/`: a `SettingsStore` adapter (`get`, `set`, `reset?`,
  `subscribe`) with `appSettingsStore` (over `settings` + `settings.watch`) and a board store (over
  `api/board-settings`), and field views `CheckboxField`, `ChoiceField`, `NumberField` (+ `PortField`), `PathField`,
  `ShortcutField`, `TextListField` that own their subscription, draft and validation. Board settings render as
  "declarations → fields over the board store".
- **Declarative simple sections:** Link behavior, Window, Editor, Terminal, Git, Board vars, Script library, Video
  player, Voice typing, Clipboard, File search and the MCP ports are short field lists; the three draft mechanisms,
  the copied port rule and Enter-to-blur handlers and the per-section `DepsGate` models go.
- **Shell-owned headers:** a `SettingsSectionDescriptor` (catalog entry + `create()`); the shell renders the header
  from `titleKey` + `helpKey`, sections render only their body, the shell's id special cases and the duplicate
  `*Title` messages go.
- **`SettingsLayoutModel` + `ScrollSpy`:** a DOM-free layout model that recomputes only when the board settings
  registrations change; a reusable scroll-spy helper carrying the settling logic and its comments; board display names
  from a board-module owner, so Settings does no manifest IO; the `MutationObserver` and dead descriptor fields gone.
- **Sections call their services:** Language through `languages.list()` / `apply()` (+ `languages.effective()` for the
  reload hint), Theme through `themes.list()` / `apply()` / `delete()` with an explicit custom flag and
  `isCapabilityErrorWithCode(..., "no-handler")`, MCP through the URL main already reports.

## Decisions this epic acts on

- **Scope: five tasks (part 1); the rest is part 2.** Part 1 = EDT-1 steps 1–4, EDT-4 and EDT-2 steps 1, 2 and 6.
  **Part 2** (recorded in the roadmap) = EDT-2 steps 3–5 (an `api/browser-profiles.ts` service with
  `getPartitionString` in `shared/`, a microphone settings service with a typed status union, and
  `siteExtensionStore.listWithTrust()` shared with the Tools hub) and EDT-1 step 5 (the composite sections — Theme,
  Browser profiles, Microphone, Site extensions, Default browser — rebuilt from the same fields). The split follows the
  owner boundary: part 1 stays inside `editors/settings/` plus two existing services; part 2 creates new services in
  the browser and speech areas, each a cross-area change that deserves its own plan.
- **Order:** US-1944 field kit and board settings → US-1945 simple sections on the kit → US-1946 shell headers,
  `SettingsLayoutModel`, `ScrollSpy` → US-1947 Language / Theme / MCP through their services. US-1947 is planned in parallel with US-1944 (disjoint files); US-1945 is planned after US-1944 is implemented and
  US-1946 after US-1945, so each plan reads the real code. Implementations run one at a time.
- **Behaviour is kept.** Every setting keeps its key, value type, normalisation, commit moment (on change for
  checkboxes and choices, on blur/Enter for numbers and text), clamping/rejection rule and reset value. Where today's
  copies disagree with the schema, the schema (EPIC-155) wins only if the visible behaviour is identical; otherwise the
  plan keeps the current rule and records it. Rendered DOM structure, CSS classes and every `data-name` value stay
  identical (the ai-vision `settings` namespace and `doc/architecture/ui-element-contract.md` depend on them); the
  header markup the shell renders must be the markup the sections render today.
- **i18n:** deleting the eight duplicate `*Title` messages removes keys from `src/shared/i18n/en/settings.ts` and from
  every pack in `assets/languages/`; no English text changes. The translated `Reset` label for board settings reuses an
  existing message if one exists, otherwise adds one and is translated at epic close. `npm run i18n:check` must stay
  complete.
- **Contracts that must not change:** the settings file format and its comments, `appSettings` vs `uiPreferences`
  (D12), board settings storage, `app.languages` / `app.themes` script API, ai-vision paths and output, MCP `call`,
  `data-name`, `window.persephone` (not touched, so no `BOARD_BRIDGE_VERSION` bump; a plan that touches it is sent back).
- **Owners.** `editors/settings/fields/` (store adapters + field views); `SettingsSectionDescriptor` in
  `settings-catalog.ts`; `SettingsLayoutModel` and `ScrollSpy` (the plan names files; `ScrollSpy` goes to `uikit/` only
  if it has no settings knowledge); board display names in `api/boards/` (`board-display-text.ts` or the registry
  registration); `languages.effective()` in `api/languages.ts`; the custom-theme flag in `api/themes.ts` /
  `ThemeDefinition`; the MCP client URL from the status main already returns.
- **No new protocol code, no `await import()` to break a cycle** (guardrails 1, 5). Board rules stay in the board
  module (guardrail 2). **God files only shrink** (guardrail 3): `SettingsSections.ts` (904), `SettingsView.ts` (641),
  `BoardSettingsSection.ts` (346), `ThemeSection.ts` (361), `LanguageSection.ts` (182), `McpSection.ts` (314),
  `McpSectionModel.ts` (157), `ClipboardSectionModel.ts` (55).

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1944 | Settings field kit, `SettingsStore` adapters; board settings on fields | Done |
| US-1945 | Simple built-in sections as field lists | Done |
| US-1946 | Shell-rendered headers, `SettingsLayoutModel`, `ScrollSpy`, board display names | Done |
| US-1947 | Language, Theme and MCP sections call their services | Done |

### Task notes for the planners

- **All tasks.** Name the owner of every moved rule and the helper reused. Line counts before/after for the files under
  "God files only shrink". For every exported symbol that moves or is renamed, list its importers and update them (no
  re-export shims). Every `data-name` in a touched view listed and shown preserved. No unit tests or harnesses.
- **US-1944.** The store interface and both adapters; each field's props, DOM (matching an existing section's markup
  for the same control so US-1945 changes no DOM), draft/commit/validation rules; `NumberField` covers the three draft
  mechanisms and their resync-on-external-change behaviour; `PathField` covers both path idioms (value box with
  Browse/Clear; link-or-placeholder with ×) as two variants with today's markup. `BoardSettingsSectionView` maps
  declarations → fields: every declaration type (boolean, enum, multiselect, multiline, string, number, folder path),
  load/save/reset and number commit kept; the control record becomes a tagged union or disappears.
- **US-1945.** Per section and per row: key, control, today's commit rule, range/options source, reset value and
  `data-name` → the field that replaces it. The port rule and Enter-to-blur exist once. Voice-typing shortcut capture
  moves into `ShortcutField`. Sections that keep custom rows (Git status probe, MCP config JSON) say so.
- **US-1946.** Header markup today (section `helpHeader` vs `sectionTitle`, the two shell special cases) → one shell
  rendering, identical DOM per section; which messages are deleted and every reader; the scroll settling logic moved
  with its comments; when the layout model recomputes; what replaces the manifest IO; why the `MutationObserver` can go
  (no section hides its root).
- **US-1947.** Language: today's option list (merge, completeness, forced `en`, dev `en-XA`) vs `languages.list()` —
  show they are equal or what differs; the apply path (set, flush, reload all windows). Theme: every `custom-` check,
  the delete path, the edit-failure path. MCP: where the URL comes from today and after.

## Out of scope

- Part 2 (see Decisions). Any change to `window.persephone`, the script API, MCP `call` or the `data-name` contract.
- US-1873 (board docs) stays in Planned.

## Notes

### 2026-11-14
- Epic created after EPIC-165. Findings re-checked against the code (see Overview). EDT-3 was done by EPIC-155.
- Codex weekly window had 35% left at the start, so planning runs on Luna (the policy pick).

### 2026-11-14 — plan reviews and implementation
- **US-1944.** Corrections: every field is born with a consumer, so US-1944 builds only what board settings use
  (store + adapters, `CheckboxField`, `ChoiceField`, generic `NumberField`, `PathField` value-box, board-local
  string/multiselect/multiline); `PortField`, `ShortcutField`, `TextListField` and the link-or-placeholder path move
  to US-1945. Microphone number rows stay out (part 2) and the proposed new `microphone.notches` watch was dropped
  (a behaviour change). Store reads are `V | Promise<V>` so app settings still paint synchronously. Board read/write/
  reset errors keep their exact messages through an `onError` callback. `LibraryPathSectionView`'s row became
  `PathField` (no third copy of the value box); the board folder path composes the same nested section + header.
  The finding's "untranslated Reset" was stale: the board section already used `settings.reset`.
  `BoardSettingsSection.ts` 346 → 185, `SettingsSections.ts` 904 → 839.
- **US-1947.** Corrections: `app.languages.apply()` keeps its scheduled 100 ms reload (a script or MCP caller must
  get its reply before its window reloads); the shared validate/set/flush part is one internal function, and the
  Settings section uses a module-level `applyLanguageAndReload` that awaits the reload as before. The effective
  locale comes from one `loadLanguageSettings()` result (no hidden snapshot). The MCP URL format moved to
  `src/shared/mcp-endpoint.ts`, used by main's two status getters and the Settings JSON (configured ports, as before)
  instead of re-parsing the reported URL. The ThemeSection "English-text comparison" was already gone; custom themes
  are recognised through the custom-theme catalog (`isCustomTheme`) instead of the `custom-` prefix.
  `LanguageSection.ts` 182 → 106.
- **US-1945.** Corrections: the MCP/Mneme port inputs' `disabled` state is live (follows the enable checkbox), so the
  section updates the field rather than passing it once; `NumberField` got a `format` hook so the clipboard limit
  still shows `normalizeClipboardMaxItems(value)` on first paint, external change and rejection; the enabled-transition
  status refresh in `McpSectionModel` fires on the same transitions as the old primed `DepsGate`s. Two DOM regressions
  found by a before/after structural fingerprint of every section and fixed by the epic owner: Board Vars' path row had
  lost `paddingBottom: "lg"`, and Terminal's select had gained a fixed 360 px width. After the fix all 26 sections are
  structurally identical to the pre-task baseline. `SettingsSections.ts` 839 → 685, `McpSection.ts` 312 → 267,
  `McpSectionModel.ts` 157 → 114, `ClipboardSection.ts` 122 → 58, `FileSearchSection.ts` 99 → 37,
  `ClipboardSectionModel.ts` deleted.
- **US-1946.** Corrections: board display names are ensured by a board-module helper in `board-display-text.ts`
  that Settings awaits, instead of delaying `CustomEditorRegistry` publication (which every other registry consumer
  would have felt); Theme re-renders remove only the body nodes it appended (no "keep the first child" knowledge of the
  shell header); mount order and connection state at `onMount` kept per section; the shell owns each header's
  `HelpIconView` lifetime, including on board-section rebuilds; `ScrollSpy` reads the layout snapshot. Headers that are
  not static catalog text stay section-rendered: board display names, the board folder-path sub-header, MCP's Mneme
  sub-header. Link behavior and Default browser headers keep their wrapper position through an explicit
  `headerPlacement` instead of id checks. Eight duplicate `*Title` messages removed from English and all 17 packs
  (272 lines; `i18n:check` 1672/1672 everywhere). `SettingsView.ts` 641 → 448.
- **Live check (cold start, after US-1946):** structural fingerprints of all section roots and all wrappers, and every
  header text and help-icon label, are identical to the pre-task baseline; a live theme change keeps the shell header;
  content-tree click scrolls and aligns the target; scroll spy selects the last section at the bottom and Theme at
  the top.
- **Live check (cold start, after US-1944 + US-1947):** Settings renders all sections; board settings (16 controls
  across the installed boards) load their stored values; the MCP config JSON is unchanged.
- **Completion (2026-11-14).** `/review` (Codex): no findings. `/document` updated `folder-structure.md` and
  `key-files.md`. `/userdoc`: no guide change needed. No English message was added or changed (eight duplicates were
  removed); `npm run i18n:check` reports every pack complete (1672/1672). Roadmap item 6.5 part 2 is recorded in the
  roadmap. Not touched by this epic: `settings.highlight` fails in the dev build with "The highlight overlay did not
  install" for any selector (also `body`); it comes from the external `ai-vision/dom` overlay, not from Settings.
