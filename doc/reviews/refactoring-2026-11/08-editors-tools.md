> Part of the [refactoring roadmap](../../refactoring-roadmap.md). Reviewed at commit `c798129d` (2026-11-10); line numbers drift, so search by symbol when they no longer match.

# 08 editors-tools — refactoring review

Scope: `src/renderer/editors/` → `link-editor/`, `settings/`, `mcp-inspector/`, `log-view/`, `about/`,
`mneme-config/`, `mneme-root/`, `env-vars/`, `storybook/`, `category/`, `tools-hub/`, `toolset/`, `tools/`.
All paths are repo-relative. Line numbers are from the working tree on 2026-11-10.

## Summary

Most of these editors follow the model/view split in form: an `EditorModel` subclass owns state and
a `VanillaView` renders it. The smaller tools (Toolset, Env Vars, About, Storybook, Mneme views, the
Edit Link dialog) are clean. The problems sit in three places. The first is **Settings**, which got
the most churn from the recent epics (voice typing, microphone, translation, site extensions, board
settings, themes, languages). The second is the **Link editor's domain logic**. The third is **shared
contracts that ended up inside editor folders**.

The three biggest problems:

1. **Settings has no section framework.** Its 18 sections are written by hand and repeat the same
   plumbing: subscribing to the setting key, rebuilding control props, committing a number draft on
   blur (three different mechanisms), path-picker rows (two idioms, three copies each), and help
   headers. The help headers even caused duplicate title messages in the i18n catalog.
   Board-declared settings already have a declaration-driven renderer, but the built-in sections
   don't use it.
2. **Settings sections bypass the services that own their data and re-implement their rules.** The
   Language section duplicates `app.languages.list()/apply()`, and the Theme section skips
   `app.themes`. Browser profiles reach into the browser editor and call raw IPC, and the microphone
   section calls raw `ipcRenderer` with an untyped status protocol. The allowed values, ranges and
   defaults for settings appear both in `api/settings.ts` and in the views, and the copies already
   disagree.
3. **Contracts and clients that are used across the app live inside editor folders.** This produces
   wrong-way imports: `api/` and `content/` import from `editors/mcp-inspector`, `editors/mneme-config`,
   `editors/log-view` and `editors/env-vars` (one of these is a documented circular dependency), and
   42 uikit stories import `editors/storybook`. `LinkEditor` (1,130 lines) is also a god model. Its
   link-collection rules are copied into `LinkTreeProvider` and into three views.

## Findings

### EDT-1: Settings sections repeat the same plumbing; there is no section/field framework
- **Priority:** P1
- **Effort:** L
- **Where:** `src/renderer/editors/settings/sections/SettingsSections.ts:47-711`, `src/renderer/editors/settings/sections/settings-native.ts:9-79`, `src/renderer/editors/settings/sections/BrowserProfilesSection.ts:74-124,388-427`, `src/renderer/editors/settings/sections/McpSectionModel.ts:110-132`, `src/renderer/editors/settings/sections/ClipboardSectionModel.ts:16-51`, `src/renderer/editors/settings/sections/BoardSettingsSection.ts:98-342`, `src/renderer/editors/settings/SettingsView.ts:308-309`, `src/shared/i18n/en/settings.ts:32-48,106-199`
- **Problem:** The only shared layer is `settings-native.ts`, a set of DOM helpers (`panel`, `text`,
  `helpIcon`, `helpHeader`). Every section rebuilds the same machinery itself:
  - **Key-filtered subscriptions:** there are 17 `settings.onChanged.subscribe(({ key }) => { if (key === "…") x.update(this.xProps()) })` blocks, each paired with an `xProps()` builder that re-reads
    `settings.get(key)`. For example, `LinkBehaviorSectionView` (`SettingsSections.ts:47-76`),
    `WindowBehaviorSectionView` (`:78-119`), `EditorBehaviorSectionView` (`:121-152`),
    `TerminalSectionView` (`:548-570`), and four rows of `VoiceTypingSettingsSectionView` (`:622-627`).
  - **Number drafts committed on blur**, written with three mechanisms:
    (a) a `TComponentModel` + `DepsGate` + `initialized` flag that resyncs the draft:
    `VideoPlayerModel` (`SettingsSections.ts:439-457`), `McpSectionModel` (two ports, `:31-72,110-128`),
    `ClipboardSectionModel` (`:16-51`), and Tor in `BrowserProfilesSectionModel` (`:35-49,135-145`);
    (b) a mutable view field: microphone attenuation, `SettingsSections.ts:724,812-829`;
    (c) a closure-local draft: notch fields, `SettingsSections.ts:884-899`.
    The port rule `port >= 1024 && port <= 65535` is copied four times
    (`SettingsSections.ts:543`, `McpSectionModel.ts:120,126`, `BrowserProfilesSectionModel.ts:143`).
    The Enter-to-blur handler is copied in `SettingsSections.ts:507,910`,
    `McpSectionModel.ts:130`, and `BrowserProfilesSection.ts:425`.
  - **Path pickers**, in two idioms with three copies each:
    - *Value box with Browse and Clear buttons:* `BoardVarsSectionView` (`SettingsSections.ts:276-332`),
      `LibraryPathSectionView` (`:345-421`), and `SiteExtensionsSectionView` (`SiteExtensionsSection.ts:20-48`).
    - *Click-a-link-or-placeholder with an × button:* the VLC path (`SettingsSections.ts:510-532`),
      `BookmarksFileLineView` (`BrowserProfilesSection.ts:94-123`), and the Tor executable
      (`BrowserProfilesSection.ts:388-417`). All three have the same delegated click handler testing
      `[data-type="settings-link"], [data-type="settings-placeholder"]`.
  - **Help/header ownership is inconsistent:**
    - Most sections call `helpHeader(...)` themselves, passing a `(cleanup) => this.own(cleanup)`
      callback. That callback appears 28 times.
    - `ThemeSection` uses `sectionTitle` with no help.
    - For `link-behavior` and `default-browser`, the shell adds the header by checking the section id
      (`SettingsView.ts:308-309`).
    - The catalog already has `titleKey` (`settings-catalog.ts:14`). Sections still pass their own
      title keys, which produced eight pairs of identical English messages that translators handle
      twice: `groupTitleTerminal`/`terminalTitle`, `groupTitleVideoPlayer`/`videoPlayerTitle`,
      `groupTitleBoardVars`/`boardVarsTitle`, `groupTitleLanguage`/`languageTitle`,
      `groupTitleClipboard`/`clipboardTitle`, `groupTitleFileSearch`/`fileSearchTitle`,
      `groupTitleSiteExtensions`/`siteExtensionsTitle`, and
      `groupTitleBrowserProfiles`/`browserProfilesTitle` (`src/shared/i18n/en/settings.ts:32-48` vs `:106-199`).
  - **Board settings already have a framework, but built-in sections don't use it:**
    `BoardSettingsSectionView` (`BoardSettingsSection.ts:98-197`) renders boolean, enum, multiselect,
    multiline, string, number and folder-path controls from declarations, with load/save/reset and
    number commit.
    Its per-control record is a bag of five optional view fields (`BoardSettingControl`, `:28-38`)
    instead of a tagged union. Its Reset label is the untranslated literal `"Reset"` (`:129`).
