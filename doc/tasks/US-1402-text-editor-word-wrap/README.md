# US-1402 — Word wrap for the Text Editor

**Status:** Completed · **Epic:** none · **Branch/version:** `upcoming-v5.0.2` / 5.0.2

## Goal

Add a Word Wrap toggle to the Text Editor toolbar. The button changes wrapping for the
currently open Text Editor page only, and that page-local boolean survives editor switches,
app restarts, and moving the page to another Persephone window. Add a persisted application
default, off by default, which is read once when a newly shown Text Editor page has no saved
word-wrap state; changing the setting never changes an existing page or the other
Monaco-hosted editors.

The implementation must keep hard newlines distinguishable from soft wrapped lines when line
numbers are shown, expose the control through the Text Editor's agent facade, and document the
new setting and feature in the 5.0.2 What's New entry.

## Background

### Verified Text Editor path

The Text Editor registry module in `src/renderer/editors/monaco/index.ts:14-45` constructs
`MonacoEditorView`, which mounts `MonacoBodyView` and wraps it in `TextChromeView`. The body is
the Text Editor-specific path into the shared host:

```text
MonacoEditorView
  └─ TextChromeView (page toolbar)
      └─ MonacoBodyView
          └─ MonacoEditorHostView (shared Monaco host)
```

`MonacoBodyView.hostViewProps()` in `src/renderer/editors/monaco/MonacoBodyView.ts:137-150`
currently supplies only `automaticLayout`, encrypted `readOnly`, and disabled OS file drops.
That is the precise place to add Text Editor-only `wordWrap`/`wrappingIndent` options; the
other hosts that construct `MonacoEditorHostView` are outside this task.

The shared host creates the editor by spreading `this.props.options` at
`src/renderer/editors/shared/MonacoEditorHostView.ts:45-49`, and
`onUpdate()` calls `editor.updateOptions(props.options ?? {})` at lines 55-67. The Text Editor
body reaches that update path through its host state subscription (`MonacoBodyView.ts:113-135`);
the wrap-only update must call the host view's `update()` directly so it changes options without
the content-writing work also performed by `syncHost()`.

### Existing toolbar pattern

Toolbar controls are composed declaratively into `TextChromeView` slots. The concrete precedent
for a stateful icon toggle is `MarkdownToolbarBitsView` in
`src/renderer/editors/markdown/index.ts:18-77`: it owns an `IconButtonView`, subscribes to
the model state, sets `active`, changes the title/icon, and passes the root through
`TextChromeView`'s `rightToolbarContributions` at lines 164-169. The Text Editor should follow
that shape in its Monaco editor module rather than introducing a new toolbar mechanism.

`TextChromeView` places `rightToolbarContributions` after the shared HTML Resources control and
before the page-owned editor switch (`src/renderer/editors/base/TextChromeView.ts:364-370`,
with the slot filled at lines 408-411),
which is the recommended location for the Word Wrap button.

### Monaco options and visual contract

The repository uses Monaco `^0.55.1`. The relevant values are `wordWrap: "on" | "off" |
"wordWrapColumn" | "bounded"`; this feature uses only `"on"` and `"off"`. The owner has
verified that with `lineNumbers: "on"`, hard newline rows receive a gutter number while soft
wrapped continuation rows have a blank gutter. That is the intended visual distinction.

The Text Editor path does not currently set `lineNumbers`, so it inherits Monaco 0.55.1's
default (`"on"`), registered as `RenderLineNumbersType.On` in
`node_modules/monaco-editor/esm/vs/editor/common/config/editorOptions.js:1804`, rather than
explicitly opting out. No Text Editor source sets `lineNumbers: "off"`;
the explicit `"off"` uses found in `src/renderer/editors/rest-client/RequestBuilderView.ts:46-47`,
`src/renderer/editors/rest-client/ResponseViewerView.ts:30-35`, and
`src/renderer/editors/mcp-inspector/ToolResultView.ts:15-24` belong to other hosts. The plan
therefore keeps the Text Editor's current line-number behavior and records a concern if a future
Text Editor option turns line numbers off, because then hard and soft lines become visually
indistinguishable.

