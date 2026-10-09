# Localization

## Add a UI message

Add each English source message to the relevant flat area catalog in
[`src/shared/i18n/en/`](../../src/shared/i18n/en/), using one semantic entry name per string.
Import `t` from [`src/shared/i18n/t.ts`](../../src/shared/i18n/t.ts) at the UI call site:

```ts
// Before
label: "OK"

// After
label: t("common.ok")
```

The supported key shape is currently `<area>.<entryName>` (for example `common.ok`), as derived
by [`en/index.ts`](../../src/shared/i18n/en/index.ts) and resolved by `t.ts`. Deeper roadmap
examples such as `settings.theme.title` are illustrative only; the current type and runtime do not
accept nested keys. A nested-key change needs a separate scope decision.

Use `{name}` placeholders for interpolated values. Keep a whole sentence in one catalog message
instead of concatenating sentence fragments. For counts, use a CLDR category object and pass the
numeric value as `params.count`; category selection uses
[`Intl.PluralRules`](../../src/shared/i18n/plurals.ts):

```ts
// Catalog entry
items: { message: { one: "{count} item", other: "{count} items" }, note: "A count of items." }

// UI call site
t("common.items", { count: itemCount })
```

When translators need context, put it beside the source message using the existing optional
`note` property: `{ message: "...", note: "..." }`.

## English text for agents and durable developer surfaces

D3 keeps agent-facing and durable developer text in English. This includes `$help`, script API
help and errors in [`src/renderer/scripting/api-wrapper/`](../../src/renderer/scripting/api-wrapper/),
AI-vision adapters in [`src/renderer/scripting/ai-vision/`](../../src/renderer/scripting/ai-vision/),
MCP handlers in [`src/main/mcp/`](../../src/main/mcp/) and
[`src/renderer/api/mcp/`](../../src/renderer/api/mcp/), script API declarations in
[`src/renderer/api/types/`](../../src/renderer/api/types/), runtime logs, guides, What's New, and
AI-vision text. UI controls inside the Log View remain localizable.

When an agent-facing consumer and UI share extracted copy, use the same catalog key: UI calls
`t(key)` and the agent-facing consumer calls `englishMessage(key)` from `t.ts`. For dialog buttons,
the visible label is translated with that shared key, while the stable button id and agent-facing
text remain English. The id is the button's English identity; it is separate from its visible
label.

## Packs and pseudo-locale

Language packs use schema version 1: BCP-47 `code`, localized `name`, English `englishName`,
optional `direction: "ltr"`, `messages`, and optional `source` hashes. See
[`assets/languages/README.md`](../../assets/languages/README.md) and the shape in
[`pack.ts`](../../src/shared/i18n/pack.ts). `source` records a hash of the corresponding English
message, calculated by [`hashEnglishMessage()`](../../src/shared/i18n/hash.ts); it supports finding
translations whose English source changed.

[`createPseudoLocalePack()`](../../src/shared/i18n/pseudo-locale.ts) generates `en-XA` from the
English catalog. Use it to expose missed extraction and longer-label layout issues. It is generated
validation data, not a checked-in translated pack.

## D15 and D16 safeguards

D15 rejects packs whose code is `ru` or starts with `ru-`, and packs whose localized or English
language name is a blocked Russian name. No built-in Russian pack is allowed.

D16 runs on non-built-in packs in [`load-packs.ts`](../../src/shared/i18n/load-packs.ts), through
[`filter-pack.ts`](../../src/shared/i18n/filter-pack.ts). It detects blocked whole words by
hashing normalized words and replaces hash matches. It also checks the message set for a Russian
letter signature: when both marker letters and companion letters occur outside placeholders, it
scrambles the configured Russian letters throughout that user pack. Built-in packs are not
filtered at runtime; they must pass the checker’s no-false-hit gate, which rejects a built-in pack
if applying D16 would change any message.

The pack validator in [`validate-pack.ts`](../../src/shared/i18n/validate-pack.ts) checks the pack
filename/code, known keys, message forms, placeholders, and D15 restrictions. Keep keys in the
current flat shape and include hashes for translated entries when maintaining a pack.