- **Refactor:** Add a small settings field kit in `editors/settings/fields/` and make sections
  declarative:
  1. `SettingsStore` adapter interface: `get(id)`, `set(id, v)`, `reset?(id)`, `subscribe(id, cb)`.
     Implement it twice: `appSettingsStore` (wraps `settings` + `onChanged` key filtering) and
     `boardSettingsStore(boardRoot)` (wraps `board-settings-bridge`).
  2. Field views, each taking `{ store, id, label, help?, ...}` and owning their subscription, draft
     and validation:
     - `CheckboxField`
     - `ChoiceField` (items + optional "keep unknown value")
     - `NumberField({ min, max, integer })`, which replaces all three draft mechanisms and the
       `DepsGate` models
     - `PortField`, a preset of `NumberField` with 1024..65535
     - `PathField({ kind: "file" | "folder", filters, emptyText, clearLabel, extraActions })`, which
       replaces both path idioms
     - `ShortcutField`, which moves the capture logic out of `SettingsSections.ts:675-710`
     - `TextListField`, a comma list used by File Search
  3. `SettingsSectionDescriptor` (catalog entry + `create()`): the shell renders the header from
     `titleKey` + `helpKey`. Sections render only their body. Delete the shell's id special-cases and
     the duplicate `*Title` messages.
  4. Re-implement `BoardSettingsSectionView` as "map declarations → fields over `boardSettingsStore`".
     Rewrite the simple built-in sections (Link behavior, Window, Editor, Terminal, Git, Board vars,
     Script library, Video player, Voice typing, Clipboard, File search, MCP ports) as short field
     lists.
  5. Keep the composite sections (Theme, Browser profiles, Microphone, Site extensions, Default
     browser) as custom views, but build them from the same fields.
- **Risk / notes:**
  - `data-name` element names are an addressability contract (`doc/architecture/ui-element-contract.md`)
    that `scripting/ai-vision/namespaces/settings.ts` depends on. The fields must keep the current names.
  - Do EDT-3 first or together with this: the number/choice fields should read ranges and options
    from the settings schema.
  - Work section by section; the shell does not change until step 3.

### EDT-2: Settings sections bypass the owning services and re-implement their rules
- **Priority:** P1
- **Effort:** M
- **Where:** `src/renderer/editors/settings/sections/LanguageSection.ts:30-86,153-182`, `src/renderer/editors/settings/sections/ThemeSection.ts:5-11,128-136,267-313`, `src/renderer/editors/settings/sections/BrowserProfilesSectionModel.ts:6-13,69-99`, `src/renderer/editors/settings/sections/BrowserProfilesSection.ts:25-26,650-665`, `src/renderer/editors/settings/sections/SettingsSections.ts:769-783,842-857`, `src/renderer/editors/settings/sections/SiteExtensionsSection.ts:79-109`, `src/renderer/editors/tools-hub/SiteExtensionsTab.ts:24,107-122`, `src/renderer/editors/settings/sections/McpSection.ts:262-273`
- **Problem:** Settings sections reach into feature internals instead of calling the feature's
  service, and in several cases a public service with the same behaviour already exists:
  - **Languages.** `LanguageSection.buildLanguageOptions` (`:30-86`) re-implements
    `languages.list()` (`src/renderer/api/languages.ts:218-230`): it merges packs, computes
    completeness, and adds the forced `en` and the dev-only `en-XA` entries. `handleLanguageChange`
    (`:168-182`) re-implements `languages.apply()` (`api/languages.ts:329-347`: set, flush, reload all
    windows). `sync()` constructs fake `LanguagePack` objects (`schemaVersion: 1, messages: {}`,
    `:156-164`) only so it can call `resolveLocale`. The section (US-1649) predates `app.languages`
    (EPIC-127) and was never migrated.
  - **Themes.** `ThemeSection` imports `theme/themes` (`applyTheme`, `getAvailableThemes`),
    `theme/theme-state` and `api/custom-theme-storage` (`:5-11`) instead of using `themes.list()`,
    `themes.apply()` and `themes.delete()` (`src/renderer/api/themes.ts:62,111-120`).
    `handleThemeChange` (`:267-270`) duplicates `themes.apply`. It tells custom themes apart with the
    literal `"custom-"` id prefix (`:130-136,246`).
    `reportThemeEditFailure` decides "editor not installed" by comparing the English text returned by
    `getMissingEditCapabilityMessage` with `englishMessage("settings.themeEditorMissing")` (`:301-302`).
    The two strings are separate copies (`src/renderer/api/capability-feedback.ts:18`,
    `src/shared/i18n/en/settings.ts:214`), so editing either one silently disables the
    "open Tools hub" path. `isCapabilityErrorWithCode(error, "no-handler")` already expresses the same
    check.
  - **Browser profiles.** `BrowserProfilesSectionModel`:
    - imports `getPartitionString` from `editors/browser/BrowserEditorModel` (`:6`), which is another
      editor's internals;
    - calls `require("electron").ipcRenderer` directly with `BrowserChannel.*` for clearing profile
      data and permission decisions (`:13,75-76,82-90,99`);
    - owns the profile rules: case-insensitive unique name (`:54-57`); remove = clear data + clear
      permissions + reset default (`:69-79`);
    - maps the default profile to the magic string `"default"` inconsistently: `name || "default"` at
      `:82,86,90` but plain `name` at `:76`.

    The section view also builds the translation-target list by calling the text-translation provider
    and `ui/translation/TranslationWorkflow` (`BrowserProfilesSection.ts:25-26,650-665`).
  - **Microphone.** `MicrophoneAudioSectionView` (US-1802/US-1798, this week) calls raw
    `ipcRenderer.on/invoke/send` on `AUDIO_STATUS`, `AUDIO_STATUS_GET`, `AUDIO_RETRY` and
    `AUDIO_SETTINGS_DEVICES` (`SettingsSections.ts:769-783,843-844`).
    It maps the untyped status `mode` strings (`"reference-ready"`, `"failed"`, `"neural"`, …) to
    messages in a nested ternary (`:773-776`). It decides the Windows default device by stripping
    Chromium's `"Default - "` label prefix (`:846-854`).
    `AudioProcessingStatus.mode` is plain `string` (`src/ipc/audio-channels.ts:11`). The producers are
    `ui/speech/microphone-settings.ts:16-19`, `ui/speech/LoopbackReference.ts:112` and
    `renderer/audio/audio-window.ts:151,255`. The microphone feature already has a home
    (`src/renderer/ui/speech/microphone-settings.ts`) that does not own any of this.
  - **Site extensions.** The "listings + trust grants" join is computed twice: in
    `SiteExtensionsSection.refresh` (`:90-94`, counting trusted and broken extensions) and in
    `SiteExtensionsTab.refresh` (`:113-116`, building entries plus orphan grants). The tab also
    re-declares the grant shape locally (`SiteExtensionsTab.ts:24`) instead of using
    `SiteExtensionTrustSnapshot`.
  - **MCP.** `McpSection.configJson` (`:262-273`) hard-codes the client URL format
    `http://127.0.0.1:${port}/mcp`. The main process owns that format
    (`src/main/mcp-http-server.ts:309`, `src/main/mneme-service.ts:58`).