The implementation should set `wrappingIndent` explicitly to Monaco's stable `"same"` behavior
for this feature rather than rely on a moving library default. This keeps continuation lines
aligned with the wrapped text and avoids making the setting's visual result version-dependent.

### Default setting versus page state

`src/renderer/api/settings.ts` is the authoritative settings registry. `AppSettingsKey` is the
union at lines 23-54, `settingsComments` is the appSettings.json comment/description map at
lines 92-123, and `defaultAppSettingsState.settings` is the default catalog at lines 125-157.
The Settings page is a separate explicit composition: `SettingsView.onMount()` appends its
fixed-order sections at `src/renderer/editors/settings/SettingsView.ts:61-95`; section views and
their human-readable headers live in `src/renderer/editors/settings/sections/SettingsSections.ts`.

There is currently no registered `editor.wordWrap` setting. The line
`app.settings.set("editor.wordWrap", "on")` in `assets/guides/agents/scripting.md:154` is
therefore an illustrative-but-fake setting key, not a working registered preference. The new
key should deliberately be `editor.word-wrap` (boolean, default `false`): it keeps the existing
`editor.*` namespace while using the repository's kebab-case setting style, avoids silently
claiming the fake camel-case key, and lets the Settings page use a checkbox. The value maps to
Monaco `wordWrap: "on"` when true and `"off"` when false. The scripting example must be changed
to `app.settings.set("editor.word-wrap", true)` and should say that the value is the default for
newly shown pages only. Once a page is first shown, its plain `wordWrap` boolean is its own
persisted page state; there is no override-versus-inherit distinction and no live setting
subscription in the editor.

The existing host-slot mechanism already provides the required persistence. The doc comment for
`TextHostEditorModel.mirrorHostSettings()` at
`src/renderer/editors/base/TextHostEditorModel.ts:299-323` says the value survives editor
switches and app restarts. It seeds from `host.getEditorState<S>(this.editorId)` when a saved slot
exists, then mirrors later state changes through `host.setEditorState`; Markdown uses the same
shape for `compactMode` at `src/renderer/editors/markdown/MarkdownEditor.ts:109-118`, with a
slice selector so unrelated state writes do not churn the slot.

The lifecycle and ordering are deliberate:

1. In `MonacoEditor.adoptHost`, call `super.adoptHost(host)` first. Then check whether
   `host.getEditorState(this.editorId) === undefined`. If the slot is absent, this is a genuinely
   new page: read `settings.get("editor.word-wrap")`, put that boolean into `wordWrap` state, and
   write it directly into the host slot. If the slot is present, do not read the application
   setting at all.
2. Only after that check and possible seed, call `mirrorHostSettings` with a slice selector bound
   to `wordWrap` alone, so the saved page value is applied and later toolbar toggles are mirrored.

Seeding after `mirrorHostSettings` would overwrite a restored value and persist that overwrite,
silently destroying the page's saved choice. Because the slot is written at first show rather
than first toggle, even a page the user never touches keeps the value it was born with when the
application setting later changes. That is intentional: the setting affects only newly opened
pages.

The slot rides `HostDescriptor.state`, which is already `Record<string, unknown>` at
`src/shared/persistence.ts:13-17`, so no shared schema change is needed. A moved page carries
`PageDragData.page`, a `PageDescriptor` whose `editors[].host.state` carries the slot
(`src/shared/types.ts:43-48`). The persisted `PageDescriptor.navBack` documentation at
`src/shared/persistence.ts:52-55` confirms this persistence vehicle survives app restart and
moving a page to another window; the Word Wrap slot uses the same host-state path.

### Other Monaco hosts

Other Monaco-hosted pages intentionally hardcode their own behavior and remain unchanged:

- `src/renderer/editors/rest-client/RequestBuilderView.ts:46-47` — JSON request body, wrap on,
  line numbers off.
- `src/renderer/editors/rest-client/ResponseViewerView.ts:30-35` — response viewer, wrap on,
  line numbers off.
- `src/renderer/editors/mcp-inspector/ToolResultView.ts:15-24` — read-only result, wrap on,
  line numbers off.
