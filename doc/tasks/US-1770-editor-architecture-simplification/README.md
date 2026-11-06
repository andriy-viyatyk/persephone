# US-1770: Research — simplify editor architecture left over from the built-in Notebook

## Goal

Find the abstractions and workarounds in the editor code that existed only (or mainly) so regular
Persephone editors could render inside a Notebook note card, establish who still uses each one now
that the built-in Notebook is gone ([US-1769](../US-1769-remove-builtin-notebook/README.md), commit
`4dc1b512`), and rank the resulting simplifications. Each approved candidate becomes its own task.
This document is analysis only; no source was changed. Epic: [EPIC-137](../../epics/EPIC-137.md)
("Follow-up research (US-1770)").

## Background

### What was removed

`4dc1b512` deleted `src/renderer/editors/notebook/` (≈4,000 lines) with its facade, typings, guides,
i18n catalog and MCP/ai-vision surfaces. US-1769 deliberately kept every shared mechanism the Notebook
had driven and only rewrote Notebook-specific comments in shared files (`IContentHost.ts`,
`TextHostEditorModel.ts`, `EditorStateStorage.ts`, `TextChromeView.ts`, `editorRegistry.ts`,
`GridEditor.ts`, `HtmlBodyView.ts`, `markdown/index.ts`, `global-styles.ts`, `TextEditorModel.ts`, …).
Those rewritten comments are a reliable map of what the Notebook used.

### How embedding worked

Read from the deleted files (`git show 4dc1b512^:src/renderer/editors/notebook/...`):

- **`note-editor/NoteItemEditModel.ts`** was a duck-typed content host. It declared
  `readonly type = "textFile"` so `TextHostEditorModel`'s `isLegacyTextFileHost` check would accept it,
  started with `restored: true` so `restore()` skipped `host.restore()`, and provided:
  `getEditorState`/`setEditorState` backed by the notebook JSON (`state[noteId]["editorSettings:<editorId>"]`);
  a `stateStorage: EditorStateStorage` backed by `getNoteState`/`setNoteState`; no-op `setPage`,
  `setStorage`, `confirmRelease`, `io.saveState`; `pipe = null`; a fake `getDescriptor()`
  returning `{ kind: "noteItem" }` cast to `HostDescriptor`; and compatibility getters
  (`noLanguage`, `filePath`, `title`, `encrypted`, `decrypted`). It did **not** have
  `setEditorOverlayRef`, which is what `TextChromeView` used to tell it apart from `TextFileModel`.
- **`note-editor/NoteItemActiveEditorView.ts`** chose an arm per note: Monaco notes used the
  Notebook's own `MiniTextEditorView`; every other editor went through
  `editorRegistry.getModule(kind)` → `module.createEditor()` → `editor.adoptHost(noteHost)` →
  `editor.restore()` → `new module.BodyView({ model: editor, editorConfig })`. Disposal called
  `CONTENT_HOST_TRAIT.extractContentHost()` first so the editor would not dispose the note host.
- **`EditorConfig`** (`maxEditorHeight`, `minEditorHeight`, `hideMinimap`, `fillContainer`,
  `disableAutoFocus`, `compact`, `highlightText`) was how the note card told an embedded body to size
  to the card, skip auto-focus and highlight the notebook search.
- **`NotebookBodyView.ts:335`** mounted the expanded-note overlay into
  `editor.host.editorOverlayRef` — the `.editor-overlay` portal that `TextChromeView` creates.
- **`HtmlBodyView`** announced focus for clicks inside the sandboxed preview so the note card's
  `focusin` tracking would activate the note (commit `ce63a10f`, US-1064).

## Findings

Classification: **(a)** zero consumers — removable; **(b)** consumers remain but the abstraction is
now over-general — simplifiable; **(c)** still genuinely needed — keep.

### F1. `EditorConfig` and the embedded-mode branches in body views — (a)

