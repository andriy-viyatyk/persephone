# US-1440: Clipboard settings

Epic: [EPIC-104: Clipboard tracker](../../epics/EPIC-104.md)

## Goal

Add the settings that gate EPIC-104: an opt-in `clipboard.enabled` toggle, a bounded integer
`clipboard.max-items` cap defaulting to 100, and a persistent warning that clipboard captures may
leave secrets on disk in readable form. The change must be self-contained and compile before the
clipboard watcher, capture service, or sidebar panel tasks exist.

## Background

### Settings storage and file comments

`src/renderer/api/settings.ts` owns the `AppSettingsKey` union, the default state, JSON5 file
loading, and the `settingsComments` map. `Settings.loadSettings()` creates the effective state with
`{ ...defaultAppSettingsState.settings, ...content }`, so a missing key restores its default, but a
present invalid value currently overrides the default without validation. `Settings.get()` returns
the stored state value, and `Settings.set()` writes the value, emits `onChanged`, and schedules a
save.

The doc comment immediately above `settingsComments` says those comments are for a human or AI
agent configuring Persephone from the settings file without seeing the Settings UI. Each new
comment must therefore state the setting's purpose, accepted value, default, and the security or
runtime behavior that is not obvious from assigning a value.

Current relevant shapes in `src/renderer/api/settings.ts`:

```ts
// Before
export type AppSettingsKey =
    | "mcp.enabled"
    | "mcp.port"
    | "main.scripting.enabled"
    // ...

const defaultAppSettingsState = {
    settings: {
        "mcp.enabled": false,
        "mcp.port": 7865,
        // ...
    },
};

// After
export type AppSettingsKey =
    | "mcp.enabled"
    | "mcp.port"
    | "clipboard.enabled"
    | "clipboard.max-items"
    | "main.scripting.enabled"
    // ...

const defaultAppSettingsState = {
    settings: {
        "mcp.enabled": false,
        "mcp.port": 7865,
        "clipboard.enabled": false,
        "clipboard.max-items": 100,
        // ...
    },
};
```

Add both keys to `settingsComments` with file-facing comments. The `clipboard.max-items` comment
must say that only integers from 1 through 1000 are accepted and any other stored value falls back
to 100;
the `clipboard.enabled` comment must say that the tracker is off by default and that enabling it
causes clipboard content to be recorded for the history feature.

### Invalid numeric settings and the fallback boundary

The existing numeric settings establish the current validation boundary:

- `src/renderer/editors/settings/sections/McpSectionModel.ts` methods
  `handlePortBlur()` and `handleMnemePortBlur()` parse the editable strings and only call
  `settings.set()` for ports in the 1024–65535 range. Otherwise they restore the model field from
  the current props.
- `src/renderer/editors/settings/sections/BrowserProfilesSectionModel.ts` method
  `handleTorPortBlur()` follows the same parse-and-restore pattern for `tor.socks-port`.
- `src/renderer/api/settings.ts` method `loadSettings()` does not validate any of those values
  when reading the file. It simply overlays file content on defaults.
- `src/renderer/api/app.ts` methods in `initServices()` read `mcp.port` and `mneme.port` directly
  and pass `port || undefined` to the service starters. The application layer does not normalize
  an invalid nonzero stored port.

Recommendation for this task: keep the fallback at clipboard setting call sites, matching the
existing UI-owned validation pattern, rather than changing the generic settings loader. Put the
renderer-side predicate in one reusable helper in the renderer settings API (for example, a named
`normalizeClipboardMaxItems` function taking `unknown`) so the Settings section and the
renderer-side portion of the future US-1439 capture service use the same rule. Any main-process
clipboard code must receive an already-normalized number through its start/update boundary, the
same way `src/renderer/api/app.ts` reads `mcp.port`/`mneme.port` and passes the plain values to
main-process service starters; it must not import a renderer module or read settings itself. The
helper should return the value only when `typeof value === "number"`, `Number.isInteger(value)`,
`value >= 1`, and `value <= 1000`; otherwise it returns 100. Do not use `parseInt()` for the stored
value, because fractional numbers, numeric strings, `NaN`, zero, negative values, and values above
1000 must all fall back rather than being partially accepted. Do not make `settings.get()` globally
normalize values: current consumers of the existing port settings demonstrate that this is not the
repository's generic settings contract.