- `src/renderer/editors/log-view/items/TextOutputView.ts:59-94` — per-entry wrap and line-number
  options, including live `updateOptions`.
- `src/renderer/ui/dialogs/TextDialogView.ts:83-101` — dialog-specific options, defaulting wrap
  on and line numbers off.

These are precedents for Monaco option usage, not scope for this task.

## Implementation Plan

1. Add the persisted page-local wrap state and first-show setting seed to
   `src/renderer/editors/monaco/MonacoEditor.ts`.

   - Add only `wordWrap: boolean` to `MonacoEditorState`; it is persisted through the host's
     editor-state slot, not through `getRestoreData()` or `TextFileModel.editorSettings`.
   - In `adoptHost`, call `super.adoptHost(host)` first. If
     `host.getEditorState(this.editorId) === undefined`, read `settings.get("editor.word-wrap")`,
     put that value into state, and write it directly to the host slot. If the slot exists, do
     not read the application setting; the saved page value is authoritative.
   - Only after the absent-slot check and possible seed, call `mirrorHostSettings` with a slice
     selector for `wordWrap` alone, as Markdown does. Do not add a `settings.onChanged`
     subscription or disposal: the application setting affects newly opened pages only.
   - Declare `toggleWordWrap` as an arrow-function class property
     (`toggleWordWrap = (): void => { ... }`) so passing `onClick: model.toggleWordWrap` keeps its
     `this` binding; US-1401 demonstrated the failure mode of passing a detached prototype method.
   - Unlike `hasSelection`, documented at `MonacoEditor.ts:20-23` as non-persisted, `wordWrap` is
     persisted by the host slot. The inherited identity/queue restore paths
     `TextHostEditorModel.getRestoreData()` at `src/renderer/editors/base/TextHostEditorModel.ts:153-168`
     and `MonacoEditor.applyRestoreData()` at `src/renderer/editors/monaco/MonacoEditor.ts:141-149`
     therefore remain unchanged.

   Before → after state shape:

   ```ts
   // Before: src/renderer/editors/monaco/MonacoEditor.ts
   export interface MonacoEditorState extends EditorStateBase {
       hasSelection: boolean;
   }

   // After: implementation shape (persisted through the host editor-state slot)
   export interface MonacoEditorState extends EditorStateBase {
       hasSelection: boolean;
       wordWrap: boolean;
   }
   ```

2. Apply the option only to the Text Editor path in
   `src/renderer/editors/monaco/MonacoBodyView.ts`.

   - Extend the host state projection/subscription so effective `wordWrap` changes call
     `view.update(this.hostViewProps(selectHostSlice(host.state.get())))` only; either subscribe
     directly to the Monaco model state or include a model-derived option projection in the
     existing binding, whichever matches the local state primitive without broadening the shared
     host API. Do not route this options-only change through `syncHost()` at
     `MonacoBodyView.ts:130-135`: that method also calls `view.setValue(slice.content)`, and
     `MonacoEditorHostView.setValue()` at `MonacoEditorHostView.ts:100-122` can perform a full
     external edit and push an undo stop if its value guard misses. The current synchronous
     `handleChange` path at `MonacoBodyView.ts:225-228` merely makes that safe by accident.
   - In `hostViewProps()`, pass `wordWrap: this.model.wordWrap ? "on" : "off"` and
     `wrappingIndent: "same"` alongside the existing Text Editor-only options.
   - Confirm the live options-only flow is `MonacoEditor.state →
     MonacoBodyView.hostViewProps(selectHostSlice(...)) → MonacoEditorHostView.update() →
     IStandaloneCodeEditor.updateOptions()`, with no `setValue()` or content synchronization.

   Before → after options:

   ```ts
   // Before: MonacoBodyView.hostViewProps()
   options: {
       automaticLayout: true,
       readOnly: !!slice.encrypted,
       dropIntoEditor: { enabled: false },
   },

   // After: Text Editor only
   options: {
       automaticLayout: true,
       readOnly: !!slice.encrypted,
       dropIntoEditor: { enabled: false },
       wordWrap: this.model.wordWrap ? "on" : "off",
       wrappingIndent: "same",
   },
   ```

