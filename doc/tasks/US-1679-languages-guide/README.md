# US-1679: Agent guide for language packs

## Goal

Write and register `assets/guides/agents/languages.md` (`guides.agents.languages`) so any agent can add a language pack, fix one message, update a pack after an app update, or add a board language using the existing APIs. Add an empty shipped glossary at `assets/guides/agents/languages-glossary.md` and cross-links that make the guide discoverable, without implementing language-pack behavior.

## Background

`src/renderer/api/types/languages.d.ts` is the script contract and `src/renderer/scripting/ai-vision/namespaces/languages.ts` supplies MCP descriptions and `$help`. They currently expose `areas()`, bounded `english(area, options?)` pages, `missing`, `stale`, `validate`, `validateBoard`, `save`, `delete`, and `apply`. The guide must describe those names and effects exactly. In particular, `english()` includes placeholders, optional notes, and `sourceHash`; `save()` replaces by default, merges only user-pack data with `{ merge: true }`, and refuses any validation warning; `apply()` returns a scheduled result and reloads every window after the setting is saved.

`src/shared/i18n/validate-pack.ts` verifies pack shape, allowed plural keys (`zero`, `one`, `two`, `few`, `many`, `other`), known catalog keys, and placeholder equality across every supplied plural form. It does not enforce a locale's complete plural category set or require `other`. Runtime plural selection in `src/shared/i18n/t.ts` uses the active locale's category, then the pack's `other`, then English fallback. The guide should therefore tell agents to provide the target locale's categories from `Intl.PluralRules(code).resolvedOptions().pluralCategories`, include `other`, and preserve placeholders in every form; validation alone is not proof that the translation is complete or linguistically correct.

EPIC-127 decisions G1, G3, G7, and G8 govern the workflows: built-in packs are authored as files while a user's edits go through the API; settle the language glossary first; get the user's approval before the reload caused by `apply()`; and keep user packs in user storage, including partial overrides of built-in codes. Roadmap D3 keeps guides, MCP help, and other agent-facing text in English. D7 establishes per-key fallback from user to built-in to English. D14 calls for machine drafts reviewed by speakers. D15 means the guide must be language-neutral and must not imply that only built-in languages can be used. D17 says agents perform pack authoring and the MCP instructions should point agents to the guide.

For board packs, `assets/guides/agents/boards.md` already has a **Languages** section with the manifest shape, message format, `manifest.*` keys, placeholders, plurals, and manual default-pack comparison. `validateBoard(boardRoot, code)` is the API's read-only check against the board's declared default. The new guide should link that section for board authoring details rather than repeat them.

`src/main/mcp/manifest.ts` explicitly lists guide resources and contains `SERVER_INSTRUCTIONS`. The renderer guide index discovers Markdown pages by scanning the corpus, and `guides.search()` indexes those pages' content. `src/shared/guides/front-matter.ts` preserves a hyphenated filename stem, while `src/main/mcp/ai-vision/guides.ts` represents non-identifier names with bracket notation. Thus `assets/guides/agents/languages-glossary.md` has tree path `agents/languages-glossary` and is addressed as `guides.agents["languages-glossary"]` (or by the full path `guides["agents/languages-glossary"]` in a search hit); the guide itself remains `guides.agents.languages`. `assets/guides/agents/index.md` is the agent-facing navigation page. The Settings user guide is `assets/guides/screens/settings.md`; its Language section currently describes installing packs manually and needs a brief agent handoff sentence.

## Implementation Plan

