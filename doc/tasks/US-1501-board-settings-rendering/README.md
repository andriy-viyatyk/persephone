# US-1501 — Manifest `settings` declaration and Settings-page rendering

Linked epic: [EPIC-111 — Board settings](../../epics/EPIC-111.md)  
Status: Planned

The epic already links this task. Per the request for this task, `doc/active-work.md` and
`doc/epics/EPIC-111.md` remain unchanged.

## Goal

Add the manifest declaration and renderer-side normalization needed for boards to describe typed,
user-facing settings, then render each eligible board as a live Settings-page panel. Existing
boards must continue to use the current `VanillaView` Settings architecture, while board panels
must appear or disappear when the board registration surface changes.

## Background

### Current manifest and normalization contract

`src/renderer/editors/board/board-manifest.ts` currently parses manifests with
`readBoardManifest()` as best-effort JSON and casts the result to `BoardManifest`; individual
`normalize*` functions then validate the fields they consume. Those functions return safe
normalized values, drop entries they cannot understand, and do not throw. `hasStableBoardIdentity()`
already defines the reusable requirement that both `author` and `name` are non-empty trimmed
strings.

US-1500 has already added a function with the name `normalizeBoardSettings` in
`src/renderer/api/board-settings/board-settings-bridge.ts`, exported through
`src/renderer/api/board-settings/index.ts`. It currently normalizes setting declarations for the
board bridge and validates identity before reading the array. US-1501 must make that one function
the manifest-layer canonical normalizer, not add a second function with the same name:

- Move the declaration-shape/type/default/enum validation into
  `src/renderer/editors/board/board-manifest.ts`.
- Let the manifest normalizer accept an optional issue-reporting callback. The callback reports
  normalized-manifest problems without importing `custom-editor-registry.ts` back into the
  manifest layer and creating a runtime cycle.
- Have `custom-editor-registry.ts` map those reports to `CustomEditorRegistrationIssue` entries
  with a new `settings` kind. Keep a single identity issue for a manifest with a settings block
  but missing `author` and/or `name`; return no declarations before inspecting individual setting
  entries.
- Re-export the manifest function from `board-settings-bridge.ts` (and retain the existing
  `board-settings/index.ts` export) so the US-1500 board-facing code and future renderer code keep
  using the same API symbol.

The normalized declaration remains the current `BoardSettingDeclaration` shape from
`src/renderer/api/board-settings/types.ts`: `id`, `type`, `default`, optional `options`,
`format`, `label`, and `description`. `BoardSettingValue` remains the finite JSON scalar union
`string | boolean | number`.

### Required declaration behavior

The accepted manifest shape is:

```json
"settings": [
  {
    "id": "library-path",
    "type": "string",
    "format": "folderPath",
    "label": "Library folder",
    "description": "Folder for reusable board items",
    "default": ""
  }
]
```

The normalizer must implement S5 and S7 exactly:

- `type` accepts `string`, `boolean`, `number`, and `enum`.
- `enum` requires non-empty string `options`, and its string default must be one of those
  options. Other types require a default matching the declared type; numbers must be finite.
- `format` is an optional non-empty string retained for forward compatibility. `folderPath` is
  the only recognized format in this task. An unknown format is not an error and must fall back
  to the base type control in the renderer.
- Identity is checked with `hasStableBoardIdentity()` before the settings array is inspected. A
  settings-bearing manifest missing either identity field produces one registration issue naming
  the missing field(s), then contributes no declarations or Settings panel.
- Invalid declaration entries are dropped without throwing. Any diagnostics are aggregate
  registration warnings, never exceptions from manifest loading; an unknown `format` is not
  diagnosed because it is deliberately renderable.

Before → after for the canonical normalizer boundary:

