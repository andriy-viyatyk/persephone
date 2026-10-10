# EPIC-127: Language packs â€” interface languages, phase 4

## Status

**Status:** Completed (2026-10-11)
**Created:** 2026-10-10

## Overview

Phase 4, the last phase of the [localization roadmap](../localization-roadmap.md). After EPIC-124
to EPIC-126, every string the app and its boards show comes from an English catalog or pack, but
English is the only language that ships. This epic gives an agent what it needs to write a pack
(the `app.languages` API and an agent guide, D17), proves the guide with a QA run, and then uses
the same guide to draft the seventeen built-in languages of roadmap Â§4 for the app, the two bundled
boards and the fifteen catalog boards. It ends with the installer offering those languages.

After this epic the user does a full local test, and then publishes the catalog boards. Publishing
is not part of this epic.

## Goals

- An agent can add a language, fix one message, or bring a pack up to date after an app update,
  from "add Estonian" alone: the MCP instructions point to `guides.agents.languages`, and the
  `app.languages` API lists, reads, validates, saves and applies packs.
- An agent can validate a board's `lang/<code>.json` without switching the app language (the gap
  found in the EPIC-126 QA run).
- Persephone ships packs for the seventeen non-English languages of roadmap Â§4, and every bundled
  and catalog board has a pack for each of them. `npm run i18n:check` passes for all of them.
- The user reviews Ukrainian before release.
- The installer asks for its language from the same set where NSIS supports it.
- Agents still drive the app in English (D3).

## Decisions

Roadmap decisions D1â€“D15 and D17 stand (D16 withdrawn), and EPIC-126's F1â€“F9 apply to board
packs. This epic adds these. They are proposals for the user to confirm or change:

- **G1 â€” Built-in packs are written as files, user packs through the API.** The roadmap said the
  built-in packs are drafted "by following the agent guide". Driving about 26,000 translations
  through MCP calls into a running app would cost far more than it proves. So the built-in packs
  are written straight into `assets/languages/<code>.lang.json` and each board's `lang/<code>.json`
  by the drafting agent, and checked with `npm run i18n:check`. They follow the guide's
  translation rules (placeholders, plural categories, notes, glossary, source hashes). The API
  path is what a user's agent uses, and the QA run (US-1680) tests it.
- **G2 â€” Translator notes before drafting.** Only 58 of the 1,524 catalog messages carry a `note`.
  Short labels such as "Open", "Close", "New", "Format", "Clear" or "Run" have several senses, and
  a machine draft guesses wrong without context. One task (US-1678) adds notes to the ambiguous
  messages, mostly single words and short phrases, before any language is drafted. `english()`
  returns them, and the guide tells the agent to read them.
- **G3 â€” A glossary per language, decided once.** Core terms (page, tab, board, editor, sidebar,
  script, pin, workspace terms such as "commit" and "push") are chosen once per language before
  its pack is drafted, and recorded in `doc/standards/localization-glossary.md`. Updates and fixes
  reuse the same words. The default is the terminology Windows uses in that language (Microsoft's
  style guides), so "File", "Save" and "Settings" match what users see elsewhere on their system.
  The same tone rule follows from that: the polite or informal form Windows uses in each
  language.
- **G4 â€” `i18n:check` catches broken characters.** Delegated drafting has repeatedly saved
  non-ASCII text as `?` or as double-encoded UTF-8 (EPIC-126). The check fails on a translated
  message containing U+FFFD, a `?` where the English has none, or a double-encoding pattern such as
  `Ãƒ`, `Ã`, `Ã‘` or `Ã¢â‚¬`. It also checks board packs (`--boards <folder>...`), with the same rules
  the board host applies.
- **G5 â€” Board packs go into this epic's unpublished board versions.** The catalog boards were
  bumped in EPIC-126 and are not published yet, so adding translated packs does not bump them
  again. Their `WHATS-NEW.md` entries gain a line about the new languages. Board work stays on
  `persephone-boards` `develop` (F9).
- **G6 â€” Ukrainian first, then the rest in groups.** Ukrainian is drafted first, end to end (app,
  bundled boards, catalog boards), so the user can review it while the rest is drafted, and so the
  drafting process is proven on one language before it runs on sixteen. The other languages go in
  four groups of four.
- **G7 â€” `apply()` reloads every window, so agents ask first.** `apply(code)` sets the `language`
  setting and reloads every window, as the Settings picker does (D5). The guide tells an agent to
  ask the user before calling it, and to use `validate` / `validateBoard` to check a pack without
  switching.
- **G8 â€” `save()` writes user packs only.** `save(pack)` validates the pack and writes
  `<userData>/data/languages/<code>.lang.json` atomically. It never writes into `assets/` or into a
  board folder (roadmap Â§6). A pack with a built-in code overrides only the keys it contains (D7),
  so a one-message fix is a one-message pack.

## Current state (verified 2026-10-10)

