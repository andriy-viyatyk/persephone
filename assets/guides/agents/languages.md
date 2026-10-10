---
title: Language packs
audience: agent
summary: Add or fix an interface language pack, update it after catalog changes, or validate a board translation.
---

# Language packs

## Purpose and pack layers

A language pack is a partial set of translations for known English catalog keys. Resolution is per key: user pack, built-in pack, then English. A user pack with a built-in code contains only user data, so it can override one message without copying the built-in pack. Saving does not activate a pack.

Agent guides, MCP `$help`, and other agent-facing text stay in English (D3). This is a workflow guide, not text to translate.

## Before translating

1. Read [`guides.agents["languages-glossary"]`](languages-glossary.md). Use the target language's familiar interface register, and keep names listed under **Stays English** unchanged. If there is no table for this language, draft the core interface and workspace terms and ask the user to approve them before translating whole areas. Record approved terms in the pack task's working context; an installed agent cannot edit the shipped glossary.
2. List the catalog areas and counts with the paired calls below. The catalog has about 1,500 messages across 19 areas. Read `english()` in pages: an MCP `call` result defaults to 20,000 characters, and each `english()` page is capped at 200 entries. The default page size is 100. Read each entry's `note` when present; preserve each exact key and placeholder name, and copy its `sourceHash` into the pack's `source` map.
3. For a plural message, get the target locale's categories from `Intl.PluralRules(code).resolvedOptions().pluralCategories`. Supply those categories and `other`. The validator accepts only `zero`, `one`, `two`, `few`, `many`, and `other`, and checks that every supplied form has the same placeholders. It does not check that all locale categories or `other` are present. Runtime selection uses the locale category, then the pack's `other`, then English. Validation is structural; it does not establish completeness or translation quality.

## API calls and returned fields

For MCP, `path` names the method and `args` is a JSON array in signature order. Pass objects as JSON values, not variable-name strings. Each pair below shows the exact MCP path and arguments beside its script form.

| Method | Result fields |
|---|---|
| `areas()` | Array of `{ area, count }` |
| `english(area, options?)` | `{ area, total, offset, entries, next? }`; each entry has `{ key, message, placeholders, note?, sourceHash }` |
| `get(code)` | Metadata `{ code, name, englishName, builtIn, user, overridesBuiltIn, counts: { user, builtIn, total } }`, or `undefined` |
| `get(code, area, options?)` | `{ area, total, offset, entries, next? }`; each entry has `{ key, message, from }`, where `from` is `user` or `builtIn`, or `undefined` |
| `missing(code, area?)` | `{ code, area?, keys, count, warning? }` |
| `stale(code, area?)` | The audit fields above plus `unverified` |
| `validate(pack)` | `{ valid, pack?, warnings }`; it does not write |
| `validateBoard(boardRoot, code)` | `{ boardRoot, code, defaultCode, valid, warnings, missing }`; it does not change the app locale |
| `save(pack, options?)` | `{ code?, path?, saved, warnings }` |
| `apply(code)` | `{ code, scheduled: true }`; every window reloads |

```text
MCP call: path "languages.areas", args []
Script:   app.languages.areas()

MCP call: path "languages.english", args ["settings", { "offset": 0, "limit": 100 }]
Script:   app.languages.english("settings", { offset: 0, limit: 100 })

MCP call: path "languages.get", args ["uk", "settings", { "offset": 0, "limit": 100 }]
Script:   await app.languages.get("uk", "settings", { offset: 0, limit: 100 })

MCP call: path "languages.validate", args [{ "schemaVersion": 1, "code": "uk", "name": "Українська", "englishName": "Ukrainian", "messages": { "common.ok": "Гаразд" } }]
Script:   app.languages.validate(packFragment)

MCP call: path "languages.save", args [{ "schemaVersion": 1, "code": "uk", "name": "Українська", "englishName": "Ukrainian", "messages": { "common.ok": "Гаразд" } }, { "merge": true }]
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
Script:   await app.languages.apply("uk") // Ask the user before this call.
```

## Workflow A — add a language, area by area

1. Choose an API-supported language code and pack metadata: `schemaVersion: 1`, `code`, native `name`, English `englishName`, and `messages`. `direction: "ltr"` is optional and only applies when appropriate.
2. Before the first save, `missing(code)` returns `keys: []` and `warning: "No pack for <code>"`. This is expected and does not mean the catalog is complete. Start with one translated area: validate its fragment, resolve every warning, and save it with `{ merge: true }`. `save()` validates again and refuses to write if there is any warning.
3. Add one area at a time. Save each area so a lost session costs at most that area's work. Once the pack exists, use `missing(code)` to see remaining keys and resume there. Write UTF-8, then read the saved area back with `get(code, area)` and inspect for literal `?`, replacement characters (`U+FFFD`), or garbled text.

### Complete example: two Estonian messages

