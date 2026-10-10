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

For app-pack authoring and repair, see the [language-pack agent guide](../../assets/guides/agents/languages.md)
and the [shipped language glossary](../../assets/guides/agents/languages-glossary.md).

Language packs use schema version 1: BCP-47 `code`, localized `name`, English `englishName`,
optional `direction: "ltr"`, `messages`, and optional `source` hashes. See
[`assets/languages/README.md`](../../assets/languages/README.md) and the shape in
[`pack.ts`](../../src/shared/i18n/pack.ts). `source` records a hash of the corresponding English
message, calculated by [`hashEnglishMessage()`](../../src/shared/i18n/hash.ts); it supports finding
translations whose English source changed.

For runtime pack work, `app.languages` exposes the English catalog and installed packs to agents:
`english()` returns paged source entries with notes, placeholders and source hashes; `get()` reads
pack metadata or area messages; `missing()` and `stale()` audit translation coverage; and
`validate()` checks an app pack while `validateBoard()` checks a board pack without changing the
active locale. `save()` validates and atomically writes a user pack under the user data directory,
`delete()` removes a user pack, and `apply()` selects an available locale and schedules a reload of
all windows. User packs can supply translations for missing built-in entries or override them.
See the [language-pack agent guide](../../assets/guides/agents/languages.md) for the workflow and
the API declarations in [`languages.d.ts`](../../src/renderer/api/types/languages.d.ts) for the
complete contract.

[`createPseudoLocalePack()`](../../src/shared/i18n/pseudo-locale.ts) generates `en-XA` from the
English catalog. Use it to expose missed extraction and longer-label layout issues. It is generated
validation data, not a checked-in translated pack.

## Russian (D15)

Persephone ships no built-in Russian pack, and Monaco's Russian messages are not in the
`monaco-nls.ts` allow-list. Nothing in the loader or validator rejects or alters a Russian user
pack; it loads like any other pack. Roadmap D16 (scrambling Russian text) was withdrawn on
2026-10-10, so do not add code that inspects a pack's language or text.

## Phase 2 reference

### UI positions and lint coverage

`vanilla-view/no-hardcoded-ui-strings` checks the UI positions established by phase 2:

- `notify`, `confirm`, and `input` calls on the internal UI receivers (`ui`, `app.ui`,
  `services.ui`); direct `message` properties passed to `show*Dialog()`; and `emptyMessage`.
- `ariaLabel` / `aria-label`, `setAttribute("title" | "placeholder" | "aria-label", value)`, and
  the editor registry's display `name` in `src/renderer/editors/register-editors.ts`.
- The earlier label/title/placeholder/tooltip/children positions, text assignments, and known UI
  text helpers.

This visitor is a scan, not proof that a file has no remaining UI literals. Positional helper
arguments and defaults can be invisible to it: inspect arguments such as `settingsFieldLabel()`
and other local UI helpers, as well as descriptions, messages, and accessibility text. Keep checks
receiver- or file-scoped when property names also carry data. Exempt agent-only catalog data files
in ESLint with a rationale rather than adding inline disable comments.

### Display copy, English values, and identity

When a string serves both UI and agents, scripts, or persisted state, keep an English value and a
catalog key side by side (E2). Use `englishMessage(key)` for the durable/agent-facing value and
`t(key)` for display; this applies to editor names, Tools/sidebar registry labels, panel labels,
page titles such as Browser and About, and board permission lines. Use `untranslated("…")` only
when deliberate English data or a product/protocol name must occupy a UI text position.

Every translated menu item keeps a stable `id` so automation selects by identity across locales.
Built-in dialog buttons likewise retain and compare their stable `id`; the translated label is
presentation only. Keep custom caller labels and returned values as caller data.

### Catalog and component conventions

UIKit stays independent of the app catalog. Component defaults come from
`src/renderer/uikit/shared/uikit-text.ts` via `uikitText()`; Persephone supplies localized
overrides once with `setUikitText()` at startup. Explicit caller-provided text remains authoritative.

Monaco NLS uses the explicit language allow-list in `src/renderer/i18n/monaco-nls.ts` (`cs`, `de`,
`es`, `fr`, `it`, `ja`, `ko`, `pl`, `pt-BR`, `tr`, `zh-CN`, `zh-TW`). Unsupported languages keep
Monaco's English widgets; never construct a message-module path from a locale. Russian is not in the
list because no Russian pack ships (D15).

Keep each sentence in one catalog message with placeholders; do not assemble sentences from
translated fragments. Use CLDR plural category objects for counts. Every plural form must contain
the same placeholders, which `npm run i18n:check` enforces for `{count}`.

Resolve `t()` while building view props or rendering. Module-level translated constants can capture
the English fallback before the active language pack is ready. The pack validator in
[`validate-pack.ts`](../../src/shared/i18n/validate-pack.ts) checks the pack filename/code, known
keys, message forms and placeholders. Keep keys in the current flat shape and
include hashes for translated entries when maintaining a pack.