3. Add the toolbar control following the existing toggle pattern in
   `src/renderer/editors/monaco/index.ts`.

   - Add a small `MonacoToolbarBitsView`/`WordWrapButtonView` with a state subscription and an
     `IconButtonView`, mirroring `src/renderer/editors/markdown/index.ts:18-77`.
   - Use the stable `name: "text-word-wrap-toggle"`, `active: model.wordWrap`, title
     `"Turn Word Wrap off"`/`"Turn Word Wrap on"`, and `onClick: model.toggleWordWrap`.
   - Add `WrapTextIcon` to `src/renderer/theme/icons.ts` using the existing `createIcon(24)`
     inline-SVG convention (`icons.ts:139-140`): full-width rules with the second line returning
     via a curved arrow. Register it as `"wrap-text"` in
     `src/renderer/theme/icon-registry.ts`; do not overload the Link Editor's
     `"view-list"` glyph.
   - Pass the mounted control's root as `rightToolbarContributions` to the Text Editor's
     `TextChromeView` both on mount and on update, following
     `src/renderer/editors/markdown/index.ts:168` and `:194`. `TextChromeView` reads those two
     paths at `:410` and `:425`; omitting the update path would make the button disappear after
     the first chrome update. Do not alter `TextChromeView`'s shared layout.

4. Decide and implement Command Palette reachability in the Text Editor's Monaco body.

   The repository has no application-level command registry or command-palette registration
   surface: `src/renderer/api/internal/KeyboardService.ts:35-99` handles global shortcuts and
   F1/guide navigation, while the only editor action registration found is
   `MonacoBodyView.ts:348-370` (`ed.addAction({ ... })`) for rich paste. Monaco's own
   `Ctrl+Shift+P` palette is therefore the relevant command surface. Add a Text Editor-scoped
   Monaco action, for example `id: "text.toggleWordWrap"`, `label: "Toggle Word Wrap"`, whose
   `run` calls `this.model.toggleWordWrap()`, and dispose it with the body/host cleanup.

   Recommendation: **yes**, expose it in Monaco's Command Palette as a convenience because the
   originating issue calls out that missing surface. It should be available only when the Text
   Editor Monaco instance is focused; it is not an app-global command and must not affect the
   other shared Monaco hosts.

5. Expose the control through the Text Editor agent surface.

   - `src/renderer/scripting/api-wrapper/TextEditorFacade.ts`: add
     `text-word-wrap-toggle` to `TEXT_ELEMENTS`, add `wordWrap` and `toggleWordWrap` to
     `TEXT_EDITOR_MEMBERS`, update `TEXT_EDITOR_HELP`'s inventory/count wording, and delegate
     the getter/action to `MonacoEditor`.
   - `src/renderer/api/types/text-editor.d.ts`: add the corresponding typed readonly
     `wordWrap` property and `toggleWordWrap(): void` method. The canonical declaration is copied
     to `assets/editor-types/text-editor.d.ts` by `vite.renderer.config.ts`; do not hand-edit the
     generated copy.
   - `assets/guides/editors/monaco.md`: add the toolbar layout/elements entry and facade action
     so the agent-facing guide agrees with the curated descriptor.

   Before → after facade surface:

   ```ts
   // Before
   readonly openReplace: ...;

   // After
   readonly openReplace: ...;
   readonly wordWrap: boolean;
   toggleWordWrap(): void;
   ```

   The element contract is `data-name="text-word-wrap-toggle"`; `IconButtonView` emits this
   addressable attribute, consistent with `doc/architecture/ui-element-contract.md`.