- **Shared i18n:** `src/shared/i18n/` holds the pack types (`pack.ts`), validation
  (`validate-pack.ts`: `validateLanguagePack`, placeholder and plural checks), loading
  (`load-packs.ts`), `t()` / `englishMessage()` (`t.ts`), source hashes (`hash.ts`:
  `hashEnglishMessage`) and `en-XA` (`pseudo-locale.ts`, `pseudo-text.ts`). Catalog entries are
  `{ message, note? }` in `src/shared/i18n/en/<area>.ts`, 19 areas, 1,524 messages, 58 notes.
- **Pack locations:** built-in `assets/languages/` (only a `README.md` today); user
  `<userData>/data/languages/`. Read at startup by `src/renderer/i18n/startup.ts` and, for the
  main process, `src/main/i18n-locale.ts`.
- **Check:** `scripts/i18n-check-entry.ts` (`npm run i18n:check`) validates built-in packs and
  regenerates `en-XA`; it does not report missing or stale keys per pack yet, and does not read
  board packs.
- **Board packs:** validated at registration in `src/renderer/editors/board/board-i18n.ts`
  (`loadBoardI18n`), only for the current language.
- **Language setting:** `app.settings` `language` (`"auto"` or a code), Settings > General >
  Language with completeness; changing it in the picker reloads every window.
- **Script and MCP surface:** the ai-vision tree in `src/renderer/scripting/ai-vision/`
  (namespaces such as `themes.ts`, `settings.ts`, `boards.ts`) mirrors `AppWrapper`
  (`scripting/api-wrapper/AppWrapper.ts`). Guides are registered in `src/main/mcp/manifest.ts`,
  which also holds the server instructions.
- **Monaco** already loads its own translations for the languages it ships (US-1664);
  **Excalidraw** bundles 15 of the 17 (US-1672; `et` and `be` fall back to English).
- **Installer:** `electron-builder.yml` `nsis` has no language settings.

## Linked Tasks

Each task document is written when its task starts. Codex investigates and implements, Claude
reviews the plan; the QA run is Claude's.

| Task | Title | Status |
|------|-------|--------|
| [US-1676](../tasks/US-1676-languages-api-read/README.md) | `app.languages` read side: `list`, `current`, `get`, `english(area)`, `missing`, `stale`, `validate`, `validateBoard` | Planned |
| [US-1677](../tasks/US-1677-languages-api-write/README.md) | `app.languages` write side: `save`, `delete`, `apply` | Planned |
| [US-1678](../tasks/US-1678-notes-and-check/README.md) | Translator notes for ambiguous messages; `i18n:check` per-pack report, broken-character check, board packs | Planned |
| [US-1679](../tasks/US-1679-languages-guide/README.md) | Agent guide `guides.agents.languages`, MCP pointer, glossary file, user-guide note | Planned |
| US-1680 | QA run: a weak agent creates a pack and fixes a message from the guide alone | Done — validateBoard now reports `missing`; Workflow D explains `manifest.*` keys |
| [US-1681](../tasks/US-1681-ukrainian-pack/README.md) | Ukrainian: app, bundled boards, catalog boards; handed to the user for review | Planned |
| US-1682 | Polish, Lithuanian, Latvian, Estonian | Drafted, checks pass; awaiting user review |
| US-1683 | Belarusian, Romanian, Slovak, Hungarian | Drafted, checks pass; awaiting user review |
| US-1684 | German, French, Spanish, Italian | Drafted, checks pass; awaiting user review |
| US-1685 | Portuguese (Brazil), Chinese (Simplified), Japanese, Korean | Drafted, checks pass; awaiting user review |
| US-1686 | Installer languages (NSIS) | Done — 18 languages; `npm run dist` builds |
| US-1687 | Closing sweep: layout under the longest languages and CJK, roadmap | Done — no layout fixes needed |

### US-1676 â€” `app.languages`, read side

- `list()`: built-in and user packs, with code, names, completeness and whether a user pack
  overrides a built-in one. `current`: the active code and how it was chosen (setting or auto).
- `get(code)`: the merged pack as the app sees it, and which keys come from the user pack.
- `english(area?)`: keys with English text, plural forms, placeholders, notes and source hashes,
  per area so an agent can work in chunks that fit its context. `areas()` lists the areas and
  their sizes.
- `missing(code, area?)` and `stale(code, area?)` (source hash differs from the current English).
- `validate(pack)`: the loader's warnings without saving. `validateBoard(boardRoot, code)`: the
  board host's checks for `lang/<code>.json` against the board's default pack, without switching
  the app language.
- Exposed to scripts (`app.languages`, typed in `api/types/`) and to MCP (`languages.*` in the
  ai-vision tree), with `$help` text. Agent-facing text stays English (D3).
- **Acceptance:** over MCP, an agent lists packs, reads the `settings` area, validates a
  hand-written pack with a wrong placeholder and gets the warning, and validates a test board's
  `de.json` while the app runs in English.

### US-1677 â€” `app.languages`, write side

- `save(pack)`: validate, refuse on errors with the warnings, write the user pack atomically (G8).
  A partial pack with a built-in code is allowed and overrides per key.
