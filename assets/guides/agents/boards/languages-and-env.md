---
title: "Boards — languages and env vars"
audience: agent
summary: "Make a board translatable (language packs, i18n.t) and provision secrets outside the board folder with environment variables."
---

# Boards — languages and env vars

## Languages

For app language packs, follow <!-- board-template:exclude -->[`guides.agents.languages`](../languages.md)<!-- /board-template:exclude -->. The instructions below cover board language files.

A board declares its packs in `board-manifest.json` and keeps one `<code>.json` file in the pack
folder per language:

```json
{
  "minBridgeVersion": "1.36.0",
  "languages": { "folder": "lang", "default": "en" }
}
```

Each file has a `messages` object. Keys are stable English identifiers; values are strings or CLDR
plural objects. The optional `source` field is metadata for authors and translators; Persephone
currently ignores it.

```json
{
  "messages": {
    "welcome.title": "Welcome",
    "items.count": { "one": "{count} item", "other": "{count} items" }
  }
}
```

Call `persephone.i18n.t(key, params)` for UI text and `persephone.i18n.has(key)` to check whether
any loaded pack contains a key. Keep `{name}` placeholder names identical across translations.
For plurals, provide the target locale's CLDR categories, including `other`, and pass a numeric
`count`. Keys, `.app` member names, settings keys, and other agent-facing identifiers stay English.

Persephone loads only the current locale, its base locale, and the declared default pack. Lookup
falls back per key in that order, then returns the key. `persephone.locale.code` gives the app
locale, including regional codes such as `pt-BR` and the verification locale `en-XA`. Registration
loads the locale once; changing the app language reloads the window and registers boards again.
Pass `persephone.locale.code` to third-party libraries that accept a locale option.

English manifest values stay in `board-manifest.json`; they do not need `manifest.*` keys in the
default pack. A translated pack can add plain-string `manifest.*` entries to localize `name`,
`description`, `editorName`, `views.<id>.title`, `settings.<key>.label` / `.description`, and
`capabilities.<id>.title`. Keep the IDs in these keys stable. Manifest entries cannot have
placeholders or plural forms. They are full flat keys inside `messages`, beside the board's own
keys — for example `lang/uk.json`:

```json
{
  "messages": {
    "welcome.title": "Ласкаво просимо",
    "items.count": { "one": "{count} елемент", "few": "{count} елементи", "many": "{count} елементів", "other": "{count} елемента" },
    "manifest.name": "Мій борд",
    "manifest.views.notes.title": "Нотатки",
    "manifest.settings.apiUrl.label": "Адреса API"
  }
}
```

Invalid pack entries are ignored and validation warnings are written to the board's `ui.log`.
Inspect that log after opening the board. Open it under `en-XA` to check extraction: board-pack
strings and translated manifest display values become pseudo-text; remaining user-visible English
copy has not been extracted. Data and agent-facing names remain unchanged.

**Make a board translatable.** Declare `languages`, set `minBridgeVersion: "1.36.0"`, move
user-visible copy into `lang/en.json`, and replace it with `persephone.i18n.t()` calls. Add
translated `manifest.*` entries only to translated packs, then check the board under `en-XA` and
inspect `ui.log`.

**Add a language to an existing board.** Read its declared default pack first, then create
`lang/<code>.json` with the same stable message keys and translated values. Preserve placeholders,
provide the target locale's CLDR plural categories, and add applicable translated `manifest.*`
entries using the existing IDs. Before you finish, compare the new pack with the default pack
yourself: the same keys (no extra ones), the same `{placeholder}` names in every message, and an
`other` form in every plural. Persephone validates a pack only when the app runs in that language
— it then drops bad entries and lists them in `ui.log` — and switching the app language reloads
every window, so ask the user before you change it, or leave the on-screen check to them.

## Give the board its secrets — env vars

A board should never store secrets (connection strings, API keys, passwords) in its own folder —
they'd leak the moment the board is copied, shared, or committed. Persephone keeps a single,
optionally-encrypted `.env.json` file **outside every board folder**, namespaced per board.

**Provision values before the board needs them (you, with `call` on `boardVars`):**

```text
boardVars.namespaceFor(boardRoot)      -> namespace: author/name, or the root path
boardVars.set(namespace, "SNOWFLAKE_SERVER", "abc123.snowflakecomputing.com")
boardVars.list(namespace)              -> key names in the namespace
boardVars.listNamespaces()             -> every namespace in the file
boardVars.show(namespace)              -> open the built-in editor, focused there
```

The namespace uses the trimmed, non-empty `author` + `name` identity pair when both fields are
present. Otherwise it uses the board root (or `bundled:<folder-id>` for a bundled board), so a
blank author is valid and does not prevent board creation. Persephone-created boards use the
optional `boards.default-author` app preference; when it is empty, their manifest author is empty
and the root fallback remains intentional. If either identity field is later changed on a board
that already has variables, the old values stay under the old namespace and are orphaned. There is
no automatic migration; do not assume a trust toggle or restart copies them.

**This call can block on a dialog.** The first-ever `boardVars.*` call on a machine with no
`.env.json` configured shows the user a "Create environment variables storage" dialog (default
path, editable) — your call does not resolve until the user responds; declining
rejects it. The same applies if the file is encrypted and locked this session (a decrypt-password
prompt). Don't treat a slow-to-resolve call as a hang — it is waiting on the user. Always resolve
the namespace via `namespaceFor` rather than guessing the `author/name` string yourself.

**Read them back at runtime (the board itself, from `app.js`):**

```js
const server = await persephone.var.get("SNOWFLAKE_SERVER"); // this board's own namespace only
await persephone.var.set("SNOWFLAKE_USER", value);            // a board may write its own settings
const keys = await persephone.var.keys();                     // names in this board's namespace
await persephone.var.delete("OLD_TOKEN");
```

`persephone.var.*` is always scoped to the calling board — it can never read or write another
board's namespace. `keys()` returns the same key-name list as `list()`. All calls are async and can
reject (not configured / locked / user declined); handle rejection gracefully (e.g. show a
"configure your connection" prompt in the board's UI).