This example translates `common.ok` and the plural `common.items`. Estonian uses `one` and `other`; both plural forms preserve `{count}`. First page through the English source and copy its `sourceHash` values. These hashes are for the current English messages shown below.

```ts
// Script: inspect the source first; read each entry's note if present.
const source = app.languages.english("common", { offset: 0, limit: 100 });
// MCP call: path "languages.english", args ["common", { "offset": 0, "limit": 100 }]
// Relevant returned entries:
// { key: "common.ok", message: "OK", placeholders: [], sourceHash: "85e4b82f" }
// { key: "common.items", message: { one: "{count} item", other: "{count} items" },
//   placeholders: ["count"], sourceHash: "f6907d4a" }
```

Create the matching fragment for the script call; the MCP call passes the same object as a JSON value:

```ts
const packFragment = {
  schemaVersion: 1,
  code: "et",
  name: "Eesti",
  englishName: "Estonian",
  messages: {
    "common.ok": "Sobib",
    "common.items": { one: "{count} üksus", other: "{count} üksust" },
  },
  source: {
    "common.ok": "85e4b82f",
    "common.items": "f6907d4a",
  },
};
```

Validate, resolve every warning, merge-save, then read the saved area back:

```text
MCP call: path "languages.validate", args [{ "schemaVersion": 1, "code": "et", "name": "Eesti", "englishName": "Estonian", "messages": { "common.ok": "Sobib", "common.items": { "one": "{count} üksus", "other": "{count} üksust" } }, "source": { "common.ok": "85e4b82f", "common.items": "f6907d4a" } }]
Script:   app.languages.validate(packFragment)

MCP call: path "languages.save", args [{ "schemaVersion": 1, "code": "et", "name": "Eesti", "englishName": "Estonian", "messages": { "common.ok": "Sobib", "common.items": { "one": "{count} üksus", "other": "{count} üksust" } }, "source": { "common.ok": "85e4b82f", "common.items": "f6907d4a" } }, { "merge": true }]
Script:   await app.languages.save(packFragment, { merge: true })

MCP call: path "languages.get", args ["et", "common"]
Script:   await app.languages.get("et", "common")
```

Check the returned page's `entries` for both keys, messages, and `from: "user"`; confirm the Estonian characters survived the UTF-8 round trip. `validate()` returns `valid`, optional normalized `pack`, and `warnings`; `save()` returns `saved`, optional `code` and `path`, and `warnings`. A warning prevents the write.

## Workflow B — fix one message

1. Read the English entry and its note, then read the current translated message. Keep the exact key, placeholders, plural forms, and current source hash.
2. Submit a fragment containing just that message. Validate it, then save with `{ merge: true }` so other user translations remain. This also works for a built-in code: the user layer overrides only the submitted key.
3. Read that area back with `get(code, area)` and verify the key and text.

## Workflow C — update after an app update

1. Call `missing(code)` to find untranslated keys and `stale(code)` to find translations whose source hashes changed. `stale()` returns `unverified` separately for translated messages with no saved hash; those messages are not reported as stale.
2. Read the affected current English entries and notes. Add or revise translations and copy current `sourceHash` values.
3. Validate, merge-save, and read back the affected area. Resolve every warning before saving.

## Workflow D — add a language to a board

Follow **Languages** in [`guides.agents.boards`](boards.md) for the board's `lang/<code>.json` format and its message rules. Read the board's `board-manifest.json` for `languages.folder` and `languages.default`, read the default pack, then write `<folder>/<code>.json` with the same message keys.

A translated pack also carries `manifest.*` keys that the default pack does not have: `manifest.name`, `manifest.description`, and the display titles of views, capabilities, and settings (for example `manifest.views.<id>.title`). They translate the English values in `board-manifest.json`, so their absence from the default pack is expected and not a defect.

Then call `validateBoard(boardRoot, code)`. `warnings` lists unknown keys, placeholder mismatches, and invalid messages; resolve every one. `missing` lists default-pack keys the pack does not translate; those fall back to the default language, so they do not make the pack invalid, but a complete translation has none. You do not need your own comparison script. `save()` writes only user app packs; do not use it for a board file.

## See the result

`apply(code)` accepts `auto`, `en`, or a code with an available pack (`en-XA` is accepted only in development). It saves the language setting and returns `{ code, scheduled: true }`, then reloads every open window, including the calling one. Ask the user before calling it. Use `validate()` and `validateBoard()` for checks that do not switch the locale. Saving alone does not apply the pack.

## Writing quality and encoding

Use the target language's normal interface register and courtesy level. Keep labels short; German text can be roughly 30% longer than English. Use the language's punctuation and quotation marks, preserve shortcut placeholders exactly, and do not add HTML. Save as UTF-8 and always read each area back with `get(code, area)`; check for literal `?`, `U+FFFD`, or mojibake before considering it done.

These steps apply to any language accepted by the API, whether or not Persephone ships a built-in pack.