1. [x] **Create the language guide** at `assets/guides/agents/languages.md`, with valid guide front matter (`title`, `audience: agent`, and a concise `summary`) so the auto-discovered path is `guides.agents.languages`. Keep its prose in English per D3 and use this complete planned outline:

   - **Purpose and pack layers:** define a language pack as a partial set of translations for known English catalog keys. Explain per-key resolution in this order: user pack, built-in pack, then English. A user pack for a built-in code contains only user data and can override one key without copying the built-in pack. Agent guides and `$help` remain English under D3; the guide explains that it is a workflow guide, not content to translate.
   - **Before translating: glossary and source:** read the shipped `guides.agents["languages-glossary"]` first and settle core interface and workspace terms using the target language's familiar UI register. Keep product and protocol names in English where identified in the glossary. If the glossary has no entry for this language, draft the core terms and show them to the user for approval before translating whole areas; record approved decisions in the pack task's working context, since an installed agent cannot edit the shipped glossary. The app contains about 1,500 messages in 19 areas. Gather entries through MCP `call` at `languages.areas` / script `app.languages.areas()`, then page through `english()` because MCP call results are limited to 20,000 characters by default and `english()` caps each page at 200 entries. Read each entry's `note` when present. Retain the exact source key and placeholder names and use each entry's `sourceHash` in the pack's `source` map.
   - **Workflow A — add a language, area by area:** choose the code and pack metadata (`schemaVersion: 1`, code, native `name`, English `englishName`, and `messages`; optional `direction: "ltr"` only when appropriate). Before the first save, `missing(code)` returns an empty key list and `warning: "No pack for <code>"`; this is expected and does not mean the catalog is complete. Start by validating and saving the first translated area, then add one area at a time. For plural messages, derive categories from `Intl.PluralRules(code).resolvedOptions().pluralCategories`, include `other`, and check the six allowed category names and placeholder rules enforced by `validate()`; the API validator checks supplied categories and placeholder consistency but not category completeness. Keep all `{placeholders}` exactly, including keyboard shortcut tokens. Copy each source entry's `sourceHash` into `source` for translated keys. Run `validate(packFragment)` on the current area payload and resolve every warning, then call `save(packFragment, { merge: true })` so earlier areas survive (save validates again and refuses any warning). Save after each area so a lost session loses at most that area's work. After a pack exists, use `missing(code)` to see which keys/areas remain and resume there. Write UTF-8, read the saved area back with `get(code, area)`, and inspect for literal `?`, replacement characters, or garbled text.
   - **Workflow B — fix one message:** read its English entry and note, preserve its key, placeholders, plural forms, and current source hash, then submit a one-message pack. Use `{ merge: true }` so other user translations remain intact. This is valid for built-in codes because the user layer overrides only submitted keys. Validate and read the key back to verify it.
   - **Workflow C — update after an app update:** use `missing(code)` to find untranslated keys and `stale(code)` to find changed English sources; use the returned `unverified` count to identify translations without source hashes. Read the affected current English entries and notes, update or add those translations, copy current `sourceHash` values, merge-save, validate, and read back. Do not call `stale`'s unverified messages stale: it counts them separately.
   - **Workflow D — add a language to a board:** link to **Languages** in `assets/guides/agents/boards.md` for the board's `lang/<code>.json`, `manifest.*` keys, placeholder/plural format, and comparison instructions. In this guide, state only the handoff: check the board's declared default pack, author the translated file and manifest display keys as applicable, then call `app.languages.validateBoard(boardRoot, code)` and resolve its warnings. Do not use `save()` for a board file; that API writes only user app packs.
   - **See the result:** explain that `app.languages.apply(code)` activates the app pack but reloads every open window, including the calling one. Ask the user first as required by G7; use `validate()` and `validateBoard()` for checks that do not switch the locale. Do not imply that saving automatically applies the pack.
   - **Writing quality and encoding:** use the UI's normal register and courtesy level; keep labels short because German text can be roughly 30% longer; use the target language's punctuation and quotation marks; preserve shortcut placeholders exactly; do not add HTML. Save UTF-8 and always read back with `get(code, area)` to check for question marks, U+FFFD, or mojibake before considering the area done.
   - **Language-neutral scope:** make the steps applicable to any language accepted by the API, including languages without a built-in pack. Do not single out a language as unsupported or treat its text specially.

   Every API example in the guide must show both the MCP `call` form and the script form. In MCP, the path names the method and `args` is a JSON array of its arguments, as specified by the ai-vision root help. Include paired examples for reads, validation, writes, audits, board validation, and apply. For example:

   The paired examples pass pack objects as JSON values in MCP `args` (not as variable-name strings). For the script snippets, define the matching `packFragment` object first:

   ```ts
   const packFragment = {
     schemaVersion: 1,
     code: "uk",
     name: "Language",
     englishName: "Language",
     messages: { "common.ok": "OK" },
   };
   ```

   ```text
   MCP call: path "languages.areas", args []
   Script:   app.languages.areas()

   MCP call: path "languages.english", args ["settings", { "offset": 0, "limit": 100 }]
   Script:   app.languages.english("settings", { offset: 0, limit: 100 })

   MCP call: path "languages.validate", args [{ "schemaVersion": 1, "code": "uk", "name": "Language", "englishName": "Language", "messages": { "common.ok": "OK" } }]
   Script:   app.languages.validate(packFragment)

   MCP call: path "languages.save", args [{ "schemaVersion": 1, "code": "uk", "name": "Language", "englishName": "Language", "messages": { "common.ok": "OK" } }, { "merge": true }]
   Script:   await app.languages.save(packFragment, { merge: true })

   MCP call: path "languages.get", args ["uk", "common"]
   Script:   await app.languages.get("uk", "common")

   MCP call: path "languages.missing", args ["uk"]
   Script:   await app.languages.missing("uk")

   MCP call: path "languages.stale", args ["uk"]
   Script:   await app.languages.stale("uk")

   MCP call: path "languages.validateBoard", args ["<boardRoot>", "uk"]
   Script:   await app.languages.validateBoard(boardRoot, "uk")

   MCP call: path "languages.apply", args ["uk"]
   Script:   await app.languages.apply("uk") // ask the user before this call
   ```

   Keep this pairing for every API method example in the guide, with MCP `args` in signature order. State that `english()` is paged because whole-area results can exceed the MCP call result limit; its page size defaults to 100 and is capped at 200.