- **What:** `src/renderer/editors/base/EditorConfig.ts:2-12` (`EditorConfig`, `EMPTY_EDITOR_CONFIG`),
  re-exported at `src/renderer/editors/base/index.ts:28-29`. Every body view accepts an optional
  `editorConfig` prop and branches on it:
  - `grid/GridBodyView.ts`: prop `:23`; `rootPanelProps` `:38-45` (`fit-content` vs `200`);
    `gridProps` `:62-64`, `:77` (`highlightString`), `:106-108` (`growToHeight`); constructor
    `:163-167` (`lastDisableAutoFocus`, `appliedEmbeddedMode`); `onUpdate` `:211`, `:237-245`;
    `applyRootAttributes` `:349-354`; `focusIfAllowed` `:368-372`.
  - `markdown/MarkdownBodyView.ts`: prop `:27`; `rootPanelProps` `:56-67`; `scrollPanelProps`
    `:78-96`; link-click opt-out `:172-175` ("embedded bodies leave link handling to their host");
    `:235`, `:244-245`, `:418`, `:439-445`, `:475-480`, `:497`, `:507`.
  - `svg/SvgBodyView.ts:18-30`, `mermaid/MermaidBodyView.ts:17`, `:36-46`,
    `html/HtmlBodyView.ts:45`, `:72`, `:82`, `:124-136` (`applyFrameStyle`).
  - `env-vars/EnvVarsBodyView.ts`: prop threaded through five sub-views (`:27`, `:315`, `:334`,
    `:372`, `:495`, `:586`, `:613`, `:637`, `:686`, `:772-774`); read only at `:361`
    (`disableAutoFocus`). EnvVars is not even an embeddable module (it exports no `BodyView`).
- **Why it existed:** sizing and focus rules for a body inside a fixed-height note card.
- **Consumers now:** none. Every construction site passes `{ model }` (plus `onModel` for Grid)
  only: `grid/index.ts:223`, `markdown/index.ts:162`, `svg/index.ts:117`, `html/index.ts:210`,
  `mermaid/index.ts:204`, `env-vars/index.ts:26`, and the only non-editor caller,
  `about/AboutGuidePageView.ts:210`, which deliberately passes no config (comment `:207-209`).
  A repo-wide `rg editorConfig` finds no producer. Not exposed to scripts, MCP, boards or
  `assets/editor-types/`.
- **Note:** `highlightText` in `EditorModel.ts:37`, `PageNavigator.ts`, `PagesLifecycleModel.ts`
  and the scripting/MCP `navigatePageTo` options is a different, live mechanism (it reaches Monaco via
  `TextFileModel.setHighlightText`) and is **not** part of this finding.

### F2. `EditorModule.BodyView` slot and `editorRegistry.getModule` for embedding — (a) slot / (c) accessor

- **What:** `src/renderer/editors/base/editorRegistry.ts:37-40` declares the optional chrome-free
  `BodyView?: VanillaViewCtor<{ model: EditorModel; editorConfig?: EditorConfig }>`; five modules
  fill it: `grid/index.ts:300`, `markdown/index.ts:210`, `svg/index.ts:156`, `html/index.ts:247`,
  `mermaid/index.ts:254`. `markdown/index.ts:204-210` needs an `as unknown as` cast whose only
  justification was the Notebook's same-module factory invariant.
- **Why it existed:** `NoteItemActiveEditorView.loadEmbedded` was the sole reader of
  `module.BodyView`.
- **Consumers now:** `rg "\.BodyView\b"` finds no reader — only the cast comment and the
  `getModule` doc comment (`editorRegistry.ts:347-348`). Each body class is still used directly by
  its own `*EditorView` (and `MarkdownBodyView` by the About guide browser), so the **classes** stay;
  only the module slot and the registry type's `EditorConfig` import are dead.
- `editorRegistry.getModule` itself is still used by `PagesLifecycleModel.ts:285` (`newEditorModel`)
  and `editor-switch.ts:161` (`newEditorModelForFolder`) — keep it, fix its comment.