- **Refactor:** Each section calls one service method per action and keeps no domain rules:
  1. **Language:** use `languages.list()` and `languages.apply(code)`. Add `languages.effective(requested)`
     to `api/languages.ts` for the "reload required" hint. Delete `buildLanguageOptions` and the fake
     packs.
  2. **Theme:** use `themes.list()`, `themes.apply()` and `themes.delete()`. Add `isCustom` to
     `ThemeDefinition` (or a `themes.isCustom(id)` helper) to replace the `"custom-"` checks. Test the
     edit failure with `isCapabilityErrorWithCode(error, "no-handler")`.
  3. **Browser profiles:** create `api/browser-profiles.ts` with:
     - `list()`, `add(name, color)`, `remove(name)`, `setDefault(name)`, `setColor(name, color)`
     - `clearData(name)`, `listPermissionDecisions(name)`, `removePermissionDecision(name, entry)`,
       `clearPermissionDecisions(name)`

     This service owns the partition-string and `"default"` mapping. Move `getPartitionString` to a
     shared module such as `src/shared/browser-partition.ts` and have both the browser editor and the
     new service import it. `BrowserProfilesSectionModel` keeps only the form state (new name, colour,
     "cleared" flash).
  4. **Microphone:** create a `microphoneSettings` service in `ui/speech/` (or `api/`) with:
     - `listDevices(): Promise<{ id, label, isDefault }[]>`, which owns the `"Default - "` rule
     - `onStatus(cb)` with a typed union `MicrophoneStatus = { kind: "reference-ready" } | { kind: "failed"; reason } | …` declared in `ipc/audio-channels.ts`
     - `retry()`, `getNotch(deviceId)`, `setNotch(deviceId, patch)`

     The section renders only what the service returns.
  5. **Site extensions:** add `siteExtensionStore.listWithTrust(): Promise<SiteExtensionEntry[]>`
     (listing + grant + `status: valid | invalid | conflict | folder-missing | trust-changed`) and a
     `summary()` built on top of it. The Settings section and the Tools hub tab both consume it.
  6. **MCP:** add `api.getMcpStatus().url` and `api.getMnemeStatus().url` to the client config (both
     already return `url`), or add a `mcpClientConfig()` helper in `api/mcp/`.
- **Risk / notes:**
  - Behaviour must stay identical; the agent-facing APIs `app.languages` and `app.themes` already
    have the semantics the sections need.
  - The browser-profiles service touches the browser area (cross-area); see the cross-area notes.

### EDT-3: The rules for setting values live twice, in `api/settings.ts` and in the views, and the copies disagree
- **Priority:** P2
- **Effort:** S
- **Where:** `src/renderer/api/settings.ts:242-271,408-413,473-475`, `src/renderer/editors/settings/sections/SettingsSections.ts:592,606,634,644,868,879-883`, `src/renderer/editors/settings/sections/ClipboardSectionModel.ts:43-50`
- **Problem:** `settings.set()` normalizes values through an if-chain of per-key normalizers
  (`api/settings.ts:408-413`), and the Settings views re-state the same rules by hand:
  - The voice-typing auto-stop options `[0, 2000, 3000, 5000, 10000]` and
    `[0, 2000, 3000, 4000, 5000, 10000, 15000, 30000]` appear in both `api/settings.ts:266,270` and
    `SettingsSections.ts:644,634`.
  - The default shortcuts `"Alt+V"` and `"Alt+Shift+V"` appear in `api/settings.ts:410-411,473-474`
    and as reset values in `SettingsSections.ts:592,606`.
  - The clipboard limit "integer 1..1000" appears in both `normalizeClipboardMaxItems`
    (`api/settings.ts:259-263`) and `ClipboardSectionModel.handleMaxItemsBlur` (`:43-50`).
  - **The notch frequency rule already disagrees.** The service accepts 20..20000 Hz
    (`api/settings.ts:251`), the field allows 20..7999 (`SettingsSections.ts:880`), and the catalog
    says values at or above 8 kHz are "preserved but bypassed" (`settings-catalog.ts:86`). The notch
    default object is also rebuilt in the view from `MICROPHONE_TUNING` (`SettingsSections.ts:868`).
- **Refactor:**
  - In `api/settings.ts`, replace the if-chain and the scattered constants with a per-key schema
    table:
    `SETTINGS_SCHEMA: { [K in AppSettingsKey]?: { default, normalize?, options?, min?, max?, integer? } }`
  - `settings.set` applies `SETTINGS_SCHEMA[key].normalize`.
  - Export `settingOptions(key)`, `settingRange(key)` and `settingDefault(key)` so the EDT-1 fields
    (`ChoiceField`, `NumberField`, the Reset button) read them instead of hard-coding.
  - Pick one notch range and record the reason next to it.
- **Risk / notes:** The settings file format does not change. This should come before or together
  with EDT-1. The `api/settings.ts` side belongs to the api reviewer's area; flagged there too.

### EDT-4: `SettingsView` is a 640-line view that owns the layout model, board-manifest IO and speculative DOM observation
- **Priority:** P2
- **Effort:** M
- **Where:** `src/renderer/editors/settings/SettingsView.ts:4-6,51-61,68-87,102-104,235-243,289-425,586-625`
- **Problem:** The view mixes several jobs:
  1. **Section list model:** catalog + board-declared sections, grouping and insertion order. This
     is `createRuntimeSections` (`:388-403`). It is recomputed on every call: twice back-to-back in
     `rebuildDynamicSections` (`:369-371`), and on every scroll event through
     `topmostVisibleSectionId` and `lastNavigableSectionId` (`:602,619`).
  2. **Content tree projection:** `createSettingsContentItems` (`:90-116`). It decides group labels
     with a branch on `"groupTitleKey" in section` plus a hard-coded `"editors"`/`"boards"` check
     (`:102-104`). Because of that check, `BoardSettingsSectionDescriptor.groupTitle` and
     `description` (`:54-57,416-420`) are written but never read.
  3. **Board IO:** it reads board manifests and loads board language packs before it can show titles
     (`readNormalizedBoardManifest` + `ensureBoardDisplayText`, `:346-353`). This reaches into
     `editors/board` internals (`:4-6`).
  4. **Scroll-spy and click-to-scroll settling:** `:516-633`.
  5. **Section-specific header rules:** `:308-309` (see EDT-1).
  6. **Speculative observer:** a `MutationObserver` on every `hidden` attribute in the panel subtree
     (`:235-243`) rebuilds the content tree. No section ever hides its panel, wrapper or root: the
     only `hidden` toggles are on inner elements (`ProfileNetworkLineView.ts:89,115`,
     `SiteExtensionsSection.ts:88,105`). So the observer only causes extra rebuilds.
- **Refactor:**
  1. Extract `SettingsLayoutModel` (a plain class, no DOM) that holds `sections`, `groups` and
     `selectedValue`. It recomputes only when `customEditorRegistry.settingsBoards` changes and exposes
     `firstSectionOf(group)` and `lastSection()`.
  2. Extract a reusable `ScrollSpy` helper (scroll container + ordered targets →
     `onActiveChange` / `scrollTo(target)`) out of `:516-633`.
  3. Have the board registry publish `BoardSettingsRegistration.displayName` already localized, or
     add a `boardDisplayNames.ensure(root)` service, so Settings does no manifest IO.
  4. Remove the `MutationObserver`. If section visibility is ever needed, add a `visible` signal to
     the EDT-1 section descriptor.
  5. Delete the dead descriptor fields.
- **Risk / notes:** The scroll-settling logic is subtle; its comments (`:432-436,592-593`) must move
  with it. Depends on EDT-1 step 3 for the header change.

