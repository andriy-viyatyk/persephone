# US-1651: Localization conventions, lint rule, and pack check

## Goal

Give Phase 2 a source-verified guide for adding translated UI messages, warn on new hardcoded UI
strings, and add `npm run i18n:check` to report pack completeness, stale source hashes, invalid
entries, and any built-in message that the D16 filter would change.

## Background

EPIC-124 already has a working shared runtime in `src/shared/i18n/`. English entries live in
`src/shared/i18n/en/common.ts` and `src/shared/i18n/en/main.ts`; each is a flat area catalog whose
entries have `{ message, note? }` shape. `src/shared/i18n/en/index.ts` merges them and derives
`MessageKey` as `<area>.<entryName>` (for example `common.ok`), while `src/shared/i18n/t.ts`
exports typed `t(key, params?)` and `englishMessage(key, params?)`. Roadmap examples such as
`settings.theme.title` describe the intended semantic naming but are not valid with the current
two-part key type and `key.split(".")` implementation. The conventions must describe the current
working form and record any future nested-key change as a separate scope decision, rather than
documenting keys that cannot compile.

`EnglishCatalogEntry.note?` already provides the minimal per-key translator note requested by D1;
catalog authors should use `{ message, note: "..." }` when context is needed. Plain messages use
`{name}` placeholders. Plural entries use CLDR category objects and `params.count`, with the
category selected by `Intl.PluralRules` in `src/shared/i18n/plurals.ts`. Sentences that need dynamic
values should be one message with placeholders, not concatenated fragments.

`src/shared/i18n/pack.ts` defines schema version 1, BCP-47 `code`, localized `name`, English
`englishName`, optional `direction: "ltr"`, `messages`, and optional `source` hashes. The format is
also summarized in `assets/languages/README.md`; built-in files belong under `assets/languages/`,
and the current folder contains only that README. `hashEnglishMessage()` in
`src/shared/i18n/hash.ts` hashes a string or canonicalized plural categories. `validate-pack.ts`
checks filename/code agreement, message keys and placeholders, and rejects D15 blocked codes and
names. `filter-pack.ts` implements D16; `load-packs.ts` applies it to non-built-in packs only.
`pseudo-locale.ts` generates a complete `en-XA` pack from the English catalog, accenting and padding
messages while protecting placeholders.

D3 keeps agent-facing and durable developer text in English: `$help`/script API help and errors in
`src/renderer/scripting/api-wrapper/`, AI-vision adapters in
`src/renderer/scripting/ai-vision/`, MCP handlers in `src/main/mcp/` and
`src/renderer/api/mcp/`, script API declarations under `src/renderer/api/types/`, logs, guides,
What's New, and ai-vision text. `englishMessage(key)` exists for an agent-facing consumer that
shares an extracted UI message. US-1648 records the same-key rule: after extraction, the UI label
uses `t(key)` and the agent-facing consumer uses `englishMessage(key)` with that same catalog key.
For dialog buttons, the stable id remains its English identity, separate from the translated label.

`eslint.config.mjs` is ESLint 9 flat config and already defines an inline local `vanilla-view`
plugin. No separate `eslint-rules/` or `scripts/eslint/` directory exists. It lints TypeScript and
TSX; JavaScript/MJS files are ignored. `package.json` defines `npm run lint` as `eslint .` and has
no `--max-warnings` limit. A read-only grep over renderer TypeScript found roughly 650 candidate
occurrences across `.textContent =`, `createTextElement(...)`, `ui.notify(...)`, and
`app.ui.notify(...)` alone, before `settings-native` `text(...)`, object-property matches,
deduplication, agent-folder exclusions, and non-word filtering. This is an upper-bound signal, not
an expected warning count; the rule must be run once implemented to establish its actual output.

Node scripts in `scripts/` are `.mjs` files. `tsx` and `vite-node` are not installed; `esbuild` is a
dev dependency. Node cannot directly execute the repository's TypeScript i18n modules through the
existing scripts, so the checker should bundle its TypeScript entry with esbuild (using the Node
platform and ESM output) and import/run that bundle. This reuses the real catalog, validator,
hashing, pseudo-locale, and D16 filter implementations instead of copying their logic into JS.

## Implementation Plan