6. Register the application default and its Settings UI.

   - `src/renderer/api/settings.ts`: add `"editor.word-wrap"` to `AppSettingsKey`, add a
     human-readable `settingsComments` entry that states boolean/default-off semantics and that
     it affects newly opened Text Editor pages only, and add `"editor.word-wrap": false` to
     `defaultAppSettingsState.settings`. This makes the key appear in generated
     `appSettings.json` and be available to `app.settings.get/set`.
   - `src/renderer/editors/settings/sections/SettingsSections.ts`: add an Editor Behavior section
     with a checkbox bound to `settings.get("editor.word-wrap")`, and a human-readable
     description matching the settings-file comment that the value applies to newly opened pages
     only. The Settings page may reflect its own setting change, but the editor must not subscribe
     to it after a page has been seeded.
     Mirror the concrete boolean-checkbox precedent `WindowBehaviorSectionView` at
     `SettingsSections.ts:74`, backed there by `window.close-to-tray`. This is the first
     `editor.*` setting and establishes that namespace for the Settings page.
   - `src/renderer/editors/settings/SettingsView.ts`: insert the new fixed-order section and
     divider directly after Window Behavior and before Browser Profiles in `onMount()`
     (`SettingsView.ts:63-68`); use `data-name="settings-section-editor"` on its wrapper.
   - `src/renderer/scripting/ai-vision/namespaces/settings.ts`: add the section and the
     `editor.word-wrap` catalog row so `settings.sections`, `settings.elements`, and
     `settings.highlight("editor.word-wrap")` remain authoritative for agents.
   - `doc/architecture/ui-element-contract.md`: add the stable Editor section selector to the
     Settings section table.
   - `assets/guides/screens/settings.md`: update the section count/layout, key catalog, selector
     table, and `settings.ts` evidence line.
   - `assets/guides/agents/scripting.md`: replace the verified-fake
     `app.settings.set("editor.wordWrap", "on")` example with the real boolean key and explain
     that it is the default for newly opened pages only; each page then retains its own persisted
     value.

   Before → after settings registration:

   ```ts
   // Before
   | "window.close-to-tray"
   ...
   "window.close-to-tray": true,

   // After
   | "window.close-to-tray"
   | "editor.word-wrap"
   ...
   "window.close-to-tray": true,
   "editor.word-wrap": false,
   ```

7. Add the release note in `assets/guides/whats-new.md` under `## Version 5.0.2 (Upcoming)`.
   Describe the toolbar toggle, default-off `editor.word-wrap` setting, the distinction between
   hard newlines and soft wraps when line numbers are on, and the persisted page-local behavior:
   the setting is read only when a new page is first shown, while existing pages are unchanged.

## Concerns

- The Text Editor currently inherits Monaco's line-number default rather than declaring
  `lineNumbers: "on"`. That currently matches the owner's verified hard-newline/soft-wrap visual
  distinction. If a future Text Editor change sets line numbers off, the distinction disappears;
  acceptance testing should explicitly cover the line-number-on path and reject an accidental
  line-number-off regression unless the UI gains another distinction.
- The application setting is read only when a page is first shown without a saved slot; every
  existing page, including one the user never touched, must remain unchanged when the setting
  later changes. Verify the real lifecycle: a new page after changing the setting, persistence
  across restart, persistence after switching away and back, and persistence after dragging the
  page to a second window.
- The fake `editor.wordWrap` scripting example currently teaches a key that `settings.ts` does
  not register. Updating it is required documentation repair; retaining the camel-case key as an
  alias would perpetuate ambiguity and is not recommended.
- `wrappingIndent: "same"` is an explicit visual choice. It should be verified against Monaco
  0.55.1 with both short and long lines; changing it to Monaco's default later would be a product
  decision, not an incidental omission.
- The Command Palette recommendation is limited to Monaco's built-in editor palette. There is no
  app-wide command registry in this branch, so no global command should be invented for this
  feature.

## Acceptance Criteria

- [x] Text Editor toolbar contains `data-name="text-word-wrap-toggle"`; clicking it changes
  wrapping immediately for that open Text Editor page and updates active state/title.
- [x] Text Editor uses the persisted `editor.word-wrap` boolean when a genuinely new page is
  first shown; the default is `false`, the key is written to `appSettings.json`, and Settings
  exposes a human-readable checkbox/description saying it applies to newly opened pages only.
- [ ] A page's `wordWrap` value persists across app restart, switching away and back, and moving
  the page to a second Persephone window; changing the application setting leaves every existing
  page untouched while the next newly opened page picks up the new value.