### EDT-5: `LinkEditor` is a god model; its link-collection rules are copied into `LinkTreeProvider` and the views
- **Priority:** P1
- **Effort:** L
- **Where:** `src/renderer/editors/link-editor/LinkEditor.ts:333-1100`, `src/renderer/editors/link-editor/LinkTreeProvider.ts:217-251`, `src/renderer/editors/link-editor/LinkBody.ts:374-381`, `src/renderer/editors/link-editor/panels/LinkTagsSecondaryView.ts:188-195`, `src/renderer/editors/link-editor/panels/LinkHostnamesNavigationPanel.ts:195-202`
- **Problem:** One 1,130-line class holds four separate jobs:
  - **Page/editor lifecycle:** host adoption, sidebar panels, surviving navigation (`:193-323`).
  - **The link collection domain:** parse and normalize (`:346-374`), category/tag/hostname indexes
    with counts (`:438-524`), filtering (`:528-606`), per-filter view modes (`:618-651`), CRUD
    (`:655-901`), category move (`:903-942`) and pins (`:946-1000`).
  - **Import:** directory scanning through `app.fs` with a 100-file confirmation (`:702-848`).
  - **UI orchestration:** dialogs, `containerElement.focus()`, `gridModel` (`:114-116,868-878,1004-1055`).

  Because the domain rules have no class of their own, they are copied:
  - The "re-derive after mutation" ritual
    `loadCategories(); loadTags(); loadHostnames(); applyFilters();` appears four times
    (`:364-367,689-692,885-888,1049-1052`).
  - `showLinkDialog` re-implements `addLink`'s defaulting from the current panel and search
    (`:1009-1019` vs `:656-674`) and its new-link construction (`:1036-1052` vs `:676-692`).
  - The tag rule ("ends with `:` → prefix match") is in `applyFilters` (`:561-569`) and again in
    `LinkTreeProvider.getTagItems` (`:243-251`).
  - The category-subtree move is in `moveCategory` (`:903-942`, with confirmation) and again in
    `LinkTreeProvider.renameCategoryPath` (`:217-228`). The second copy calls `moveLinkToCategory`
    per link, which re-indexes for every link.
  - The add/remove tag toggle is written three times: `LinkBody.ts:374-381`,
    `LinkTagsSecondaryView.ts:188-195` and `LinkHostnamesNavigationPanel.ts:195-202`.
  - The separators `":"` (tags) and `"/"`/`"/\\"` (categories) are inline literals in each copy.

  It also carries leftovers from earlier migrations:
  - migration comments ("BELOW: methods relocated from legacy LinkViewModel", `LK4/LK9/HS1` tags,
    `:99-120,325-329`)
  - a React-era doc comment about `state.use(...)` selectors (`:613-616`)
  - duck-typed embedder hooks assigned from outside (`onLinkOpen`, `onGetLinkMenuItems`, `:118-120`)
  - the `typedQueue` cast (`:152-155`)
  - a mix of static `ui` and dynamic `import("../../api/app")` (`:783,798,809,1086,1098`)
- **Refactor:**
  1. Create `link-editor/link-collection.ts` with a DOM-free `LinkCollection` class:
     - constructor: `(data: LinkEditorData)`
     - read: `links`, `index` (categories/tags/hostnames + counts), `filter(criteria): LinkItem[]`,
       `viewModeFor(panel, key)`
     - mutate: `add(partial, defaults)`, `update(id, patch)`, `remove(id)`, `toggleTag(id, tag)`,
       `moveToCategory(id, cat)`, `moveCategory(from, to)` (returns the affected count),
       `pin/unpin/reorderPinned`, `setViewMode(...)`
     - helpers: `serialize()`, `static parse(content)`

     The index is rebuilt inside the class after each mutation, so the ritual disappears.
     `TAG_SEPARATOR` and `CATEGORY_SEPARATOR` become constants there.
  2. Create `LinkImporter` (`importLinks` + `scanFolders`). It returns `{ links, limitReached }`. The
     confirmation dialog stays in the editor.
  3. `LinkEditor` keeps lifecycle, panels, selection/filter state and dialog orchestration. It
     delegates every rule to `LinkCollection`, and `showLinkDialog` calls the same `add` as `addLink`.
  4. `LinkTreeProvider` reads from `LinkCollection` (`filter({ tag })`, `moveCategory`) instead of
     re-implementing them.
  5. Replace the embedder hooks with an explicit `LinkEditorEmbedding` interface
     (`{ adjustOpenLink(data), extraMenuItems(link), imageRoute() }`) that the browser passes once.
- **Risk / notes:**
  - `data` is persisted as file content; `serialize()` must reproduce the current
    `JSON.stringify({ type: "link-editor", ...data }, null, 4)` exactly.
  - The incremental-filter optimization (`lastFilterState`, `:102-108,540-551`) moves into
    `LinkCollection.filter` or the editor.
  - The scripting facade (`scripting/api-wrapper/LinkEditorFacade.ts`) calls editor methods. Keep
    those signatures as thin delegates.

### EDT-6: Duplicated view code in the Link editor (list/tiles pairs, context menus, favicon tracking, Tags vs Hostnames panels)
- **Priority:** P2
- **Effort:** M
- **Where:** `src/renderer/editors/link-editor/LinkBody.ts:383-486`, `src/renderer/editors/link-editor/PinnedLinksPanelView.ts:315-410`, `src/renderer/editors/link-editor/LinksListView.ts:172-209`, `src/renderer/editors/link-editor/LinksTilesView.ts:194-248`, `src/renderer/editors/link-editor/LinksList.ts`, `src/renderer/editors/link-editor/LinksTiles.ts`, `src/renderer/editors/link-editor/panels/LinkTagsSecondaryView.ts:28-232`, `src/renderer/editors/link-editor/panels/LinkHostnamesNavigationPanel.ts:24-238`, `src/renderer/editors/category/CategoryEditor.ts:290-363`, `src/renderer/editors/link-editor/index.ts:73-377`
- **Problem:**
  - **Handler pairs:** `LinkBodyView` has seven identical handler pairs (`handleListX`/`handleTilesX`
    for select, open, edit, delete, context menu and grid model, `:383-414`).
  - **Context menu written twice:** once in `LinkBody.showLinkContextMenu` (`:426-486`) and again in
    `PinnedLinksPanelView.contextMenu` (`:352-410`). The copies already differ: only the pinned one
    adds `appendLinkOpenMenuItems`.
  - **"Open + save favicon unless private page"** is written twice (`LinkBody.ts:416-420`,
    `PinnedLinksPanelView.ts:346-350`).
  - **Favicon subscription machinery** (generation counter, hostname→rows map, `getFaviconPath` +
    `onFaviconReady`, repaint guard) is written three times (`LinksListView.ts:172-209`,
    `LinksTilesView.ts:194-248`, `PinnedLinksPanelView.ts:315-344`).
  - **Near-identical props:** `LinksListProps` and `LinksTilesProps` differ by two fields, yet
    `CategoryEditor` maps every field twice (`listProps`/`tilesProps`, `:296-343`).
  - **Near-identical panels:** `LinkTagsNavigationPanelView` and `LinkHostnamesNavigationPanelView`
    are ~210-line twins: filter list on top, splitter, bottom `LinksListView`, height clamp, default
    split, scroll-to-selected. Each has the same
    `seedDefaultSplit/syncBottom/removeBottom/handleChangeHeight/scrollSelected/handleToggleTag` set.
  - **Dead rebind code:** `index.ts` holds three toolbar views (breadcrumb, actions, footer), each with
    model-swap rebind code (`:96-114,197-220,356-370`). The parent `LinkEditorView` throws on a model
    swap (`:419-423`), so that rebind code never runs.