```ts
// Before: the bridge owns a second parser/normalizer.
export function normalizeBoardSettings(manifest: unknown): BoardSettingDeclaration[] {
    // identity check, raw settings parsing, type/default/options validation
}

// After: one manifest-layer normalizer is shared by the registry and bridge.
export function normalizeBoardSettings(
    manifest: unknown,
    report?: (name: string, reason: string) => void,
): BoardSettingDeclaration[] {
    // hasStableBoardIdentity() first; then forgiving declaration normalization
}

// board-settings-bridge.ts preserves the existing API name by re-exporting/importing this one.
export { normalizeBoardSettings } from "../../editors/board/board-manifest";
```

### Current board source and registration behavior

`src/renderer/editors/board/custom-editor-registry.ts` already assembles the active source list
in `refresh()` from trusted roots and cached bundled boards, excluding ids in the
`disabled-bundled-boards` setting. It already subscribes to:

- `boardTrust.subscribePaths()` for trust/untrust changes;
- `bundledBoardRegistry.subscribe()` for bundled-board discovery/path changes; and
- `settings.onChanged` filtered to `disabled-bundled-boards` for disable/re-enable.

The registry currently throws away a source after `getBoardEditorAssociation(manifest)` returns
`null`, because its public state only serves custom-editor matching. That is why it cannot yet
answer which trusted or bundled non-editor boards declare settings. The source list must be
retained as a separate settings-bearing collection before the existing `if (!assoc) continue`.
The collection must use the same bridge-compatibility and disabled-source gates as the editor
registration loop. An installed but untrusted catalog board is not an active board surface and
must not contribute a panel; trusting it is covered by the existing trust subscription.

`getBoardEditorAssociation(manifest)` is already the S13 predicate: non-null means the board has
an editor association and belongs under `Editors`; `null` means it belongs under `Boards`. The
`Boards` group is added only when at least one active, identity-valid, settings-bearing board has
that null association. A disabled bundled board is absent from the source list before settings
normalization, so it contributes neither a panel nor a tree node.

### Current Settings page and reusable folder renderer

`src/renderer/editors/settings/SettingsView.ts` currently mounts the fixed
`SETTINGS_CATALOG` list once in `onMount()`. US-1497 and US-1498 are already reflected in the
current source: the page has a fixed Content `TreeView`, a scrolling panels element, per-section
wrappers named `settings-section-<id>`, click-to-scroll, and a scroll spy. The scroll and
navigability helpers currently iterate `SETTINGS_CATALOG` directly, so board panels must be added
to the same runtime section sequence without mutating the static catalog.

`src/renderer/editors/settings/settings-catalog.ts` is also consumed by
`src/renderer/scripting/ai-vision/namespaces/settings.ts` as the hand-written catalog of app
settings. Board declarations are not app settings and must not be copied into that static catalog.
The Settings view should combine its unchanged built-in descriptors with runtime board descriptors
locally, while the AI-vision app-settings catalog remains stable.

`LibraryPathSectionView` in
`src/renderer/editors/settings/sections/SettingsSections.ts` is already parameterized by a
`pathKey`, title, description, empty text, browse callback, and clear label. It is the existing
`string` + `folderPath` renderer used by `ScriptLibrarySectionView` and
`DrawingLibrarySectionView`; it is not a board-settings model. Refactor its configuration to use
value read/write/reset/subscription callbacks (supporting an async read where board values need
the bridge), keep the two app-setting subclasses working through adapters, and export/reuse the
same view for a board declaration with `type: "string"` and `format: "folderPath"`.

The current board-settings API already provides `setBoardSetting()`, `unsetBoardSetting()`, and
`subscribeBoardSettings()` in `board-settings-bridge.ts`, while `resolveBoardSettingsRequest()`
is the serialized effective-value read path. Add a renderer-only effective-value helper beside
those operations (or factor the common resolution into one helper) so Settings controls do not
interpret the `{ result, error }` transport reply themselves. Keep the board-facing method set
read-only (`get`); Settings is the renderer-only mutation surface.