- Documentation describes the slot as a live contract: `doc/architecture/editors.md:444-449`,
  `doc/standards/editor-guide.md:169`, `:187`, `:281`, `:419`, `doc/standards/model-view-pattern.md:23`,
  `:31`, `:38`.

### F3. The `.editor-overlay` portal — (a)

- **What:** `TextChromeView` creates an absolutely-positioned overlay `div` for text hosts and
  registers it on the host: `src/renderer/editors/base/TextChromeView.ts:266` (field), `:325`,
  `:390-391`, `:398`, `:401`, `:449`; `TextFileModel.editorOverlayRef` / `setEditorOverlayRef`
  at `src/renderer/editors/text/TextEditorModel.ts:248-252`; CSS `.editor-overlay` and
  `.editor-overlay:empty` at `src/renderer/theme/global-styles.ts:161-173`.
- **Why it existed:** the Notebook's expanded-note view portalled into it
  (`git show 4dc1b512^:src/renderer/editors/notebook/NotebookBodyView.ts`, line 335). History
  (`git log -S editorOverlayRef`) traces it to US-009 "expand note".
- **Consumers now:** `rg editorOverlayRef` matches only the field and its setter; nothing reads it.
  The overlay div is mounted in every text page and stays empty (hidden by `:empty`).
- **Coupling:** `TextChromeView`'s `isTextFileHost` (`:519-522`) uses the presence of
  `setEditorOverlayRef` as its discriminator, so F3 and F5 must be done together or in order
  (F3 first needs a replacement discriminator, or F5 removes the discriminator).

### F4. `EditorStateStorage` / `TextFileModel.stateStorage` — (a)

- **What:** interface `src/renderer/editors/base/EditorStateStorage.ts:8-24`, re-exported at
  `editors/base/index.ts:31`; implementation `TextFileModel.stateStorage` at
  `src/renderer/editors/text/TextEditorModel.ts:163-166` (cache-file passthrough to
  `fs.getCacheFile` / `fs.saveCacheFile`).
- **Why it existed:** a per-host "named state" store so an embedded editor could persist state
  without knowing whether it lived on a page (cache file) or in a note (notebook JSON). Its last two
  readers were the REST client (`RestClientEditor.saveResponseCache`, removed by `8bab479f`,
  EPIC-121) and `NoteItemEditModel`.
- **Consumers now:** `rg stateStorage` in `src/` matches only the definition and the interface
  comment. Live per-page state goes straight to `fs.getCacheFile`/`saveCacheFile`
  (`text/ScriptPanel.ts:67`, `:88`; `board/BoardEditorModel.ts:834`, `:840`), which is unaffected.
- Docs still show it on `IContentHost`: `doc/architecture/editors.md:326`,
  `doc/architecture/diagrams/4-class-hierarchy.mmd:26`, `doc/architecture/folder-structure.md:413`.
  `doc/epics/EPIC-121.md:106` is historical.

### F5. `IContentHost` as an abstraction over a single implementation — (b)

- **What:** `src/renderer/editors/base/IContentHost.ts:13-62`. `TextFileModel` is the only class
  that `implements IContentHost` (`text/TextEditorModel.ts:65`). The second implementation was always
  `NoteItemEditModel` (US-062, "Formal IContentHost implementation"); `HostDescriptor.kind`
  (`src/shared/persistence.ts:10-17`) still says "only `textFile` exists today; future host types add
  cases".