- **Refactor:**
  1. Add `LinkCollectionViewProps` as a shared base and make `LinksTilesProps` extend it with
     `viewMode`. Add `createLinksItemsView(mode, props)`, used by both `LinkBodyView` and
     `CategoryEditor`.
  2. Add `link-item-actions.ts` with `buildLinkContextMenu(model, link, { pinned })` and
     `openLinkItem(model, link)`. Both views call these.
  3. Add a `FaviconRowTracker` helper (`track(links, rowOf)`, `onRepaint(rows)`, `dispose()`) used by
     the list, tiles and pinned panel.
  4. Add one `LinkFilterNavigationPanelView` with a small strategy:
     `{ name, topView(editor), selectedKey(state), itemsFor(editor, key), sourceId }`. The Tags and
     Hostnames panels become ~20-line configurations.
  5. Remove the dead model-swap paths from the three toolbar views and move them to `LinkToolbarViews.ts`.
- **Risk / notes:**
  - Virtualized cell wrappers must keep their once-per-wrapper listener strategy
    (`model-view-pattern.md`, "Vanilla update and event hazards").
  - Panel `data-name` values (`link-tags-navigation`, `link-hostnames-navigation`, …) must stay
    unchanged.
  - Best done after EDT-5 so `toggleTag` is a model call.

### EDT-7: Shared contracts and clients live inside editor folders, which forces wrong-way and circular imports
- **Priority:** P1
- **Effort:** M
- **Where:** `src/renderer/editors/mcp-inspector/McpConnectionManager.ts`, `src/renderer/api/mneme-connection.ts:5-9`, `src/renderer/editors/mneme-config/mnemeTypes.ts:128`, `src/renderer/api/mneme-status.ts:6`, `src/renderer/content/tree-providers/MnemeTreeProvider.ts:10`, `src/renderer/editors/log-view/logTypes.ts:1-2`, `src/renderer/api/mcp/request-log.ts:3`, `src/renderer/api/mcp/ui-push-validation.ts:2`, `src/renderer/api/board-vars/board-vars-bridge.ts:3`, `src/renderer/editors/env-vars/EnvVarsEditor.ts:6-9`, `src/renderer/editors/env-vars/open-env-vars.ts:13-14,33`, `src/renderer/api/pages/PagesLifecycleModel.ts:48`, `src/renderer/editors/link-editor/routed-src.ts:13-14`, `src/renderer/editors/tools/ToolsTreeView.ts`, `src/renderer/uikit/*/*.story.ts` (42 files)
- **Problem:** `doc/architecture/overview.md` ("Dependency Rules", items 2, 4, 5 and 10) says that
  `api/` and `content/` must not import `editors/`, and that `uikit/` imports only `core/` and
  `theme/`. In practice:
  - **MCP client:** `McpConnectionManager` is the app's generic MCP client (auto-reconnect, resource
    subscriptions; US-661/US-671), but it lives in `editors/mcp-inspector/`. The app-wide
    `api/mneme-connection.ts` imports it, and so does the Mneme config editor.
  - **Mneme types:** the Mneme protocol types and `parseToolResult` live in
    `editors/mneme-config/mnemeTypes.ts`. They are imported by `api/mneme-status.ts`,
    `content/tree-providers/MnemeTreeProvider.ts` and `editors/mneme-root`.
  - **Log entry types:** `logTypes.ts` is the log-entry contract used by `api/mcp`, scripting
    (`UiFacade`, `Grid`, `Markdown`, `Text`, …) and ai-vision, but it lives in `editors/log-view/`.
    It in turn imports `editors/grid/utils` and `ui/dialogs` (`logTypes.ts:1-2`), so an api type pulls
    in grid and dialog modules. The MCP inspector imports `McpRequestEntry` from the log view.
  - **Board vars:** `api/board-vars/board-vars-bridge.ts` imports
    `editors/env-vars/open-env-vars.ts`. That creates a circular dependency, which two comments
    document and work around by importing past the barrel (`EnvVarsEditor.ts:6-8`,
    `open-env-vars.ts:13-14`). `open-env-vars` also reaches the editor through
    `as unknown as EnvVarsEditor` (`:33`).
  - **Link editor internals used elsewhere:** `PagesLifecycleModel` (api) imports
    `editors/link-editor/link-open`. `LinksListView`, `LinksTilesView`, `LinkBodyView` and
    `routed-src` are used by `editors/category` and `editors/browser`; the `routed-src` header
    comment admits it was placed in link-editor only to keep an import arrow one-way.
  - **Tools tree:** `editors/tools/` is not an editor; it is a tree component used only by
    `ui/sidebar/TrustedToolsListView.ts:6`.
  - **Storybook types:** 42 uikit `*.story.ts` files type-import `editors/storybook/storyTypes`, so
    the "extractable" uikit package depends on an editor.
- **Refactor:**
  1. Move the MCP client to `src/renderer/api/mcp/client/McpConnectionManager.ts` (or `core/mcp/`);
     the inspector imports it from there.
  2. Move `mnemeTypes.ts` to `src/renderer/api/types/mneme.ts`. Combine with EDT-10.
  3. Move `logTypes.ts` to `src/shared/log-entries.ts` (pure types + `normalizeLogDialogButtons`).
     Inject the built-in button-label lookup or move `builtInDialogButtonLabel` to `shared/`. Replace
     the `GridColumn` import with a local structural type.
  4. Break the board-vars cycle. The bridge already sends `openRawLink` with
     `{ target: "env-vars-view", envNamespace }`; it should stop importing the editor. A freshly opened
     page already consumes `envNamespace` in `adoptHost` (`EnvVarsEditor.ts:92-93`). An already-open
     page currently needs the post-open `focusNamespace` cast (`open-env-vars.ts:31-33`). Replace that
     by passing the incoming `ILinkData` to the existing reuse hook
     (`EditorModel.onNavigationReuse?(link)`, `editors/base/EditorModel.ts:352`, called from
     `api/pages/PageNavigator.ts:105,136`), and let `EnvVarsEditor` focus the namespace there. Then
     move the "file configured?" check into `api/board-vars` and delete `open-env-vars.ts`.
  5. Move `LinksListView`, `LinksTilesView`, the props files, `pipe-image-src.ts`, `routed-src.ts` and
     `LinkTooltipView` to `src/renderer/editors/shared/links/` (or `components/link-list/`, since they
     depend on `FileIcon`/favicon). Move `link-open.ts`'s `buildLinkEditorContent` next to `linkTypes`
     in `api/types` or `shared/`.
  6. Move `editors/tools/*` to `src/renderer/components/tools-tree/` (or `ui/sidebar/`).
  7. Move `storyTypes.ts` (and `story-props.ts`) to `src/renderer/uikit/shared/story-types.ts`.
- **Risk / notes:** Steps 1-3 and 5-7 are mechanical moves with path updates. Step 4 needs a small
  editor-framework change: `onNavigationReuse` currently takes no arguments. Check that the
  already-open case still focuses the namespace when the existing page is not the active tab.
  `doc/architecture/folder-structure.md` and `key-files.md` need updating.