## Implementation Plan

### 1. Canonicalize manifest settings normalization and diagnostics

- Update `src/renderer/editors/board/board-manifest.ts`:
  - Add the optional `settings` manifest field to `BoardManifest` without treating raw JSON as
    trusted typed data.
  - Move the existing declaration normalizer currently in
    `src/renderer/api/board-settings/board-settings-bridge.ts` into this layer and keep the
    exported name `normalizeBoardSettings` singular.
  - Check `hasStableBoardIdentity(manifest)` before reading the raw settings array. If a
    settings property is present and the identity is unstable, invoke the reporter once with a
    reason naming `author`, `name`, or both, and return `[]` immediately.
  - Normalize ids by trimming and discard empty/duplicate ids; retain only valid scalar defaults;
    deduplicate non-empty enum options and require an enum default to be present; retain optional
    non-empty `format`, `label`, and `description` strings.
  - Do not reject unknown formats. The returned declaration must retain the string so the
    renderer can choose the base type control.
  - Never throw for non-object entries, wrong field types, non-array `settings`, or malformed
    options. Use the reporter for useful declaration/array diagnostics where appropriate, but do
    not emit one field-level complaint for every setting after an identity failure.
- Update `src/renderer/api/board-settings/board-settings-bridge.ts`:
  - Remove its private `RawBoardSetting`, `isType`, declaration-normalization implementation.
  - Import the manifest-layer `normalizeBoardSettings` for `resolveDeclaration()` and re-export
    it to preserve the current `src/renderer/api/board-settings/index.ts` surface.
  - Keep the existing explicit identity error in `resolveDeclaration()` so a board that calls
    `persephone.settings.get()` still receives a rejected board-side request naming missing
    identity fields; the renderer registry path remains non-throwing.
  - Add the renderer-only effective-value read helper needed by Settings controls, reusing the
    same declaration/default validation and serialized request chain. Keep `setBoardSetting`,
    `unsetBoardSetting`, and `subscribeBoardSettings` as the mutation/reset/change seams.
- Update `src/renderer/editors/board/custom-editor-registry.ts` and the registration issue
  surface:
  - Extend `CustomEditorRegistrationIssueKind` with `settings`.
  - Map normalizer reports to `addRegistrationIssue(..., "settings", ...)`; do not throw from
    `refresh()` because a board manifest is malformed.
  - Update `src/renderer/api/types/board-info-editor.d.ts` and
    `src/renderer/editors/board-info/BoardInfoEditorView.ts` so the new warning kind is typed and
    displayed as “Settings”, rather than falling through to the current “Capability” label.

### 2. Retain active settings-bearing boards in the registration registry

- Add a registry entry type in `src/renderer/editors/board/custom-editor-registry.ts` containing
  the original `boardRoot`, display name, source origin, normalized declarations, and the
  `getBoardEditorAssociation(manifest)` result or an equivalent `isEditor` classification.
  Preserve the original root because it is the namespace/bridge identity input and because the
  existing board editor id convention carries the original path.
- Add a `settingsBoards` state field and getter. Populate it during the same `refresh()` pass that
  builds `entries`, after compatibility filtering and before the custom-editor `continue`:

  ```ts
  // Before: non-editors are discarded before any settings consumer can see them.
  const assoc = getBoardEditorAssociation(manifest);
  if (!assoc) continue;

  // After: settings are collected first; editor entries still keep their existing gate.
  const settings = normalizeBoardSettings(manifest, (name, reason) => {
      addRegistrationIssue(registrationIssues, root, "settings", name, reason, undefined);
  });
  if (settings.length > 0) settingsBoards.push({ boardRoot: root, ... });
  const assoc = getBoardEditorAssociation(manifest);
  if (!assoc) continue;
  ```