- **Generality that now only costs:**
  - 19 `as unknown as IContentHost` / `as unknown as TextFileModel` round-trip casts, e.g.
    `TextHostEditorModel.ts:84`, `:130`, `:141`, `:190`; `board/BoardContentEditorModel.ts:48`,
    `:57`, `:82`, `:96`; `board-info/BoardInfoEditorModel.ts:258`, `:267`, `:316`;
    `board/BoardEditorView.ts:89`; `api/pages/PagesLifecycleModel.ts:322`, `:379`, `:482`, `:808`;
    `api/pages/PageNavigator.ts:308`; `api/pages/PagesQueryModel.ts:179`;
    `text/TextEditorModel.ts:207`.
  - Two runtime duck-type guards that only existed to tell `TextFileModel` from the fake note host:
    `isLegacyTextFileHost` (`TextHostEditorModel.ts:16-18`, used `:191`) and `isTextFileHost`
    (`TextChromeView.ts:519-522`). The latter splits `TextChromeView` state into `host` and
    `textHost` (`:255-256`, `:345`), with 17 `textHost` null-checks guarding chrome
    (script panel, run/compare buttons, footer, overlay) that every real host has.
  - `IContentHost` unions in `ui/app/AsyncEditorView.ts:15`, `:26`, `:98`, `:117` and
    `editors/types.ts:9` sit next to `EditorOrHost` (`editors/base/index.ts:10`), which already
    includes `TextFileModel`.
  - `IContentHost.handleKeyDown?` / `onGetMenuItems?` are optional only because the note host lacked
    them (US-1769 rewrote the `IContentHost.ts` comment from "`NoteItemEditModel` may implement a
    subset").
- **Consumers now:** many — every text-bearing editor, page lifecycle, switch, board content host,
  `editorRegistry.findEditorsAccepting`/`detectContentEditor`/`AcceptanceInput.host`. Not exposed to
  scripts, MCP, board bridge or `assets/editor-types/` (checked `rg IContentHost|contentHost` in those
  places; `contentHostError` in the board facade is unrelated).
- **Classification:** (b). The host transfer itself (F7) is needed; the "any host" generality is not.

### F6. HTML preview focus announcement — (a)

- **What:** `src/renderer/editors/html/HtmlBodyView.ts:166-178`: on the injected `html:interact`
  message, `this.iframe.focus()` plus a synthetic bubbling `focusin` when the iframe is already the
  active element.
- **Why it existed:** US-1064 (`ce63a10f`, "activate a note when its HTML preview is clicked") — the
  note card's `focusin` tracking never saw clicks inside the sandboxed iframe.
- **Consumers now:** document-level `focusin` listeners are `ui/app/PagesView.ts:102` (popover
  close), `uikit/Toolbar/ToolbarView.ts:69` (scoped to the toolbar root) and
  `uikit/Tooltip/attach-tooltip.ts:232` (scoped to its trigger). The popover path does not need the
  announcement: focusing an iframe blurs the window, and `PagesView.onPopoverWindowBlur` →
  `scheduleActiveElementCheck` (`:130-139`) already closes the popover when `activeElement` is an
  `iframe`. No other ancestor tracks focus for the HTML page.
- **Keep:** the `dismissOverlays(this.iframe)` call at `:165` and the `pointerdown` ping in the
  injected script predate US-1064 and close menus/popovers — still needed.
- **Classification:** (a) for the `focus()` + synthetic `focusin` block.

### F7. Adopt/yield host transfer (`CONTENT_HOST_TRAIT`, `switchFrom`, public `adoptHost`) — (c)

- **What:** `editor-traits.ts:4-8`; `TextHostEditorModel.ts:73-87` (`extractContentHost`), `:183-206`
  (`switchFrom`), `:243-269` (`bootstrapFromHost`, public `adoptHost`); copies in
  `BoardContentEditorModel.ts:40-51`, `:90-110` and `BoardInfoEditorModel.ts:252-271`, `:300-322`.
- **Consumers now:** editor switching on every text page (`editor-switch.ts`), the open-file path
  (`PagesLifecycleModel.ts:88`, `:101`, `:106`, `:263`), Board Info's transfer
  (`board-info/open-board-info.ts:35`), and `browser/BrowserBookmarks.ts:63`
  (Link editor adopts a bookmarks host). This is the core switch mechanism, not a Notebook artifact.
- **Notebook-only part:** none of the code paths; only the `restored: true` trick and the `type`
  duck-typing (covered by F5). Keep.

### F8. Per-host editor-settings slot (`getEditorState` / `setEditorState` / `mirrorHostSettings`) — (c)

- **What:** `IContentHost.ts:50-61`; `TextFileModel.getEditorState`/`setEditorState`
  (`text/TextEditorModel.ts:366-379`, persisted as `editorSettings` in the host descriptor
  `:330`, `:357`); `TextHostEditorModel.mirrorHostSettings` (`:312-331`).
- **The epic's lead was that only EnvVars might still use it. That is not the case.** Current users
  of `mirrorHostSettings` / the slot: `monaco/MonacoEditor.ts:95-103` (word wrap, diagnostics),
  `grid/GridEditor.ts:384-401` (columns, filters, sort, search, CSV options, focus),
  `markdown/MarkdownEditor.ts:108` (compact mode), `mermaid/MermaidEditor.ts:88-109` (light mode),
  `link-editor/LinkEditor.ts:212`, `log-view/LogViewEditor.ts:118`, `env-vars/EnvVarsEditor.ts:66`.
  It is how view settings survive editor switches and restarts.
- **Notebook-only part:** only the alternative backing store in `NoteItemEditModel` (gone). The
  interface pair could move from `IContentHost` onto `TextFileModel` as part of F5, but the mechanism
  stays.

### F9. Grid "notebook slot" handling — no notebook-specific code remains — (c)

- `GridEditor.ts:44-52` mentioned the `.pnb` `editorSettings:<id>` slot only in a comment (already
  rewritten by US-1769). The serialization-narrowing (`GridColumnSetting`, `toColumnSetting`) protects
  the `openFiles.txt` host slot as well, so it stays.
- The `_pendingLegacySettings` one-shot promotion (`GridEditor.ts:180-187`, `:300-325`, `:383-392`)
  migrates pre-HS1 descriptors (`1b5a7e16`, 2026-05-22) into the host slot. It is **not** Notebook
  related; see "Other observations".

### F10. Remaining shared pieces checked and found still in use — (c)

- `MarkdownBodyModel` narrow interface (`markdown/MarkdownBodyModel.ts`): the About guide browser
  (`about/AboutGuidePageView.ts:69`, `:90-92`) feeds `MarkdownBodyView` a hand-built model. Keep.
- `editorRegistry.getSwitchOptions`: switch widget (`editor-switch-options.ts:35`), boards
  (`BoardEditorModel.ts:1140`), script API `app.editors.getSwitchOptions` (`api/editors.ts:36`). Keep.
- `detectContentEditor` / `match.detectsContent`: still used by two built-in matchers
  (`editor-matchers.ts:74`, `:106`). Keep.
- `TextFileModel.restored` / restore skip (`TextHostEditorModel.ts:219`,
  `BoardContentEditorModel.ts:158`, `BoardInfoEditorModel.ts:372`): real lazy-restore guard for shared
  hosts. Keep.
- Browser-page embedding of the Link editor (`browser/BrowserPanelHost.ts`, `BrowserBookmarks.ts`,
  `LinkBodyView` mounted directly in `BrowserView.ts:281` and `BookmarksDrawer.ts:43`) is a separate,
  live embedding path through `IPageHost`; it never used `module.BodyView` or `EditorConfig`. Keep.
- `TextareaView` `variant: "ghost"` lost its last app consumers (note comment/title fields); only
  `Textarea.story.ts` uses it now. It is a UIKit primitive, so it stays (see Keep as is).

## Ranked refactoring candidates

| Rank | Candidate | Effort | Risk | Benefit | Affected files |
|---|---|---|---|---|---|
| 1 | Remove `EditorStateStorage` and `TextFileModel.stateStorage` (F4) | S | Very low | Removes a dead interface from the host contract and docs | `editors/base/EditorStateStorage.ts` (delete), `editors/base/index.ts`, `editors/text/TextEditorModel.ts`; docs `architecture/editors.md`, `folder-structure.md`, `diagrams/4-class-hierarchy.mmd` |
| 2 | Remove the `.editor-overlay` portal (F3) | S | Low | One fewer DOM node per text page; removes dead host API and CSS | `editors/base/TextChromeView.ts`, `editors/text/TextEditorModel.ts`, `theme/global-styles.ts`; `isTextFileHost` discriminator (do with or before rank 4) |
| 3 | Remove `EditorConfig`, its embedded branches, and the `EditorModule.BodyView` slot (F1, F2) | M | Low–medium (layout code in six bodies) | Largest dead-code cut; removes the markdown cast and a registry-type import; bodies get a single layout path | `editors/base/EditorConfig.ts` (delete), `editors/base/index.ts`, `editors/base/editorRegistry.ts`; `grid/GridBodyView.ts`, `markdown/MarkdownBodyView.ts`, `svg/SvgBodyView.ts`, `mermaid/MermaidBodyView.ts`, `html/HtmlBodyView.ts`, `env-vars/EnvVarsBodyView.ts`; `grid/`, `markdown/`, `svg/`, `html/`, `mermaid/` `index.ts`; docs `architecture/editors.md`, `standards/editor-guide.md`, `standards/model-view-pattern.md`, `architecture/folder-structure.md` |
| 4 | Narrow the content-host contract to `TextFileModel` (F5) | M–L | Medium (touches switch, open, restore and board host paths) | Removes 19 casts and two runtime duck-type guards; `TextChromeView` loses its host/textHost split; types match reality | `editors/base/IContentHost.ts`, `editor-traits.ts`, `EditorModel.ts`, `TextHostEditorModel.ts`, `TextChromeView.ts`, `editorRegistry.ts`, `editor-matchers.ts`, `editors/types.ts`; `board/BoardContentEditorModel.ts`, `board/BoardEditorView.ts`, `board-info/BoardInfoEditorModel.ts`; `ui/app/AsyncEditorView.ts`; `api/pages/PagesLifecycleModel.ts`, `PageNavigator.ts`, `PagesQueryModel.ts`; `shared/persistence.ts` (comment); docs `architecture/editors.md` |
| 5 | Drop the HTML preview focus announcement (F6) | S | Low (manual popover check) | Removes a subtle workaround and its long comment | `editors/html/HtmlBodyView.ts` |

Ranks 1, 2 and 5 are independent quick wins and could be one small task. Rank 3 is independent of
the others. Rank 4 should come after rank 2 (or absorb it), because rank 2 removes the method that
`isTextFileHost` sniffs.

### 1. Remove `EditorStateStorage`

Delete the interface file and its `index.ts` export; delete `TextFileModel.stateStorage` and its
`EditorStateStorage` import. Callers that want per-page named state already use `app.fs` directly.

```ts
// text/TextEditorModel.ts — before
readonly stateStorage: EditorStateStorage = {
    getState: async (id, name) => appFs.getCacheFile(id, name),
    setState: async (id, name, state) => { await appFs.saveCacheFile(id, state, name); },
};
// after: removed (ScriptPanel and BoardEditorModel already call fs.getCacheFile/saveCacheFile)
```

Update `doc/architecture/editors.md` (the `IContentHost` sketch), the class-hierarchy diagram and
`folder-structure.md`.

### 2. Remove the `.editor-overlay` portal

Remove the `overlay` field and its creation/append/ref calls from `TextChromeView`, the
`editorOverlayRef`/`setEditorOverlayRef` pair from `TextFileModel`, and the two CSS rules. If rank 4
is not done in the same change, replace the `isTextFileHost` sniff with `host instanceof TextFileModel`
(type-only import becomes a value import; check for an import cycle `base/TextChromeView` →
`text/TextEditorModel` — `TextHostEditorModel.ts:9` already value-imports `TextFileModel`, so the
pattern exists).

### 3. Remove `EditorConfig` and the `BodyView` slot

Each body keeps only its page (non-embedded) behaviour, which is exactly what runs today because no
config is ever passed:

```ts
// grid/GridBodyView.ts — before
height: editorConfig?.maxEditorHeight !== undefined ? "fit-content" : 200,
...
growToHeight: maxEditorHeight !== undefined ...
// after
height: 200,
// growToHeight omitted; applyRootAttributes/appliedEmbeddedMode/lastDisableAutoFocus removed;
// focusIfAllowed() keeps only the !isFocusInSidebar() check
```

```ts
// markdown/MarkdownBodyView.ts — before
if (this.props.editorConfig?.maxEditorHeight !== undefined) return;   // link-click opt-out
const compact = this.props.editorConfig?.compact || this.model.state.get().compactMode;
// after
const compact = this.model.state.get().compactMode;   // link handling always on
```

Same pattern for Svg/Mermaid/Html (`flex`/`height` constants), and EnvVars drops the prop from its
five sub-views. Then remove `BodyView` from `EditorModuleCommon` and the five module objects, the
markdown cast and its comment, `EditorConfig.ts`, its two `index.ts` exports, and the `EditorConfig`
import in `editorRegistry.ts`; fix the `getModule` comment. Rewrite the editor-guide and
model-view-pattern sections that describe `BodyView` as an export contract — keep describing the
`*BodyView` class as the chrome-free part each `*EditorView` composes.

Verification: open each of Grid (JSON, CSV), Markdown (incl. link click and compact toggle and
search), SVG, HTML, Mermaid and EnvVars pages, the About guide browser, and toggle the script panel
under Grid (the `minHeight: 0` note in `GridBodyView.onMount`).

### 4. Narrow the content-host contract to `TextFileModel`

Two acceptable depths — recommend (A) first:

- **(A) Typed trait, keep the interface as documentation.** `IContentHostTrait.extractContentHost()`
  and `EditorModel.contentHost` return `TextFileModel`; `AcceptanceInput.host`,
  `findEditorsAccepting`, `detectContentEditor`, `AsyncEditorView` and `FileEditorView` take
  `TextFileModel` (or drop the redundant `| IContentHost` next to `EditorOrHost`). Delete
  `isLegacyTextFileHost` and `isTextFileHost`; `TextChromeView` keeps one `host: TextFileModel | null`
  field. `IContentHost` remains as the documented surface `TextFileModel` implements, with
  `handleKeyDown`/`onGetMenuItems` made required.
- **(B) Remove `IContentHost`.** Replace every use with `TextFileModel`; fold `IContentHostState`
  into `TextFileEditorModelState`; update `HostDescriptor`'s comment to drop "future host types".
  More churn for little extra gain.

```ts
// TextHostEditorModel.switchFrom — before
const host = trait.extractContentHost() as unknown as TextFileModel;
if (!isLegacyTextFileHost(host)) throw new Error(...);
// after (A)
const host = trait.extractContentHost();   // TextFileModel
```

Watch for: type-only import cycles (`editor-traits.ts`/`EditorModel.ts` in `base/` would import a type
from `text/TextEditorModel.ts`; keep them `import type`); the board content-host and Board Info copies
of the trait; `PagesLifecycleModel.ts:322` (`setPipe`) and `:808` (navigation highlight) lose casts.

### 5. Drop the HTML preview focus announcement

```ts
// html/HtmlBodyView.ts — before
if (data?.__persephone === "html:interact") {
    dismissOverlays(this.iframe);
    const alreadyFocused = document.activeElement === this.iframe;
    this.iframe.focus();
    if (alreadyFocused) this.iframe.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
}
// after
if (data?.__persephone === "html:interact") dismissOverlays(this.iframe);
```

Manual check: with an HTML page main and a popover page open, clicking into the preview still
closes the popover; open menus/dropdowns still dismiss on a preview click; grouped HTML page still
becomes the active side when clicked (verify — the grouped-page activation path was not traced to a
`focusin` listener, but confirm in the app).

## Keep as is

- **Adopt/yield host transfer** (`CONTENT_HOST_TRAIT`, `switchFrom`, public `adoptHost`,
  `bootstrapFromHost`) — the editor-switch and open-file mechanism for every text page, content-host
  boards and Board Info (F7).
- **Per-host editor-settings slot and `mirrorHostSettings`** — used by seven editors to keep view
  settings across switches and restarts, not just EnvVars (F8).
- **`editorRegistry.getModule`** — used by the file-open and folder-switch factories (F2).
- **Grid column-setting narrowing** (`GridColumnSetting`, `toColumnSetting`, `buildColumns`) — guards
  the `openFiles.txt` host slot and av-grid validation (F9).
- **`MarkdownBodyModel`** — the About guide browser depends on it (F10).
- **`HtmlBodyView` `dismissOverlays` + injected `pointerdown` ping** — menu dismissal (F6).
- **Body view classes themselves** (`GridBodyView`, `MarkdownBodyView`, …) — each editor view composes
  its body with `TextChromeView`; only the module-level export slot is dead (F2).
- **`TextareaView` `"ghost"` variant** — now used only by its story, but UIKit is a standalone
  primitive library; removing variants there is a UIKit decision, not an editor cleanup.

## Other observations (not Notebook-related, not ranked)

- `GridEditor._pendingLegacySettings` (`GridEditor.ts:180-187`, `:300-325`, `:383-392`) promotes
  pre-HS1 (2026-05-22) descriptors into the host slot. After one save the descriptor no longer carries
  the fields, so it could be dropped once pre-May installs are considered gone. Separate decision.
- `TextFileModel.getSelectedText()` (`TextEditorModel.ts:184-191`) always returns `""`, so
  `TextFileActionsModel.runScript` (`:58-65`) never sees a selection on that path; Monaco uses its own
  async path (`MonacoEditor.ts:159-191`). Pre-existing, unrelated to Notebook.
- `TextHostEditorModel.ts:38` still lists "Rest" as an `onHostAttached` pattern example though the REST
  client is now a board (EPIC-121). Comment-only.

## Concerns / open questions

1. **The epic's main lead does not hold.** The per-host slot (`getEditorState`/`setEditorState`,
   `mirrorHostSettings`) is used by seven editors, not only EnvVars, and must stay. The real
   Notebook residue is the embedding surface around it: `EditorConfig`, `module.BodyView`, the overlay
   portal, `EditorStateStorage`, and the multi-host generality of `IContentHost`.