2. [x] **Add the shipped glossary skeleton** in `assets/guides/agents/languages-glossary.md`. Start with a short purpose/rule explaining that each pack task fixes terminology before drafting, and that future edits reuse those decisions. Add one empty English-term → translation table per planned target language in EPIC-127 (each table has `English term` and `Translation` columns and no invented translations), plus a `Stays English` list for product/protocol names. Include an empty template table for other language codes so the glossary can cover any user language. US-1681 and later language tasks fill the shipped tables. For a language without a table, the guide instructs the agent to draft core terms and get user approval before translating whole areas.

3. [x] **Register and surface the guide and glossary.** In `src/main/mcp/manifest.ts`, add resource entries for `languages-guide` (`persephone://guides/languages`, file `guides/agents/languages.md`) and `languages-glossary-guide` (`persephone://guides/languages-glossary`, file `guides/agents/languages-glossary.md`); descriptions should make the guide's workflow and the glossary's term lookup clear. Add one concise `SERVER_INSTRUCTIONS` line directing “add/fix a language” requests to `guides.agents.languages` and identify the glossary at `guides.agents["languages-glossary"]` when choosing terminology. In `assets/guides/agents/index.md`, add navigation rows for the guide and glossary, using the bracket-quoted tree name for the hyphenated glossary page. Both Markdown pages are auto-indexed by `createGuideIndex()` and `guides.search()`; include discoverable terms such as “add a language”, “fix a translation”, and “language pack”. No separate search index change is currently needed.

   ```ts
   // Before: SERVER_INSTRUCTIONS has no language authoring route.
   "For boards, use `boards.*` and `guides.agents.boards`; the `persephone://guides/boards` resource is an alternative.",

   // After: add a sibling resourceFiles entry and a route in SERVER_INSTRUCTIONS.
   {
       name: "languages-guide",
       uri: "persephone://guides/languages",
       file: "guides/agents/languages.md",
       description: "Guide to adding a language pack or fixing a translation.",
   },
   {
       name: "languages-glossary-guide",
       uri: "persephone://guides/languages-glossary",
       file: "guides/agents/languages-glossary.md",
       description: "Localization glossary for language pack terms and names that stay English.",
   },
   "To add a language or fix a translation, follow `guides.agents.languages` or `persephone://guides/languages`.",
   ```

4. [x] **Add pointers.** In the **Languages** section of `assets/guides/agents/boards.md`, add a short pointer to `guides.agents.languages` for app language packs; preserve the existing board-specific instructions there. In the Language section of `assets/guides/screens/settings.md`, add the sentence “Ask your agent to add a language or fix a translation.” Update `doc/standards/localization.md` with links to `assets/guides/agents/languages.md` and `assets/guides/agents/languages-glossary.md`, so developers can find both the pack workflow and terminology decisions.

   ```md
   <!-- Before, in assets/guides/screens/settings.md: -->
   If no preferred language is available, Automatic uses English.

   <!-- After: -->
   If no preferred language is available, Automatic uses English. Ask your agent to add a language or fix a translation.
   ```

5. [x] **Keep tracking links current.** Link this task from the US-1679 line under EPIC-127 in `doc/active-work.md`, and link US-1679 in the task table in `doc/epics/EPIC-127.md`.

## Concerns

- `validate()` is structural validation, not translation review: it accepts partial plural maps and does not require every locale category or `other`, even though runtime selection falls back to `other` and then English. The guide must state that distinction clearly.
- Keep board pack instructions short and linked to the board guide's existing **Languages** section to avoid two competing copies of board rules.
- The roadmap's language-set list has 17 non-English built-in codes, while the guide and shipped glossary are for any API-supported language. The glossary should have blank built-in-language tables plus a reusable blank table template; agents without a glossary entry propose core terms to the user rather than editing shipped app assets.
- MCP `call` results default to 20,000 characters. The guide must consistently pair each API example with its `path` plus JSON-array `args` form and its script form; `english()` paging is required because returning a whole large area can be clipped.

## Acceptance Criteria

- `assets/guides/agents/languages.md` provides the complete outline above with accurate method signatures and effects from `src/renderer/api/types/languages.d.ts` and `src/renderer/scripting/ai-vision/namespaces/languages.ts`.
- The guide explains D7 per-key user → built-in → English layering and partial packs; keeps agents and `$help` English; and documents glossary-first work, placeholders, notes, plural categories, source hashes, merge saves, validation, UTF-8 read-back, and all four workflows.
- It tells agents that `apply(code)` reloads every window and requires asking the user first; it describes board validation through `validateBoard()` while linking to the board guide for file and manifest details.
- The guide applies to any language accepted by the API and does not single out a language negatively.
- `guides.agents.languages` resolves from the auto-discovered guide tree; `persephone://guides/languages` is registered; server instructions and the agent index route language-add/fix requests to it; `guides.search()` can find it from its content.
- The shipped glossary at `assets/guides/agents/languages-glossary.md` has a blank English-term/translation table per planned target language, a stays-English list, and a reusable table template; no translations are filled in by US-1679. Its canonical tree path is `agents/languages-glossary`, addressable as `guides.agents["languages-glossary"]`.
- The guide tells agents with no glossary entry to draft core terms and seek user approval before translating whole areas; the user agent can read the glossary from the installed app.
- Each API example pairs MCP `call` (`path` and JSON-array `args`) with the equivalent `app.languages.*` script expression. The guide explains the 20,000-character default result limit and why `english()` must be paged.
- Before the first pack save, `missing(code)` is documented to return no keys and `warning: "No pack for <code>"`; Workflow A begins by validating and saving its first translated area. It explains the roughly 1,500 messages across 19 areas, saving each area to limit lost work, and using `missing(code)` to resume after a pack exists.
- The board guide, Settings user guide, and localization standard contain the requested pointers; `active-work.md` and EPIC-127 link to this task document.
- No runtime/API implementation or language pack is added in US-1679.