- Use the existing source order (trusted roots followed by active bundled records), bridge
  compatibility gate, and `disabled-bundled-boards` exclusion. Do not use
  `boardInstallRegistry.listInstalled()` as a settings source: a downloaded but untrusted board
  is not rendered or run. A newly trusted installed board appears through `boardTrust`; a bundled
  board appears or changes through `bundledBoardRegistry`; disable/re-enable already refreshes the
  same registry through `settings.onChanged`.
- Keep the existing registry refresh generation guard and synchronous state commit so Settings
  never observes a partial source rebuild. No manifest filesystem watcher is to be added.

### 3. Render one board panel with typed controls

- Add `src/renderer/editors/settings/sections/BoardSettingsSection.ts` as a framework-free
  `VanillaView` that receives a board root, display name, and normalized declarations.
- Render each declaration using existing UIKit primitives and tokenized settings helpers:
  - `string` with no recognized format → `InputView`;
  - `boolean` → `CheckboxView`;
  - `number` → a numeric `InputView`, committing only finite numeric values and restoring the
    effective value when an invalid edit is blurred;
  - `enum` → `SelectView` built from normalized `options`;
  - `string` + `format: "folderPath"` → the refactored `LibraryPathSectionView`, with the board
    root/id bound to the renderer-only read, set, unset, and change callbacks;
  - any other `format` → the base `type` control above, never an omitted panel.
- Use declaration `label` and `description` when supplied, with the id as the label fallback.
  Read effective values so an unset key displays the current manifest default; reset/unset must
  remove only the stored key and must not materialize the default in `board-settings.json`.
- Catch asynchronous reads, writes, resets, and folder-picker failures as `unknown` and use
  `errMessage(error, fallback)` for diagnostics. Do not hand-stringify caught values, add a new
  settings store, or add hardcoded colors. Own every subscription and child view through
  `VanillaView` lifecycle methods.
- Update `src/renderer/editors/settings/sections/SettingsSections.ts` so
  `LibraryPathSectionView` is reusable without assuming an app setting key. Its existing app
  subclasses must continue to adapt `settings.get/set` and `settings.onChanged` through the new
  callback configuration.

Before → after for the folder renderer’s dependency:

```ts
// Before: folder display and mutation are hard-wired to app.settings.
interface LibraryPathConfig {
    pathKey: "script-library.path" | "drawing.library-path";
    browse: () => Promise<void>;
}

// After: the same view renders either app-owned or board-owned folder values.
interface LibraryPathConfig {
    read: () => string | undefined | Promise<string | undefined>;
    subscribe: (listener: () => void) => () => void;
    browse: () => Promise<void>;
    reset: () => void | Promise<void>;
    // title, description, empty text, and clear label remain presentation inputs.
}
```

### 4. Add runtime board panels to the existing Settings tree and scroll model

- Update `src/renderer/editors/settings/SettingsView.ts`:
  - Keep `SETTINGS_CATALOG` as the unchanged built-in catalog, but build a runtime ordered
    descriptor list combining its sections with `customEditorRegistry.settingsBoards`.
  - Append board descriptors under `Editors` when their stored association is non-null; append
    non-editor board descriptors under a lazily-created `Boards` group. Do not create an empty
    `Boards` group.
  - Give every board panel and Content row a unique board-root-derived `data-name`/selection id;
    preserve all existing `settings-section-<id>` names for built-in wrappers. Keep board identity
    in the descriptor rather than deriving namespace from a display label.
  - Mount `BoardSettingsSectionView` for each dynamic descriptor, retain its wrapper/panel in the
    same maps used by the current scroll spy, and release/dispose removed board child views before
    replacing their DOM. Rebuild only the dynamic board portion when possible so built-in views
    and their app-setting subscriptions are not needlessly recreated.
  - Replace direct `SETTINGS_CATALOG` iteration in `firstVisibleSectionId()`,
    `topmostVisibleSectionId()`, `lastNavigableSectionId()`, and Content-tree construction with
    the combined runtime descriptor order. Preserve the existing programmatic-scroll suppression
    and selection-only scroll-spy behavior from US-1498.