### EDT-8: `McpInspectorEditorModel` handles three protocol areas in one class and repeats the request pipeline seven times
- **Priority:** P2
- **Effort:** M
- **Where:** `src/renderer/editors/mcp-inspector/McpInspectorEditorModel.ts:256-301,369-760,806-831`, `src/renderer/editors/mcp-inspector/McpInspectorView.ts:96-98,228-273`
- **Problem:**
  - **The request pipeline is copied seven times.** Each of `loadTools` (`:369-394`),
    `callTool` (`:415-476`), `loadResources` (`:481-518`), `readTemplateResource` (`:560-610`),
    `readResource` (`:613-658`), `loadPrompts` (`:663-692`) and `getPrompt` (`:714-760`) re-implements
    the same sequence:
    1. capture `client` and the connection generation
    2. capture the per-area selection generation
    3. start a timer
    4. `try`/`catch`
    5. `isCurrentRequest(...)` plus a selection re-check, in both branches
    6. `logRequest`
    7. update the area's state
  - `readResource` and `readTemplateResource` are the same function over different state fields.
  - The list of 9 server-info fields to reset is written twice (`:277-287`, `:819-828`).
  - Tools, resources and prompts each have their own `TOneState` and generation counter, but all their
    methods sit on the editor model.
  - **The view bypasses the model for saved connections:** it subscribes to and loads
    `mcpConnectionStore` itself (`McpInspectorView.ts:96-98`), while the model owns
    `fillFromSaved` and `deleteSavedConnection`.
  - **Compressed view code:** `McpInspectorView.ts` puts whole classes on single lines of 300 to
    1,600 characters (17 such lines). `DisconnectedBodyView` finds its own DOM with
    `querySelector('[data-part="status"]')` (`:246`) instead of keeping element references, which
    `model-view-pattern.md` ("Binding and direct DOM work") asks for. The file's line count
    understates its size.
- **Refactor:**
  1. Add `McpSession` (wraps `McpConnectionManager` + history) with
     `request<T>(method, params, call: (client) => Promise<T>, guard?: () => boolean): Promise<T | Stale>`.
     It owns the generation and staleness checks, timing and `logRequest`.
  2. Split three sub-models: `McpToolsModel`, `McpResourcesModel` and `McpPromptsModel`. Each owns its
     `TOneState`, its selection generation and its operations. They are exposed as
     `editor.tools`, `editor.resources` and `editor.prompts`.
     `readResource(uri, target: "static" | "template")` merges the two read methods.
  3. Add `EMPTY_SERVER_INFO` and spread it in both places.
  4. Move saved-connection state behind the model (`editor.savedConnections`).
  5. Re-expand `McpInspectorView.ts` into normal multi-line classes, ideally one panel per file.
- **Risk / notes:** `scripting/api-wrapper/McpInspectorFacade.ts` calls the current methods; keep
  delegating wrappers or update the facade in the same task.

### EDT-9: Log View entry types are not a clean extension point, and the JSONL storage logic is duplicated
- **Priority:** P2
- **Effort:** M
- **Where:** `src/renderer/editors/log-view/logTypes.ts:114-120,189-219`, `src/renderer/editors/log-view/LogEntryContent.ts:36-75,98-107,144,200-202`, `src/renderer/api/mcp/ui-push-validation.ts:11-56,136,205-208`, `src/renderer/scripting/api-wrapper/UiFacade.ts:158`, `src/renderer/editors/log-view/LogViewEditor.ts:8,138-326,336-340`
- **Problem:**
  - **The entry-type catalog is spread over four places:**
    1. `logTypes.ts`: interfaces, the unused unions `DialogEntryType`/`OutputEntryType`, and three
       `Set`s (`:201-203`);
    2. `LogEntryContent.makeChild`: a `switch` with a per-case cast (`:42-75`);
    3. `api/mcp/ui-push-validation.ts`: `KNOWN_LOG_TYPES`, `KNOWN_OUTPUT_TYPES`, `DIALOG_SPECS`, and
       per-type normalization such as `output.grid` content → data (`:11-56,172-208`);
    4. the per-type methods of `UiFacade`.

    Adding a type means editing all four, and the lists have already drifted: `log.log` is a level in
    `logTypes.ts:201` but unknown to `KNOWN_LOG_TYPES`. `OutputEntryStubView` (`:98-107`) can never be
    reached, because every type in `OUTPUT_TYPES` has a `switch` case. `isUnknownLogEntry` (`:200`)
    is never imported.
  - **Typing is erased:** children are cast through `asEntryChild(view as unknown as …)` (`:38-40`),
    and the content view updates every child with the whole `LogEntryContentProps`
    (`childView.update(props as unknown)`, `:144`), regardless of what that child's props type is.
  - **`LogViewEditor` storage duplication:**
    - the JSONL line parser is written twice (`loadContent` `:145-160`, `loadContentIncremental` `:217-232`);
    - the "find the line by id and re-serialize it" loop is written twice (`updateEntryInContent`
      `:280-289`, `flushDirtyDebounced` `:304-320`);
    - the `nextId` bump is written three times (`:164-170,237-242,336-340`).

    The editor model also imports `scripting/ai-vision/event-log` (`:8`), an editor → scripting
    dependency, and still carries "verbatim from today's LogViewModel" migration comments (`:82,136`).
- **Refactor:**
  1. Create `log-view/log-entry-types.ts` with one registry:

     ```ts
     LOG_ENTRY_TYPES: Record<string, {
         category: "log" | "dialog" | "output";
         agentDocumented: boolean;
         createView(ctx: { entry, model, updateEntry }): IEntryView;
         normalizePush?(fields): Record<string, unknown>;
         dialogSpec?: DialogSpec;
     }>
     ```

     `isLogEntry`, `isDialogEntry`, `isOutputEntry`, the ui-push known-type lists, its error message
     and `makeChild` all derive from it. Give `IEntryView` a typed `setEntry(ctx)` method instead of
     `update(props as unknown)`.
  2. Create `JsonlLogDocument`, a plain class that owns `entries`, `lastLineCount` and `nextId`, with
     `parse(content)`, `appendIncremental(content)`, `serializeEntry(id, lines)` and `nextEntryId()`.
     `LogViewEditor` keeps lifecycle, dialogs and render-change bookkeeping.
  3. Report the dialog answer through an injected callback or event, not a scripting import.
  4. Delete the dead stub, the unions and `isUnknownLogEntry`.
- **Risk / notes:**
  - The ui-push validation messages are agent-facing; keep their wording.
  - `api/mcp` must not import views. Keep the registry's view factories in `editors/log-view` and put
    the type, category and spec part in the shared module from EDT-7.

### EDT-10: The Mneme protocol is spread across five modules as raw tool-name strings, with no typed client
- **Priority:** P2
- **Effort:** M
- **Where:** `src/renderer/editors/mneme-config/MnemeConfigEditorModel.ts:213-226,268-515,580-582`, `src/renderer/editors/mneme-root/MnemeRootEditorModel.ts:92-94,262-296,341-406`, `src/renderer/api/mneme-status.ts:140-141`, `src/renderer/content/tree-providers/MnemeTreeProvider.ts:74-191`, `src/renderer/content/providers/MnemeProvider.ts:52-58`, `src/renderer/editors/mneme-config/mnemeTypes.ts:128`
- **Problem:**
  - **Raw calls everywhere:** every consumer calls
    `client.callTool({ name: "<string>", arguments: {...} }, undefined, { timeout })` and then
    `parseToolResult<T>(result)` itself. The tool names used are `status`, `add_root`, `remove_root`,
    `reindex`, `root_config`, `model_update`, `index_delete`, `list_roots`, `tags`, `search`, `write`,
    `mkdir` and `delete`.
  - **The `status` call is duplicated:** the call, its timeout and its parse appear in both
    `api/mneme-status.ts:140-141` and `MnemeConfigEditorModel.ts:217-218`.
  - **Mneme's on-disk index layout leaks into the editor:** the config editor model knows that
    indexes are stored as `.mneme/{model}-{precision}/index-v{N}.db` and walks them with `app.fs`
    (`walkRootIndexes`, `:463-494`).
  - **Path normalizers are hand-rolled three times:** `normalizePath` (`MnemeConfigEditorModel.ts:580-582`),
    `normPath` (`MnemeRootEditorModel.ts:92-94`) and `normalizePath` (`category/FolderViewModeService.ts:65-67`).
    `fpNormalizeForCompare` (`core/utils/file-path.ts:257`) already exists and is the documented path
    utility.