## Files Changed Summary

| File | Planned change |
|---|---|
| `assets/guides/agents/languages.md` | **New:** language-pack authoring and repair guide, auto-discovered as `guides.agents.languages`. |
| `assets/guides/agents/languages-glossary.md` | **New:** shipped empty per-language glossary tables and stays-English list, readable by agents in installed builds. Its indexed path preserves the hyphen: `agents/languages-glossary`. |
| `src/main/mcp/manifest.ts` | Register both guide resources and route language add/fix requests through server instructions. |
| `assets/guides/agents/index.md` | Add the guide and glossary to agent navigation. |
| `assets/guides/agents/boards.md` | Add a pointer from its existing Languages section to the app language guide. |
| `assets/guides/screens/settings.md` | Add the user-facing “ask your agent” sentence in the Language section. |
| `doc/standards/localization.md` | Link the agent guide and shipped glossary under `assets/guides/agents/`. |
| `doc/active-work.md` | Link US-1679 under EPIC-127. |
| `doc/epics/EPIC-127.md` | Link US-1679 in the epic task table. |
| `src/shared/guides/index.ts` | **No change:** `createGuideIndex()` scans Markdown files recursively; the new guide is included automatically in tree and text search. |
| `src/renderer/api/types/languages.d.ts` | **No change:** existing public type contract is authoritative for the guide. |
| `src/renderer/scripting/ai-vision/namespaces/languages.ts` | **No change:** existing namespace help is authoritative for the guide. |
| `src/shared/i18n/validate-pack.ts`, `src/shared/i18n/t.ts` | **No change:** use current validation and plural-selection behavior; do not alter the API. |
| `assets/languages/**` and board `lang/**` packs | **No change:** translation packs are later EPIC-127 tasks. |