The upper bound of 1000 is an explicit disk-retention and future-panel-rendering guard: it permits
ten times the default history while preventing a malformed or accidental setting from requesting
an unbounded million-item history. D11 still makes item count, rather than a byte ceiling, the
user-controlled limit.

The UI blur validation and the stored-value normalizer are separate checks enforcing the same
1–1000 range. With the planned `Number(...)` conversion, an emptied input yields `Number("") === 0`,
which fails the range and restores the previous safe value instead of persisting; that is intended.

This preserves the distinction between the raw file setting and a safe clipboard-reader value while
ensuring no clipboard consumer can receive an invalid cap. A value entered in the new Settings UI
should be rejected on blur and the displayed field restored to the current safe value; a malformed
value edited directly into JSON5 must not throw or make the section unusable.

### Settings section composition

The prompt's `SettingsSections.ts` registry reference does not match the current source. The
verified composition registry is `src/renderer/editors/settings/SettingsView.ts`, whose
`SettingsView.onMount()` imports each section and calls `appendSection()` in fixed display order.
`src/renderer/editors/settings/sections/SettingsSections.ts` is a collection of section classes and
the local `sectionHeader()` helper, not the registry itself. `McpSection.ts` and
`McpSectionModel.ts` are the closest implementation shape: the model owns controlled input state,
dependency gates, setting mutations, and blur validation; the view owns the `CheckboxView`,
`InputView`, model driver, setting-change subscription, and synchronization.

Current MCP shape in `McpSectionModel.handlePortBlur()`:

```ts
// Before
const port = parseInt(this.state.get().portValue, 10);
if (port >= 1024 && port <= 65535) settings.set("mcp.port", port);
else this.setPortValue(String(this.props.mcpPort));

// After, for the clipboard model
const value = Number(this.state.get().maxItemsValue);
if (Number.isInteger(value) && value >= 1 && value <= 1000) settings.set("clipboard.max-items", value);
else this.setMaxItemsValue(String(normalizeClipboardMaxItems(this.props.clipboardMaxItems)));
```

The new section should use a stable wrapper name `settings-section-clipboard`, with a visible
section title of `Clipboard`. No new CSS is needed: `settings.css` already makes
`[data-type="settings-section"]` a display-contents root and `SettingsView.appendSection()` supplies
the named wrapper and width. Use existing `panel`, `text`, `CheckboxView`, and `InputView`
patterns.

### Warning component and design constraints

`src/renderer/uikit/Notification/NotificationView.ts` already renders a static inline banner when
given `type: "warning"` and no `onClose`. Its `updateClose()` path creates a close control only
when `onClose` exists, and `Notification.css` maps warning background, text, border, and hover
states to the existing `color.warning.*` CSS variables. The Clipboard section should construct a
`NotificationView` with the D10 message, omit `onClose`, mount it as part of the section, and import
no color or create any new component/token. The warning copy must explicitly communicate that
occasionally-copied secrets may remain on disk in readable form.

### Agent-visible Settings catalog

`src/renderer/scripting/ai-vision/namespaces/settings.ts` maintains a separate, hand-written
`SETTINGS_CATALOG`. Its `SETTINGS_ELEMENTS` and `highlightSettingsElement()` derive setting-key
targets from that catalog, so the new section needs an entry there as well as in the visual page.
The current catalog has 14 sections and the help text says so; the new Clipboard section adds two
rows and changes those verified counts to 15 sections and 27 rows. The new catalog entry must use
the same `elementName` as the SettingsView wrapper and list both clipboard keys with their labels
and purposes.

## Implementation Plan

1. Update `src/renderer/api/settings.ts`.

   - Add `"clipboard.enabled"` and `"clipboard.max-items"` to `AppSettingsKey`.
   - Add file-facing comments to `settingsComments`, including the readable-on-disk warning and
     the accepted 1–1000 integer/default-fallback contract.
   - Add `"clipboard.enabled": false` and `"clipboard.max-items": 100` to
     `defaultAppSettingsState.settings`.
   - Add a renderer-side `normalizeClipboardMaxItems(value: unknown): number` helper, or an
     equivalently named renderer settings helper, with the exact 1–1000 integer predicate described
     above. Keep `Settings.loadSettings()`'s generic merge behavior unchanged; renderer consumers
     must invoke the helper when they need a safe cap, and any main-process consumer must receive
     the already-normalized number through its start/update boundary.