- **Refactor:**
  - Create `src/renderer/api/mneme-client.ts`: a typed facade over `mnemeConnection.getClient()`.
    - root management: `status()`, `listRoots()`, `addRoot(folder, name)`, `removeRoot(root)`,
      `rootConfig(root, patch?)`, `reindex(root?, { signal, onProgress })`, `listIndexes(root)`,
      `deleteIndex(...)`, `modelUpdate()`
    - content: `tags(subtree)`, `search(args)`, `read/write/mkdir/delete(path)`
  - The facade owns the timeouts and `parseToolResult`, and absorbs `parseProgressMessage`
    (`MnemeConfigEditorModel.ts:570-578`) and the index-inventory walk.
  - The editors, `mneme-status`, `MnemeProvider` and `MnemeTreeProvider` call it.
  - Replace the three normalizers with `fpNormalizeForCompare`.
- **Risk / notes:** Move `mnemeTypes.ts` into `api/types/` at the same time (EDT-7 step 2). This is
  behaviour-neutral as long as each method keeps its current timeout.

### EDT-11: Tools hub and Category editor do domain joins in views and couple to other editors' internals
- **Priority:** P2
- **Effort:** S
- **Where:** `src/renderer/editors/tools-hub/SearchBoardsTab.ts:13-15,35-40,73-88,217-226,417-516`, `src/renderer/editors/tools-hub/ToolsHubView.ts:5-7`, `src/renderer/editors/tools-hub/ToolsHubEditor.ts:31-36`, `src/renderer/editors/category/CategoryEditorModel.ts:13-15,47-51,138-142`, `src/renderer/editors/category/CategoryEditor.ts:50-52,148-163,272-278`
- **Problem:**
  - **`SearchBoardsTabView` joins three sources in the view.** It combines the published catalog,
    the install registry and the update list, keyed by `fpNormalizeForCompare(root)` (`:217-226`,
    `:428-431`), and then computes compatibility and install/update state per card (`:456-514`).
    It memoizes this with a hand-written 11-field signature comparator (`:57-88`). To call
    `boardUsageGroup` it builds `{ fileMasks, standalone } as BoardManifest` (`:35-40`) because the
    board helper takes a whole manifest. It also imports `editors/board-info` and `editors/board`
    internals (`:13-15`).
  - **`CategoryEditorModel` finds its tree-provider host by checking concrete classes:**
    `instanceof LinkEditor || ExplorerEditor || ArchiveEditor` (`:47-51`). This couples the Category
    editor to three other editors.
  - **The view mode has two sources of truth:** the Category view keeps its own `viewMode`, loads it
    asynchronously and persists it through `folderViewModeService` (`CategoryEditor.ts:148-163,272-278`),
    while the model exposes a separate synchronous `viewMode` getter (`CategoryEditorModel.ts:138-142`).
  - **Stale comment:** `ToolsHubEditor`'s doc comment says "Five content tabs"; there are four
    (`ToolsHubEditor.ts:33-34` vs `:7`).
- **Refactor:**
  1. Add `publishedBoards.listEntries(): CatalogBoardEntry[]` in `api/published-boards.ts`, returning
     `{ board, display, usageGroup, installed?, update?, compatible }`. The tab then only filters and
     renders, and an entry identity or version check replaces the signature comparator.
  2. Change `boardUsageGroup` to accept `Pick<BoardManifest, "fileMasks" | "standalone">`
     (board area).
  3. Add an `ITreeProviderHost` capability to `EditorModel` (for example an optional `treeProvider`
     getter plus `selectionState`, or a trait). `CategoryEditorModel` filters `page.panelEditors` by
     that capability, which removes the three editor imports.
  4. Move the view-mode load and persist into `CategoryEditorModel` (state field + `setViewMode`);
     the view reads it from state.
- **Risk / notes:** Step 3 touches the editor framework (cross-area). Keep `ExplorerEditor` and
  `ArchiveEditor` behaviour identical.

### EDT-12: Smaller duplicated helpers and misplaced validation
- **Priority:** P3
- **Effort:** S
- **Where:** `src/renderer/editors/about/AboutGuidePageView.ts:89-101,347-390`, `src/renderer/editors/markdown/MarkdownEditor.ts:171,179`, `src/renderer/editors/tools/tools-tree-build.ts:7-10`, `src/renderer/editors/board/boards-tree-build.ts`, `src/renderer/editors/env-vars/EnvVarsEditor.ts:293-312`, `src/renderer/api/board-vars/BoardEnvStore.ts:103-109`, `src/renderer/editors/env-vars/EnvVarsBodyView.ts:278-306`, `src/renderer/editors/settings/sections/BoardSettingsSection.ts:242-273,344-346`
- **Problem:**
  - **About:** `AboutGuidePageView` builds a duck-typed `MarkdownBodyModel` by hand and re-implements
    the Markdown search-state transitions (`:347-390`). The next/previous wrap-around is already in
    `MarkdownEditor.ts:171,179`.
  - **Tools tree:** `tools-tree-build.ts` says of itself that it is "a near-copy of
    `boards-tree-build.ts`… kept separate so the boards code stays untouched" (`:7-10`). The only
    difference is the leaf label.
  - **Board vars format:** `BoardVarsFile` has two parsers, a strict one in the editor
    (`validateBoardVarsFile`, `EnvVarsEditor.ts:293-312`) and a cast-only one in `BoardEnvStore`
    (`:103-109`). Variable-row validation (empty or duplicate names) sits in the view
    (`EnvVarsBodyView.ts:278-306`), and the model only says in a comment that it trusts the view.
  - **Board multiselect:** the comma-joined storage format is encoded inside the settings view
    (`BoardSettingsSection.ts:242-273,344-346`) and not in the board-settings types.
- **Refactor:**
  - Add `MarkdownSearchState` (open, close, setText, setMatchCount, next, prev) and a
    `createStandaloneMarkdownBodyModel()` in `editors/markdown/`, used by both the editor and About.
  - Make one `buildRootsTree<T>({ root, label }[], baseRoot?)` in `components/`, used by both the
    boards tree and the tools tree.
  - Add `parseBoardVarsFile(text): BoardVarsFile` (strict) to `api/board-vars/types.ts`, used by both
    the editor and the store. Move `validateRows` and `rowsToRecord` into
    `EnvVarsEditor.trySetProfileRows(ns, profile, rows): string | undefined`.
  - Add `encodeMultiSelect` and `decodeMultiSelect` to `api/board-settings/types.ts`.
- **Risk / notes:** The two board-vars parsers currently differ in strictness, and the store
  deliberately accepts loose files at runtime. Decide which behaviour to keep before merging them.

