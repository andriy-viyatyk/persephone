---
title: "app.themes"
audience: user
summary: "Inspect, derive, preview, and manage built-in and custom themes from scripts and MCP."
---

# app.themes

`app.themes` exposes built-in and saved custom themes as plain data. Returned definitions and
custom files are cloned, so editing a returned object does not mutate the live registry.

## Inspect themes

```javascript
const available = app.themes.list();
const persephone = app.themes.get("persephone");
const active = app.themes.current; // includes the preview definition, if one is active
```

`list()` includes selectable built-in and saved custom themes. `get(id)` returns `undefined` for an
unknown id. The reserved runtime id `preview` is available through `get()` only while a preview is
active and is never listed as a selectable theme.

## Derive and check contrast

```javascript
const draft = {
    schemaVersion: 1,
    name: "Ocean dusk",
    base: { background: "#10202b", text: "#e7f2f7", accent: "#45b6c8" },
    isDark: true,
    overrides: {},
};
const derived = app.themes.derive(draft.base, draft.isDark);
const report = app.themes.contrast(draft);
const definitionReport = app.themes.contrast(derived);
```

`contrast()` accepts a theme definition, a custom theme file, or a draft. A report maps each declared
foreground/background pair to its contrast ratio and `meetsAA` result.

## Fork a theme

```javascript
const forked = app.themes.fork("persephone");
forked.name = "Persephone blue";
forked.base.accent = "#5599ee";
```

`fork()` returns an **id-less draft** that preserves the source definition's colors. It does not
reserve an id; storage generates a unique id only when the draft is saved. Pass that draft directly
to `preview()` or `save()`.

To edit a saved custom theme as it was authored, read its stored file with
`app.themes.file(id)` instead. `fork()` rebuilds base colors from the finished palette, so every
optional base color and the dark/light mode become fixed values; `file()` returns the saved base
intent, `isDark` (including `null` for automatic), and overrides, with the theme's id. Saving that
file back with `save()` replaces the theme in place. `file()` returns `null` for built-in themes and
unknown ids.

## Preview, save, and restore

```javascript
const draft = app.themes.fork("persephone");
draft.name = "Warm graphite";
draft.base.accent = "#d78a55";
const contrast = app.themes.contrast(draft);
const preview = app.themes.preview(draft);
// Inspect it in this window, then keep it only when ready:
const saved = await app.themes.save(draft);
await app.themes.endPreview();
```

Preview is renderer-memory state local to one window. It writes no settings or files, survives
theme-file and settings-file reloads, and stays active until `endPreview()`, `app.themes.apply()`,
or an explicit selection such as the Settings picker or theme cycling. A window reload or app
restart ends it. `current` returns the preview definition with the draft name. A preview started
through a board ends when that board closes or reloads, unless a later preview or theme selection
has replaced it.

Saving only writes the custom theme file. It does not select that theme or end a preview. Saving a
draft without an id creates a theme and returns its canonical `CustomThemeFile` including the
generated id. Supplying an id replaces that existing custom theme only.

## Rename, delete, and apply

```javascript
const renamed = await app.themes.rename(saved.id, "Warm graphite v2");
await app.themes.apply(renamed.id); // applies immediately here and persists the selected id
await app.themes.delete(renamed.id); // deleting the selected custom theme selects persephone
```

`apply(id)` changes this window immediately and persists the selected theme id for other windows.
Only saved custom themes can be renamed or deleted. Deleting the selected custom theme uses the
existing storage behavior to persist the built-in `persephone` fallback.

## Export and import a custom theme file

Custom theme files are plain JSON. Use the saved file returned by `save()` for export, and pass a
parsed file back to `save()` to import or replace a theme.

```javascript
const saved = await app.themes.save(draft);
await app.fs.write("C:/themes/ocean-dusk.theme.json", JSON.stringify(saved, null, 2));

const imported = JSON.parse(await app.fs.read("C:/themes/ocean-dusk.theme.json"));
const canonical = await app.themes.save(imported);
```

Imported files with an id replace that existing custom theme; remove the `id` property to import as
a new theme with a generated id. Invalid files reject with a readable validation error.

## MCP and `app.call()`

MCP `call` and `app.call()` resolve the same `themes` namespace. For MCP, call the listed path and
provide method arguments in `args`:

```text
call themes.list
call themes.preview(args: [draft])   # caution: changes this window until ended or explicitly selected
call themes.endPreview
```

Equivalent script calls use the service directly:

```javascript
const list = await app.call("themes.list");
const preview = await app.call("themes.preview", { args: [draft] });
await app.call("themes.endPreview");
```

MCP marks `save`, `rename`, and `delete` as file mutations, `apply` as an appearance and settings
change, and `preview` as a window-local appearance change. Review the draft and contrast report
before previewing; save and apply only when requested.