2. Add `src/renderer/editors/settings/sections/ClipboardSectionModel.ts` by following the model
   lifecycle used by `McpSectionModel`.

   - Define props for `clipboardEnabled: boolean` and the safe numeric `clipboardMaxItems` value.
   - Keep a controlled string state for the input, initialize it in `init()`, and use a
     `DepsGate` in `setProps()` so an external settings-file edit refreshes the field.
   - Implement `setMaxItemsValue()`, `handleToggle()`, and `handleMaxItemsBlur()`; the toggle must
     call `settings.set("clipboard.enabled", ...)`, and the blur handler must persist only an
     integer from 1 through 1000 and otherwise restore the normalized current value. Its empty
     input path must retain the intended `Number("") === 0` rejection behavior.
   - Provide the default state required by `createComponentModelDriver`, and dispose the model in
     the same way as the MCP model. Do not add clipboard capture, IPC, filesystem, watcher, or
     panel behavior here; those belong to later epic tasks.

3. Add `src/renderer/editors/settings/sections/ClipboardSection.ts`.

   - Create a `ClipboardSectionView` rooted with `createSectionRoot("settings-section")`.
   - Build its props from `settings.get("clipboard.enabled")` and
     `normalizeClipboardMaxItems(settings.get("clipboard.max-items"))`.
   - Render the `Clipboard` header/description, a controlled `CheckboxView` labeled to enable
     clipboard history, an `InputView` for the maximum item count, and a static
     `NotificationView({ type: "warning", message: "...readable form..." })` without `onClose`.
   - Use the existing model driver and subscribe to `settings.onChanged` for both keys. On a
     relevant change, update model props and synchronize the checkbox/input without recreating the
     whole section.
   - Use existing theme-backed UI primitives only. Do not add a stylesheet, hardcoded color, or
     color token.

4. Register the visual section in `src/renderer/editors/settings/SettingsView.ts`.

   ```ts
   // Before
   import { FileSearchSectionView } from "./sections/FileSearchSection";
   import { McpSectionView } from "./sections/McpSection";

   this.appendSection(new FileSearchSectionView({}), content, "settings-section-file-search");
   this.appendDivider(content);
   this.appendSection(new McpSectionView({}), content, "settings-section-mcp");

   // After
   import { ClipboardSectionView } from "./sections/ClipboardSection";

   this.appendSection(new FileSearchSectionView({}), content, "settings-section-file-search");
   this.appendDivider(content);
   this.appendSection(new ClipboardSectionView({}), content, "settings-section-clipboard");
   this.appendDivider(content);
   this.appendSection(new McpSectionView({}), content, "settings-section-mcp");
   ```

   Keep the new section in the same fixed-order region as the other service/data settings and use
   the exact wrapper name consumed by the AI-vision catalog.

5. Update `src/renderer/scripting/ai-vision/namespaces/settings.ts`.

   - Add a `clipboard` `SettingsCatalogSection` in the same order as the visual registry, with
     `title: "Clipboard"`, `elementName: "settings-section-clipboard"`, an accurate description,
     and rows for `clipboard.enabled` and `clipboard.max-items`.
   - Update the fixed-order/count wording from 14 sections/25 rows to 15 sections/27 rows. Keep
     `SETTINGS_ELEMENTS` derived from the catalog so `settings.highlight("clipboard.enabled")` and
     `settings.highlight("clipboard.max-items")` resolve to the wrapper.

6. Keep documentation follow-up explicit but deferred. The implementation will make these
   currently verified inventories stale and they should be updated by the epic's deferred
   completion skills, not by this task-document-only turn:

   - `doc/architecture/ui-element-contract.md`: add the Clipboard section selector.
   - `doc/architecture/scripting.md`: update the Settings catalog counts/description.
   - `assets/guides/screens/settings.md`: add Clipboard to the layout, selector table, and
     user-facing key mapping; describe the readable-on-disk warning and defaults.

## Concerns / Open Questions

- The fallback question is resolved: use call-site normalization, shared through a helper, because
  `McpSectionModel.handlePortBlur()`, `handleMnemePortBlur()`, and
  `BrowserProfilesSectionModel.handleTorPortBlur()` validate at UI boundaries while
  `Settings.loadSettings()` does not validate stored values. Do not reopen D11.