### EDT-13: Dead code, compatibility aliases and migration leftovers
- **Priority:** P3
- **Effort:** S
- **Where:** `src/renderer/editors/settings/sections/SettingsSections.ts:713`, `src/renderer/editors/settings/sections/{BrowserProfilesSection.ts:668,ClipboardSection.ts:123,DefaultBrowserSection.ts:131,FileSearchSection.ts:99,McpSection.ts:314,ThemeSection.ts:365}`, `src/renderer/editors/settings/index.ts:14-15`, `src/renderer/editors/about/index.ts:14`, `src/renderer/editors/mcp-inspector/McpInspectorView.ts:278`, `src/renderer/editors/mneme-config/MnemeConfigView.ts:120`, `src/renderer/editors/link-editor/panels/LinkHostnamesNavigationPanel.ts:240`, `src/renderer/editors/settings/settings-catalog.ts:242`, `src/renderer/editors/storybook/storyRegistry.ts:3-8`, `src/renderer/editors/toolset/ToolsetEditorView.ts:35-37`, `src/renderer/editors/tools-hub/SiteExtensionsTab.ts:204`, `src/renderer/editors/mneme-config/MnemeConfigEditorModel.ts:312,500`
- **Problem:**
  - **Unused alias exports:** none of these aliases has a single importer:
    - `export { XView as X }` re-exports left over from the React removal: 7 in Settings, plus
      `McpInspectorView`, `MnemeConfigView` and `LinkHostnamesNavigationPanel`;
    - `SettingsEditorModel`/`SettingsEditorModelState` and `AboutEditorModel` in the `index.ts` files.
  - **Dead log-view exports:** listed in EDT-9.
  - **Dead descriptor fields:** listed in EDT-4.
  - **Mojibake:** the catalog contains a double-encoded arrow, `call â†’ main.script.execute`
    (`settings-catalog.ts:242`). This text is agent-facing through ai-vision.
  - **Stale comments:** `storyRegistry.ts:3-8` ("keep this importer touched so Vite drops stale
    specifiers", repeated twice) and `ToolsetEditorView.ts:35-37` ("no Emotion").
  - **Untranslated literals:** `"Site extension action failed."` (`SiteExtensionsTab.ts:204`) and
    `"Reset"` (EDT-1).
  - **Magic strings that translate only by coincidence:** the raw labels `"Remove"`/`"Delete"` passed
    to `dialogButton(...)` (`MnemeConfigEditorModel.ts:312,500`) are translated only because they
    happen to equal the `DialogButton.remove`/`DialogButton.delete` ids
    (`ui/dialogs/dialog-buttons.ts:4,18,50-53`).
- **Refactor:** Delete the aliases and dead exports, and fix the mojibake. Replace the untranslated
  literals with catalog keys and the raw labels with the `DialogButton.delete`/`DialogButton.remove`
  constants. Remove the migration comments wherever the code they describe has been rewritten.
- **Risk / notes:** None. Run `npm run lint` and `npm run i18n:check` afterwards.

## Cross-area notes

- **Editor framework (`editors/base`):**
  - `createContentsRoot()` and `requireXModel(model)` are copied into about 15 editor `index.ts` and
    view files (`grep "function createContentsRoot\|function require[A-Za-z]*Model("`). A base
    `createEditorMainView(ModelClass, build)` helper would remove them.
  - `this.queue as unknown as ComponentQueue<...>` (`typedQueue`) appears in 9 editors, including
    `LinkEditor.ts:152` and `LogViewEditor.ts:94`. `EditorModel` should be generic over its queue
    event type.
  - Several child views carry model-swap rebind code that their parent forbids (link-editor
    `index.ts`, `ToolsHubView.onUpdate`).
  - EDT-11 step 3 needs a tree-provider-host capability on `EditorModel`.
- **api:**
  - `api/settings.ts:15` imports `ui/speech/microphone-cleaning-types`, which is api → ui.
  - The per-key normalizer if-chain in `settings.set` (`:408-413`) should become a schema (EDT-3).
  - `AudioProcessingStatus.mode` is `string` (`ipc/audio-channels.ts:11`).
  - `api/board-vars/board-vars-bridge.ts` → `editors/env-vars` is a circular dependency (EDT-7).
  - `api/pages/PagesLifecycleModel.ts:48` imports `editors/link-editor/link-open`.
  - `api/mcp/ui-push-validation.ts` holds a second copy of the log entry-type catalog (EDT-9).
- **Navigation ids as plain strings:** the navigation source ids `"link-category"`/`"link-tag"`/
  `"link-hostname"` and the panel ids `"link-tags"`/`"link-hostnames"` are string literals in about
  10 files across layers:
  - editors: `LinkEditor.ts:90,290-321`, `editors/shared/source-context.ts:34-180`,
    `base/editor-switch.ts:33`, `board/BoardEditorModel.ts:379-380`, `browser/BrowserPanelHost.ts:55`,
    `register-editors.ts:65-79`
  - api: `api/pages/PagesLifecycleModel.ts:654-657`
  - shared: `shared/board-source-context.ts:3`

  `"link-category"` is used both as a panel id and as a source id. A `LinkPanelId` / `NavigationSourceId`
  union with constants in `shared/` would make the contract explicit.
- **Board area:**
  - "read the manifest, then `ensureBoardDisplayText` before showing a localized name" is repeated in
    `SettingsView`, `board-shortcut.ts`, `BoardsTreeView.ts`, `request-board-trust.ts` and
    `BoardInfoEditorModel.ts`. The registry could publish ready-to-show names.
  - `boards-tree-build.ts` and `tools-tree-build.ts` are near-copies.
  - `boardUsageGroup` requires a full `BoardManifest` (EDT-11).
- **Browser area:**
  - `getPartitionString` lives in `BrowserEditorModel.ts:354`, but Settings needs it. Browser profile
    operations have no service (EDT-2).
  - The `"default"` profile-name convention is shared, unwritten, between
    `BrowserProfilesSectionModel` and `main/browser-service.ts:1188-1205`.
- **Markdown:** `MarkdownBodyModel` has to be duck-typed by any non-editor host, and its search
  transitions are copied in About (EDT-12).
- **uikit:** 42 `*.story.ts` files import `editors/storybook/storyTypes` (EDT-7 step 7).
- **Shell:** `ui/sidebar/TrustedToolsListView.ts` imports `editors/tools/ToolsTreeView`, and the Tools
  hub editor composes `ui/sidebar/EditorsTreeView`, `EditorCategoriesView` and `TrustedToolsListView`.
  Decide whether these are shared components (move them to `components/`) or shell views.
- **Docs:** `assets/guides/formats/ui-push.md` has the heading "## Errors & verification" twice
  (lines 213 and 215).

## Keep

- **`EditLinkDialog`**: the `TDialogModel` plus a registered dialog view keeps form state and save
  rules in the model and leaves the view pure. This is the right model for settings forms too.
- **`ToolsetEditorModel`** owns all IO (`reload`, `openFolder`, `openLog`, `matchesNavigationTarget`),
  and its view only renders.
- **`EnvVarsEditor`** owns the namespace/profile CRUD and selection rules, mirrors host settings
  through `mirrorHostSettings`, and refuses to serialize over a locked or invalid file.
- **`AboutGuideBrowserState`** is a small, framework-free runtime-state class owned by the editor
  model.
- **The mneme-config views** (`RootsPanel`, `ModelPanel`) delegate every action to the model. Fold the
  very long single lines back into normal formatting when touching them.
- **`McpConnectionStore` and `FolderViewModeService`** are small, focused, persisted stores. Only
  their location and path normalization need work.
- **`BoardSettingsSectionView`'s declaration-driven rendering** and **`LibraryPathSectionView`'s config
  object** are the seed of the EDT-1 field kit.
- **The Log View dialog chrome** (`DialogContainer`, `DialogHeader`, `ButtonsPanel`) is a good shared
  base for the six dialog entry views.
- **Comments that explain why logic lives where it does**, for example the comment on
  `LinkEditor.onPanelExpanded` (`LinkEditor.ts:281-287`) explaining why it is on the model and not on
  `LinkBody`, and the ownership comments in `SettingsView`'s scroll code.