- `delete(code)`: remove a user pack; the built-in pack, if any, applies again.
- `apply(code)`: set `language` and reload every window, as the picker does (G7).
- The Settings language list picks up a saved pack after the next reload, as today.
- **Acceptance:** a one-message `uk` fix saved through MCP shows after `apply("uk")`; `delete`
  restores the built-in text; an invalid pack is refused with its warnings.

### US-1678 â€” Translator notes and the check script

- Add a `note` to every ambiguous message (G2): single words and short phrases whose sense depends
  on where they appear, verbs that could be nouns, and messages whose placeholders need explaining.
- `i18n:check` reports, per built-in pack, missing and stale keys and invalid messages, and fails
  on broken characters (G4). `--boards <folder>...` checks board packs with the board host's rules
  and the same broken-character check.
- **Acceptance:** the check catches a planted `?`, a double-encoded string and a stale key, and
  reports a board pack's wrong placeholder.

### US-1679 â€” Agent guide

- `assets/guides/agents/languages.md` (`guides.agents.languages`) per D17: create a pack area by
  area; keep `{placeholders}`; supply the target language's plural categories; read notes; record
  source hashes; fix the glossary first (G3); validate; save; ask before `apply` (G7); fix one
  message; bring a pack up to date after an app update (`missing`, `stale`); add a language to a
  board with `validateBoard`.
- `doc/standards/localization-glossary.md`, empty table per language, filled by each drafting
  task.
- Pointers: MCP server instructions in `src/main/mcp/manifest.ts`, `guides.agents.index`, the board
  guide's "Languages" section, and a short user-guide note in the Settings guide ("ask your agent
  to add a language").
- **Acceptance:** an agent finds the guide from "add a language" through the MCP instructions.

### US-1680 â€” QA run (Claude)

- A weak test agent with only the docs adds a small Estonian pack for one area, then fixes one
  Ukrainian message, then checks a board pack. Fix what misleads it in the guide, `$help` or the
  instructions.

### US-1681 to US-1685 â€” The packs

- Each task drafts its languages per G1â€“G3: glossary first, then the app pack area by area, then
  the bundled boards (REST Client, Excalidraw's own text), then the fifteen catalog boards on
  `persephone-boards` `develop` (G5), including their `manifest.*` keys.
- `npm run i18n:check` and the board check pass; no broken characters.
- A live look per language: Settings, a dialog, one board; screenshots for the user.
- US-1681 hands Ukrainian to the user for review; their corrections are applied in the same task.

### US-1686 â€” Installer languages

- `electron-builder.yml` `nsis`: `multiLanguageInstaller: true` and `installerLanguages` for the
  languages NSIS ships, with the installer picking the OS language.
- **Acceptance:** `npm run dist` builds; the installer offers the languages.

### US-1687 â€” Closing sweep

- Check layout under the longest packs (German, Hungarian, Ukrainian) and under Chinese, Japanese
  and Korean, at the risky spots from the roadmap (tabs, pinned rail, narrow dialogs). Fix what
  breaks.
- Dry-run the catalog publish script to confirm the `localized` map fills from the new packs.
- Update the roadmap: phase 4 done, the user's local test and the boards publish next.

## Notes

### 2026-10-10
- Created after EPIC-126 closed. G1â€“G8 are proposals for the user.

### 2026-10-11

- **US-1682–1685** follow the US-1681 process and have no task documents of their own. Every pack
  is 1524/1524 with no stale, broken or invalid entries; all 15 catalog boards and both bundled
  boards carry all 17 languages. Fixes made after drafting: Estonian dropped a `{product}`
  placeholder; Latvian used the same word for Explorer and Browser; Estonian used three words for
  Explorer; Slovak used "InPrivate" for incognito; Spanish missed `many` plural forms in 14
  messages, left "Browser" in English and translated "Deaf" as "no sound".
- Four keys confused nearly every language ("bridge", the clipboard "Deaf" state, "pipe"). They now
  carry translator notes; the nine packs drafted before the notes were corrected by hand.
- **US-1680:** the weak test agent completed all three requests from the guide alone. Fixed what
  misled it: `validateBoard` now also returns `missing` (untranslated default-pack keys; they fall
  back, so `valid` is unaffected), and Workflow D explains the `manifest.*` keys.
- **US-1686:** `electron-builder.yml` sets `multiLanguageInstaller` and 18 `installerLanguages`;
  `build/installer.nsh` translates its options page through `LangString`s declared in
  `customHeader` (the file is UTF-8 with BOM). NSIS 3.0.4 has no "Choose Users" page strings for
  Lithuanian, Latvian, Estonian and Romanian, so `warningsAsErrors: false` lets that one page fall
  back to English instead of failing the build.
- **US-1687:** Settings and the sidebar menu checked under German, Hungarian and Japanese; nothing
  overflows. `publish-board.mjs` has no dry-run mode (it creates releases and pushes), so its
  `buildLocalizedCatalogMetadata` was run in isolation: all 15 boards produce `name` and
  `description` for 17 languages.
- Left for the user: review of the packs (US-1681 first), a local test of the installer, then the
  boards publish (merge `persephone-boards` `develop` into `main`).