- Subscribe the view to `customEditorRegistry.state`’s `settingsBoards` projection and own the
  disposer with `VanillaView`. This is the single appropriate live signal because the registry
  already composes `boardTrust.subscribePaths()`, `bundledBoardRegistry.subscribe()`, and the
  `disabled-bundled-boards` setting listener and commits one complete source snapshot. Do not add
  three duplicate subscriptions in `SettingsView`.
- On mount, call `customEditorRegistry.ensureInitialized()` before/alongside the first dynamic
  rebuild so the initial Settings page sees trusted and bundled sources. If initialization fails,
  retain the built-in page and report the caught value with `errMessage`; do not make Settings
  mount throw. On disposal, cancel/ignore any pending initialization callback and dispose the
  registry-state subscription, board child views, and existing scroll resources.
- The resulting live behavior must be:
  - trust an installed board → its panel and node appear;
  - untrust it → both disappear;
  - disable a bundled board → both disappear;
  - re-enable it → both return without restarting;
  - a board with no settings or an identity failure → neither appears.

### 5. Document the manifest-cache boundary

Do not add a watcher. `bundledBoardRegistry.refresh()` caches bundled manifests, and
`customEditorRegistry` refreshes only on trust-list changes, bundled-registry notifications, or
the disabled-bundled-boards setting. A direct edit to an already-cached manifest therefore does
not reach the renderer live. The first exit criterion must be phrased as “a board declaring
settings gets a Settings sub-page once it is trusted/installed”, not as live pickup of an on-disk
manifest edit.

After implementation, state this boundary in all three board-authoring/user surfaces:

- `assets/guides/boards.md`
- `assets/guides/agents/boards.md`
- `assets/board-template/CLAUDE.md`

This task document records the required statement; it does not write guide prose while the
implementation is still unstarted.

## Concerns / Resolved constraints

- **Two functions with the same normalization name:** resolved by moving the current bridge
  implementation into `board-manifest.ts` and retaining only a bridge/index re-export. There is
  one canonical declaration normalizer.
- **Identity diagnostics versus forgiving normalization:** identity is the one precondition that
  must be checked before the array, so the registry records one `settings` warning and drops the
  declaration set. Individual malformed entries follow the existing drop-and-continue pattern;
  unknown formats remain renderable.
- **Registry scope:** `customEditorRegistry.entries` cannot be used by itself because it excludes
  boards for which `getBoardEditorAssociation()` returns `null`. The new settings-bearing state is
  derived from the same active source snapshot, so S13 does not need a second board enumeration.
- **Disabled bundled boards:** disabling is a display-surface decision, not a trust/security
  check. Excluding the board before settings collection makes its panel and node disappear while
  leaving the existing board-facing trust/provenance behavior untouched.
- **Async settings controls:** effective reads and change callbacks are asynchronous at the bridge
  boundary. Each board section must guard stale async results during disposal/rebuild and serialize
  writes through the existing bridge/store queue.
- **Static catalog duplication:** `settings-catalog.ts` remains the fixed app-settings/AI-vision
  catalog. Runtime board descriptors are local to `SettingsView`; board settings are not inserted
  into `app.settings` or the hand-written app-setting rows.
- **UI constraints:** all new views remain `VanillaView` classes, use existing UIKit/theme tokens,
  and use `errMessage` for caught values. No unit tests or harnesses are part of this task.

## Acceptance Criteria

1. A trusted or active bundled board with a valid `settings` array and stable `author` + `name`
   gets one Settings sub-page/panel and one Content-tree node without a Persephone code change for
   that board.
2. `string`, `boolean`, `number`, and `enum` declarations render their corresponding controls;
   enum options/defaults are validated; `string` + `folderPath` reuses `LibraryPathSectionView`;
   an unknown format renders the base type control and never removes the panel.