1. **Write `doc/standards/localization.md`.** Cover the following verified workflow and conventions:
   - Add messages to the relevant flat area file under `src/shared/i18n/en/`; use one semantic
     entry name per string and the currently supported `<area>.<entryName>` typed key form. Import
     `t` from `src/shared/i18n/t.ts` at the UI call site. Show a before/after example:

     ```ts
     // Before
     label: "OK"

     // After
     label: t("common.ok")
     ```

   - Use `{placeholders}` for interpolated values and a CLDR category object for counts; pass the
     numeric count as `params.count`. Do not concatenate sentence fragments. Keep translator
     context beside the catalog entry with its existing optional `note` property.
   - Keep D3 agent-facing text English. Identify the concrete folders and durable surfaces from the
     Background section; use `englishMessage(key)` when an agent-facing consumer must share the
     same source key. Document the US-1648 dialog button contract: id/agent-facing text and visible
     label use the same catalog key, with the stable id remaining English.
   - Explain that `en-XA` is generated by `createPseudoLocalePack()` and is used to expose missed
     extraction and longer-label layout issues. Describe schema version 1 and the source hash
     behavior using `assets/languages/README.md`, `pack.ts`, and `hash.ts` as references.
   - Include D15 and D16 exactly as enforced: blocked Russian code/name rejection, hash-based
     whole-word filtering and Russian-letter signature behavior for non-built-in packs, and the
     built-in-pack no-false-hit gate. State that no built-in Russian pack is allowed.
   - Call out the current flat `<area>.<entryName>` type/runtime shape so authors do not copy the
     roadmap's deeper illustrative key examples as if they were currently accepted.
2. **Add a warning-only hardcoded UI string rule.** Extend the local plugin pattern in
   `eslint.config.mjs` with a rule that reports string literals and template literals containing
   letters in these UI positions: object properties `label`, `title`, `placeholder`, `tooltip`,
   `children`; assignments to `.textContent`, `.title`, or `.placeholder`; first arguments to
   `createTextElement(...)`, `text(...)` imported from `src/renderer/editors/settings/sections/settings-native.ts`,
   `ui.notify(...)`, `app.ui.notify(...)`. Restrict reporting to literal source values (do not
   report variables or catalog calls). Ignore empty strings, single punctuation, icon-only values,
   CSS/non-word values, `data-name`, and test/story files. Ignore `src/shared/i18n/**` and the
   verified English agent-facing folders: `src/renderer/scripting/ai-vision/**`,
   `src/renderer/scripting/api-wrapper/**`, `src/main/mcp/**`, `src/renderer/api/mcp/**`, and
   `src/renderer/api/types/**`; keep runtime log payloads, thrown/script API errors, and static
   documentation English per D3, while still allowing localizable Log View controls. Keep
   severity `warn` so the existing `eslint .` command remains successful while Phase 2 extracts
   strings. Also exempt `src/renderer/automation/**`, whose D3-facing automation text stays English.
   Validate the estimate by running lint and recording the actual number of these new warnings;
   the grep estimate above is intentionally only a rough candidate count.
3. **Add `npm run i18n:check`.** Add `scripts/i18n-check.mjs` plus a TypeScript checker entry point
   bundled at runtime with the already-installed `esbuild`, then add the package script. Read each
   `<code>.lang.json` from `assets/languages/` and, when provided, an optional directory path for
   user packs. For every file, call `validateLanguagePack()` and report validator warnings as
   invalid entries; compare every English catalog key to report missing messages; compare each
   present translation's `source` against `hashEnglishMessage()` to report absent/mismatched source
   hashes as stale. Missing and stale findings are informational and do not set a failing exit
   code. Invalid pack/message warnings and any D16 mutation of a built-in message set the exit code
   non-zero. For built-ins, compare `filterLanguagePack(validatedPack).messages` with the validated
   messages (deeply, including plural objects); do not alter or rewrite any files.
4. **Check generated `en-XA` in the command.** Generate it with `createPseudoLocalePack()`, validate
   it as `en-XA.lang.json`, and require that its complete message set validates without warnings.
   It is generated data, not a checked-in translated pack: do not classify its intentionally absent
   `source` hashes as stale. Report that the pseudo pack passed. This makes the acceptance check
   exercise the same catalog and pack validation path even when `assets/languages/` has no built-in
   JSON packs yet.
5. Link `doc/standards/localization.md` from the Documentation Map in `doc/agents-common.md` and
   add a short link in a fitting localization/coding-guidance spot in `doc/standards/coding-style.md`.
   Keep this documentation pointer concise; the localization standard owns the full rules.

## Concerns

- The accepted roadmap's sample keys are deeper (`settings.theme.title`) than the current catalog
  type/runtime supports (`<area>.<entryName>` only). This document should truthfully state the
  current supported form; changing the runtime to nested paths is not part of US-1651 and needs a
  separate decision if desired.