2. **Do we want to keep embedding as a capability?** Ranks 2–4 remove the scaffolding that would let
   a future container embed a built-in editor body. Boards cannot use it (they get the host through
   the bridge, not editor bodies), and the Browser page embeds the Link editor through its own path.
   Recommendation: remove it; re-adding a typed embed contract later is cheaper than carrying an
   untested one. Please confirm.
3. **Rank 4 depth:** (A) typed trait with `IContentHost` kept as documentation, or (B) delete the
   interface? Recommendation (A).
4. **Rank 3 visual risk:** no caller passes a config today, so deleting the branches should be
   behaviour-preserving, but six layout code paths change and there are no automated UI tests. Each
   editor needs a quick manual pass (listed under the candidate).
5. **Body-level model swap:** `GridBodyView`, `HtmlBodyView` and `MarkdownBodyView` handle a
   different `model` in `onUpdate`, but their owning views (`grid/index.ts:253`, `html/index.ts:232`,
   `markdown/index.ts:188`) throw on a model change, so those branches look unreachable. They were not
   proven Notebook-only (the note arm also passed the same model), so they are left out of the ranking;
   worth a look while doing rank 3.
6. **Orphaned note state:** none — the per-note `editorSettings:<id>` entries lived inside
   `.note.json` files, which the Notebook board now owns. Nothing in the core reads them.