3. A settings-bearing manifest missing `author` or `name` is rejected from rendering before its
   entries are inspected, produces one `CustomEditorRegistrationIssue` describing the missing
   identity field(s), and causes no panel or tree node. Board-side reads retain their explicit
   rejected error behavior.
4. A board with a non-null `getBoardEditorAssociation(manifest)` is under `Editors`; a board with
   a null association is under `Boards`; `Boards` is omitted when empty.
5. A disabled bundled board contributes no panel and no tree node; re-enabling it restores both
   live. Trusting/installing and untrusting the relevant board likewise add/remove both surfaces
   without restarting or rebuilding the whole application.
6. Settings-page rebuilds subscribe to the registry’s composed live state, dispose subscriptions
   and removed child views, preserve the existing static panels, and keep click-to-scroll and
   scroll-spy behavior correct for dynamic panels.
7. Reads use effective stored/default values; set and reset use the existing renderer-only bridge
   methods; defaults are not written into `board-settings.json`; change notifications update the
   visible control without a board reload.
8. Manifest edits made after the registry has cached a manifest do not claim to update live. The
   “once trusted/installed” boundary is recorded for `assets/guides/boards.md`,
   `assets/guides/agents/boards.md`, and `assets/board-template/CLAUDE.md` during implementation.
9. Existing built-in Settings sections remain reachable with their current `data-name` wrappers;
   no hardcoded colors, framework components, caught-value stringification, unit tests, or
   harnesses are introduced.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/editors/board/board-manifest.ts` | Add manifest settings shape and the single identity-first forgiving normalizer. |
| `src/renderer/editors/board/custom-editor-registry.ts` | Collect active settings-bearing boards, map normalizer reports to registration issues, and expose reactive settings state. |
| `src/renderer/api/board-settings/board-settings-bridge.ts` | Reuse/re-export the manifest normalizer and add the renderer-only effective read seam; preserve existing get/set/unset/change behavior. |
| `src/renderer/editors/board-info/BoardInfoEditorView.ts` | Display `settings` registration warnings with the correct label. |
| `src/renderer/api/types/board-info-editor.d.ts` | Add `settings` to the registration-issue kind union. |
| `src/renderer/editors/settings/SettingsView.ts` | Merge runtime board descriptors, mount/remove board panels, place tree nodes, and subscribe/dispose live registry state. |
| `src/renderer/editors/settings/sections/SettingsSections.ts` | Generalize/export `LibraryPathSectionView` for app and board value callbacks. |
| `src/renderer/editors/settings/sections/BoardSettingsSection.ts` | Add typed board setting controls and bridge-backed value/change/reset handling. |
| `assets/guides/boards.md` | State that manifest edits are cached and settings appear once the board is trusted/installed (after implementation). |
| `assets/guides/agents/boards.md` | State the same manifest-cache boundary for agent-facing board guidance (after implementation). |
| `assets/board-template/CLAUDE.md` | State the same authoring/runtime boundary in the copied board template guide (after implementation). |
| `src/renderer/api/board-settings/BoardSettingsStore.ts` | **No change:** US-1500’s renderer-owned store is reused. |
| `src/renderer/api/board-settings/types.ts` | **No change expected:** existing declaration/value/file/change types are sufficient. |
| `src/renderer/api/board-settings/index.ts` | **No implementation change expected:** retain the existing public exports through the bridge re-export. |
| `src/renderer/editors/settings/settings-catalog.ts` | **No change:** remains the static app-settings/AI-vision catalog. |
| `src/renderer/scripting/ai-vision/namespaces/settings.ts` | **No change:** board settings are not `app.settings` rows. |
| `doc/active-work.md` | **No change:** explicitly excluded. |
| `doc/epics/EPIC-111.md` | **No change:** explicitly excluded and already links US-1501. |
| Unit-test files and harnesses | **No change:** explicitly excluded. |