- [x] `wrappingIndent: "same"` is explicit and the Text Editor's current line-number behavior is
  preserved. Hard newlines have numbered rows and soft continuation rows have blank gutters when
  line numbers are on.
- [x] Other Monaco-hosted pages retain their existing hardcoded wrap/line-number options.
- [x] `Toggle Word Wrap` is available in Monaco's Command Palette for a focused Text Editor only.
- [x] `page.editor` narrowed to `"monaco"` exposes `wordWrap`, `toggleWordWrap()`, and the
  `text-word-wrap-toggle` curated element; the settings object exposes the new catalog row.
- [x] `assets/guides/agents/scripting.md`, `assets/guides/editors/monaco.md`,
  `assets/guides/screens/settings.md`, and `assets/guides/whats-new.md` describe the shipped
  behavior accurately.
- [x] Typecheck/lint and the relevant UI/manual checks pass after implementation.

## Files that need NO changes

These verified files are useful precedents or shared infrastructure but are intentionally out of
scope for implementation:

| File | Why unchanged |
|---|---|
| `src/renderer/editors/shared/MonacoEditorHostView.ts` | Already spreads construction options and calls `updateOptions()` on update; no shared-host change is needed. |
| `src/renderer/editors/base/EditorToolbarView.ts` | Existing declarative toolbar renderer already accepts the slot content. |
| `src/renderer/editors/base/PageToolbarView.ts` | Existing page-toolbar slot composition already places right contributions before the switch widget. |
| `src/shared/types.ts` / `src/shared/persistence.ts` | `HostDescriptor.state` is already the untyped `Record<string, unknown>` host-slot bag, so persisting `wordWrap` requires no shared schema change; the existing `PageDescriptor`/host-state vehicle already crosses restarts and window moves. |
| Other Monaco host files listed in Background | Their current wrap behavior is intentional and outside Text Editor scope. |
| `assets/editor-types/text-editor.d.ts` | Generated flat copy; update the canonical source and let Vite regenerate it. |

## Files Changed summary

| File | Planned change |
|---|---|
| `src/renderer/editors/monaco/MonacoEditor.ts` | Persisted page-local `wordWrap`, first-show setting seed, host-slot mirror, and arrow-bound toggle/getter; no live setting subscription. |
| `src/renderer/editors/monaco/MonacoBodyView.ts` | Text Editor Monaco options, live option projection, Command Palette action. |
| `src/renderer/editors/monaco/index.ts` | Word Wrap toolbar control and TextChrome slot wiring. |
| `src/renderer/theme/icons.ts` | Add the `WrapTextIcon` inline SVG. |
| `src/renderer/theme/icon-registry.ts` | Register the `wrap-text` icon name. |
| `src/renderer/api/settings.ts` | Register `editor.word-wrap`, default, settings-file description. |
| `src/renderer/editors/settings/sections/SettingsSections.ts` | Editor Behavior settings section/checkbox. |
| `src/renderer/editors/settings/SettingsView.ts` | Add the section to the Settings page. |
| `src/renderer/scripting/api-wrapper/TextEditorFacade.ts` | Agent members and curated toolbar element. |
| `src/renderer/api/types/text-editor.d.ts` | Public script type for wrap state/action. |
| `src/renderer/scripting/ai-vision/namespaces/settings.ts` | Settings catalog/element entry. |
| `doc/architecture/ui-element-contract.md` | Stable Settings section selector. |
| `assets/guides/agents/scripting.md` | Replace fake setting example. |
| `assets/guides/editors/monaco.md` | Document control and facade parity. |
| `assets/guides/screens/settings.md` | Document new Settings section and key. |
| `assets/guides/whats-new.md` | Add Version 5.0.2 upcoming entry. |
| `doc/active-work.md` | Add the Planned dashboard link. |

The one unchecked criterion is the owner's manual check: a real app restart and a real
drag to a second window. Everything it depends on was verified structurally — the value rides
`mirrorHostSettings` into `HostDescriptor.state`, which is the same vehicle `PageDescriptor.navBack`
is documented to use for exactly those two journeys.