- The raw `settings.get("clipboard.max-items")` value may still be malformed after a direct JSON5
  edit or a generic `settings.set()` call. Every renderer-side clipboard reader, including the
  renderer portion of the future US-1439 capture service, must pass it through the shared
  normalizer before using it for eviction or allocation. Any main-process clipboard code receives
  the already-normalized number through its start/update boundary and must not import the renderer
  helper or read settings itself. The Settings section must normalize before constructing its
  numeric props.
- The UI blur validation and stored-value normalizer are intentionally separate checks of the same
  1–1000 range. `Number("") === 0`, so clearing the field restores the previous safe value rather
  than persisting zero.
- The setting is an item count limited to 1–1000, not a byte limit. Do not add a second storage
  ceiling; D11 deliberately accepts potentially large image files.
- The warning is intentionally static and non-dismissible. Omitting `onClose` is part of the
  contract; do not replace it with a toast or a closeable notification.
- The feature remains disabled by default. This task must not start a watcher, create a data
  directory, add IPC, add a sidebar icon, or implement capture/storage/panel behavior from the
  remaining EPIC-104 tasks.
- No test files or test harnesses should be added, per the task constraints. Verification should be
  compile/lint-level and by checking the settings page and manually edited JSON5 values once the
  implementation is made.
- Do not modify `doc/active-work.md`; its EPIC-104 entry already links US-1440 and is maintained by
  the user.

## Acceptance Criteria

- `AppSettingsKey` accepts both new keys, and missing keys resolve to `false` and `100` through the
  default state. Deleting either key from the settings file restores that default on reload.
- `settingsComments` writes useful comments for both keys above their JSON properties, including
  the 1–1000 accepted range, fallback to 100, and the readable-on-disk security implication.
- A malformed or out-of-range stored `clipboard.max-items` value (including zero, a negative
  number, a fraction, `NaN`, a string, `null`, an object, or a number above 1000) does not throw;
  the Clipboard section and any renderer-side clipboard reader use 100, while main-process code
  receives the normalized value at its start/update boundary. An integer from 1 through 1000 is
  preserved and displayed.
- The Settings page contains a fixed-order `Clipboard` section with wrapper
  `data-name="settings-section-clipboard"`, an unchecked-by-default enable control, and an item
  cap control defaulting to 100. Toggling or committing a valid cap persists through `settings.set`
  and updates the live controls through `settings.onChanged`.
- Invalid cap input is not persisted by the Settings UI; blur restores the safe current value.
- The section visibly contains a warning `NotificationView` with `type: "warning"` and no close
  action. Its message states that occasionally-copied secrets may remain on disk in readable form.
- `settings.sections`, `settings.elements`, and `settings.highlight()` expose both new keys and
  target the Clipboard section wrapper.
- The implementation introduces no hardcoded colors, new color tokens, new tests, clipboard
  watcher/capture/panel behavior, or changes to `doc/active-work.md`, and it compiles with the
  existing project toolchain.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/api/settings.ts` | Add keys, defaults, file comments, and the renderer-side shared cap normalizer. |
| `src/renderer/editors/settings/sections/ClipboardSectionModel.ts` | New model for controlled cap input, toggle mutation, and validation. |
| `src/renderer/editors/settings/sections/ClipboardSection.ts` | New Clipboard Settings view with controls and static warning. |
| `src/renderer/editors/settings/SettingsView.ts` | Register the Clipboard section and stable wrapper name. |
| `src/renderer/scripting/ai-vision/namespaces/settings.ts` | Add the section/key catalog and update counts. |
| `src/renderer/uikit/Notification/NotificationView.ts` | No change; use its existing warning/no-close behavior. |
| `src/renderer/uikit/Notification/Notification.css` | No change; existing `color.warning.*` tokens provide styling. |
| `src/renderer/editors/settings/sections/SettingsSections.ts` | No change; it is not the visual registry in the current source. |
| `src/renderer/uikit/Checkbox/CheckboxView.ts` | No change; use the existing controlled checkbox. |
| `src/renderer/uikit/Input/InputView.ts` | No change; use the existing controlled text input. |
| `src/renderer/editors/settings/settings.css` | No change; existing section-root/wrapper rules apply. |
| `doc/active-work.md` | No change; the user-owned EPIC-104 entry already exists. |
| `doc/epics/EPIC-104.md` | No change; D6, D9, D10, and D11 already govern this task. |
| Test files/harnesses | No change; prohibited by the task constraints and absent from this scope. |