- ESLint cannot infer whether an arbitrary `text()` function is the settings-native helper from
  syntax alone. Match the imported binding from
  `src/renderer/editors/settings/sections/settings-native.ts`, including aliases, rather than
  warning on every function named `text`.
- `npm run i18n:check` must distinguish “incomplete but usable” packs (missing/stale, informational)
  from invalid packs and D16 false positives (fatal). It must never write the filtered pack back to
  disk.
- The localized package folder currently contains no built-in `.lang.json` file, so the initial
  checker run should say that no built-in files were found and still pass the generated `en-XA`
  validation.
- `src/renderer/core/utils/format.ts` is being changed by US-1650 concurrently. It is not part of
  this task and must remain untouched.

## Acceptance Criteria

- `doc/standards/localization.md` explains typed catalog usage, current key naming, placeholders,
  `params.count` CLDR plurals, non-concatenation, translator notes, English-only agent surfaces,
  the same-key dialog button rule, `en-XA`, pack format, D15, and D16 with links to the implementation.
- `doc/agents-common.md` links the new standard from its Documentation Map; `coding-style.md` links
  it from a relevant coding-guidance location.
- The local ESLint rule covers every listed UI position, ignores the stated exemptions, and reports
  at warning severity. `npm run lint` exits 0 and displays warnings for remaining hardcoded UI text;
  there is no max-warning threshold.
- `npm run i18n:check` exits 0 for the current tree, reports that `assets/languages/` has no built-in
  packs yet, and reports generated `en-XA` as valid. With packs present it reports missing and
  stale keys without failing, while invalid messages/packs and any built-in D16 mutation make the
  command exit non-zero.
- The checker accepts an optional user-pack directory argument and never writes pack files.
- No unit tests or harnesses are added. Acceptance is verified with exactly `npm run lint` and
  `npm run i18n:check` and their outcomes above.

### Files needing no changes

| File / area | Why |
|---|---|
| `src/shared/i18n/t.ts`, `src/shared/i18n/en/*.ts` | Existing typed catalog and runtime are the convention source; this task documents and consumes them. |
| `src/shared/i18n/pack.ts`, `validate-pack.ts`, `filter-pack.ts`, `hash.ts`, `load-packs.ts`, `pseudo-locale.ts` | Checker reuses these validators, D16 filter, hash, loader model, and pseudo-pack generator without changing runtime semantics. |
| `assets/languages/README.md` | Already documents schema version 1, names, messages, plural forms, placeholders, and source hashes. |
| `src/renderer/core/utils/format.ts` and all US-1650 files | Concurrent locale-formatting implementation; no i18n-check/lint requirement needs those changes. |
| Test suites and harnesses | Explicitly excluded; acceptance uses the two npm commands. |

## Files Changed

| File | Planned change |
|---|---|
| `doc/standards/localization.md` | New source-verified localization conventions. |
| `eslint.config.mjs` | Add the local hardcoded-UI-string rule at warning severity, following the existing local plugin pattern. |
| `scripts/i18n-check.mjs` | Node entry command that bundles/runs the TypeScript checker through esbuild. |
| `scripts/i18n-check-entry.ts` | Read pack files, validate/report missing/stale/invalid messages, run built-in D16 and generated en-XA checks. |
| `package.json` | Add `i18n:check` script. |
| `doc/agents-common.md` | Add localization standard to Documentation Map. |
| `doc/standards/coding-style.md` | Add a concise pointer to the localization standard. |
| `doc/active-work.md` | Link US-1651 under EPIC-124. |
| `doc/epics/EPIC-124.md` | Link the US-1651 task-table row to its task document. |

## Progress

- [x] 1. Added the source-verified localization standard and linked it from both developer guides.
- [x] 2. Added the warning-only hardcoded UI string rule with the specified positions and exclusions.
      `npm run lint` exits 0 and reports **1,124 new hardcoded UI string warnings**.
- [x] 3. Added the read-only `i18n:check` command and optional user-pack directory argument.
- [x] 4. Added complete generated `en-XA` validation to the checker.
- [x] 5. Verified the existing US-1651 links in the EPIC-124 dashboard and task table; added the
      localization pointers to the two developer guides.

Validation: `npm run typecheck`, the explicit strict typecheck of
`scripts/i18n-check-entry.ts`, `npm run lint`, and `npm run build-prod` pass. Running
`npm run i18n:check` is blocked in this sandbox because esbuild cannot spawn its service process
(`spawn EPERM`); the command and its implementation are in place, but the runtime check needs to
be run in the user's environment.
