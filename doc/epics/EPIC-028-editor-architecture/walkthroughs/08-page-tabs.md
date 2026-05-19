# 08 — Page tabs walkthrough

Scope: the tab strip — `PageTabs.tsx` (scroll/add-page split button container) and `PageTab.tsx` (one tab: language icon, title, encryption indicator, modified dot, sound button, close/group button, context menu, drag/pin/group/drop handling). Reads from `page.mainEditor` and (for text-bearing editors) the wrapped host. Writes through `pagesModel.{moveTab,pinTab,groupTabs,duplicatePage,closeOtherPages,closeToTheRight,ungroup,showPage}` and the host's file-operation methods. Cross-window drag through `api.addDragEvent` carrying a `PageDragData` payload.

**Out of scope** (own walkthroughs): the page-level toolbar slot and the switch widget (`09`); shared chrome that text-bearing editor views render INSIDE the content area (`10`); per-editor changes to title/icon/modified/language semantics (Tier 5); secondary-editor panel rendering inside the sidebar (`03`); the cross-window IPC mechanics and the source/target restore flow (`05`); the compare-mode and grouped-pages page-level state (`06` / `07`).

**Status:** Done (2026-05-20). All concerns T1–T10 resolved; mockup adjustments B1 (`PageModel.getDescriptor()`) and B2 (`EditorModel.contentHost`) landed. Cross-walkthrough refinement: GK2's helper renamed from `hasTextFileHost: boolean` to `getTextFileHost: TextFileModel | null` (single accessor consumed by both `requireGroupedText` and the 14 PageTab callsites). Real-code work for implementation is narrow — see "Migration scope handed off" in the progress entry below; all surfaces touched are within `src/renderer/ui/tabs/PageTab.tsx`, `PageTabs.tsx`, plus the `PagesQueryModel` helper add.

---

## What exists today

### `PageTabs.tsx` — the strip container

`src/renderer/ui/tabs/PageTabs.tsx:156-247`. A scrollable horizontal list of `PageTab` elements followed by an "add page" split button (main `+` icon + dropdown chevron). The container:

- Subscribes to `pagesModel.state.use()` and renders `state.pages.map(page => <PageTab key={page.id} model={page} pinnedLeft={...} />)`.
- Computes `pinnedLeft` for each pinned page by summing the widths of preceding pinned tabs. The width branches on `editor && isTextFileModel(editor) && (editor.encrypted || editor.decrypted)` — encrypted pinned tabs are wider (`pinnedTabEncryptedWidth = 3·ICON_SLOT + 4`) than plain pinned tabs (`pinnedTabWidth = 2·ICON_SLOT + 4`).
- Tracks overflow via `ResizeObserver` to show/hide scroll-arrow buttons; mouse-wheel scroll horizontally; `scrollIntoView` on the active tab when the page count changes.
- The add-page split button uses `WithMenu` to show a "creatable items" list seeded from `pinned-editors` settings (`DEFAULT_PINNED_EDITORS`).

### `PageTab.tsx` — one tab

`src/renderer/ui/tabs/PageTab.tsx:541-711`. Reads its data through three paths:

**1. Page-level reactivity** — `page.state.use((s) => ({ pinned: s.pinned, mainEditorId: s.mainEditorId }))`. Today's PageModel has no `mainEditorId` field — the current line reads it as `undefined`, kept here for the rewire. After this epic the field exists (walkthrough 01 / A8) and is the trigger for "tab needs to re-evaluate" when the main editor swaps.

**2. Editor state** — `useOptionalState(editor.state, selector)` reads a flat `IEditorState`-shaped subset: `title`, `modified`, `language`, `filePath`, `deleted`, `password`, `encrypted`, `temp`, `favicon`, `_anyTabAudible`, `pageMuted`. Provides safe defaults when the editor is null.

**3. Direct getters** — `editor.encrypted`, `editor.decrypted`, `editor.withEncryption` (TextFileModel-specific), `editor.noLanguage`, `editor.getIcon`, `(editor as any).toggleMuteAll`.

The tab renders, in order: a sticky pinned-tab tooltip overlay (when pinned with a `filePath`), a language picker `IconButton` (or a custom `getIcon` for non-text editors via `noLanguage`), a title-label span with an inline 🔒/🔓 encryption icon when applicable, a conditional sound button, and a close button (close icon for ungrouped; `GroupIcon` for grouped).

### Tab-level interactions

- **`handleClick`** — Ctrl+click on a non-active tab calls `pagesModel.groupTabs(activeId, pageId, true)` then `pagesModel.showPage(pageId)`. Plain click just `showPage(pageId)`.
- **`closeClick`** — Close button. If grouped: `pagesModel.ungroup(page.id)` + `pagesModel.fixCompareMode()` + `pagesModel.showPage(page.id)`. Otherwise: `page.close()`.
- **`handleContextMenu`** — Builds a `ContextMenuEvent` and pushes 13 items: Pin/Unpin Tab, Close Tab (×3 variants), Duplicate Tab, Open in New Window, Save, Save As, Rename, Show in File Explorer, Copy File Path, Decrypt / Encrypt / Make Unencrypted. Most of those are guarded by `editor instanceof TextFileModel` or `isTextFileModel(editor)`.
- **`renameTab`** — Asks the user for a new filename via `ui.input`, then calls `editor.renameFile(newName)` on the TextFileModel.
- **`encryptionClick`** — Click on the inline 🔒/🔓 icon. Routes to `editor.showEncryptionDialog()` (encrypted) or `editor.encryptWithCurrentPassword()` (decrypted).
- **`getLanguageMenuItems`** — Reads `editor.state.get().language` for the current selection; builds a sorted menu over `monacoLanguages`; clicking calls `editor.changeLanguage(lang.id)` (a TextFileModel method today) and bumps `tab-recent-languages` in settings.

### Drag and drop

Three distinct drag flows funnel through `PageTab`:

1. **Same-window reorder** — `setTraitDragData(e.dataTransfer, TraitTypeId.PageTab, { key: page.id })` on drag-start; `handleDrop` reads via `getTraitDragData(e.dataTransfer)` and calls `pagesModel.moveTab(data.key, targetId)`. Trait-based mechanism — pure page-id payload.

2. **Cross-window drop-in** — On drag-start of a non-pinned tab, also `e.dataTransfer.setData("application/persephone-tab", JSON.stringify(getDragData()))`. The target window's drop handler reads that MIME, sees `sourceWindowIndex !== targetWindowIndex`, and re-fires `api.addDragEvent(getDragData(true))` (the `true` flips drop side to target).

3. **Drag-out to empty desktop** — `handleDragEnd` checks `e.clientX/Y` outside the window; if so, calls `api.addDragEvent({...getDragData(), dropPosition: { x: screenX, y: screenY }})`. Main process spawns a new window at the drop coords and ferries the descriptor.

`getDragData(drop = false)` returns:
```ts
{
    sourceWindowIndex: drop ? undefined : appWindow.windowIndex,
    targetWindowIndex: drop ? appWindow.windowIndex : undefined,
    page: {
        id: page.id,
        pinned: page.pinned,
        modified: page.modified,
        hasSidebar: page.hasSidebar,
        editor: editor?.getRestoreData() ?? {},
    },
}
```

The payload shape — `PageDescriptor` from `src/shared/types.ts` — is the same one persistence uses on disk and the same one `movePageIn` / `movePageOut` consume on the IPC channel.

### Cross-walkthrough touch points already known

- **Walkthrough 01 / A8** — `page.state.mainEditorId` now exists. The tab's `s.mainEditorId` read becomes load-bearing (was a placeholder).
- **Walkthrough 02 / S10** — `IEditorState.type` removed, `isTextFileModel` type guard deleted. Every `isTextFileModel(editor)` callsite in PageTab.tsx (14 of them) flips to a different predicate.
- **Walkthrough 04 / P1** — `PageDescriptor` shape changes from `{ id, pinned, modified, hasSidebar, editor: Partial<IEditorState> }` to `{ id, pinned, modified, mainEditorId, editors: EditorDescriptor[], sidebar? }`. `getDragData` must produce the new shape.
- **Walkthrough 04 / C9** — host fields (filePath, encrypted, encoding, content) live on TextFileModel state, NOT on the editor. Tab reads of `editor.state.get().filePath`, `editor.encrypted`, etc. need to follow the host.
- **Walkthrough 06 / CK6 + CK7** — `pagesModel.fixCompareMode()` deleted; `ungroup` carries cleanup. `closeClick` already addressed by walkthrough 07 / GK4 (drop the explicit call).
- **Walkthrough 07 / GK10** — `findPage(id)` works under unified `editors[]`. Tab IDs in trait drag payloads still resolve via `pagesModel.moveTab`.

---

## What the new arch needs

Same observable behavior for every tab interaction:
- Title / modified dot / language icon / encryption icon / temp italics / deleted red render the same on every editor type they apply to today.
- Pinned tabs sit in the sticky section with the same width math, including the encrypted-wider variant.
- Ctrl+click groups, plain click activates, close button closes (or ungroups), context menu items behave identically.
- Drag reorder, drag to new window, drop-in from another window all work.

What changes internally:
- The tab's source-of-truth for "what does this tab look like" splits across editor state and host state for text-bearing editors. Reactivity has to cover both.
- Every TextFileModel-only context-menu item (Save, Save As, Rename, Show in File Explorer, Copy Path, Decrypt, Encrypt, Make Unencrypted) calls a host method, not an editor method.
- The drag payload picks up the new `PageDescriptor` shape (`mainEditorId` + `editors[]` + optional `sidebar`).
- `isTextFileModel(editor)` is no longer the discriminator — the predicate is "the editor wraps a TextFileModel host," expressed via `editor instanceof TextFileModel` no longer existing because the editor isn't a `TextFileModel` any more. The check moves to `host instanceof TextFileModel` via whichever accessor the editor exposes.

What stays:
- `PageTabs.tsx` scroll/overflow/add-page-split-button — no editor or host references; carries over verbatim.
- The trait-based same-window reorder (`TraitTypeId.PageTab`, payload `{ key: pageId }`) — page-id only, untouched by the editor/host refactor.
- Audio fields and `toggleMuteAll` — browser-editor-specific; the duck-typed read stays a duck-typed read (one consumer).
- `pagesModel.moveTab`, `pinTab`, `unpinTab`, `closeOtherPages`, `closeToTheRight`, `duplicatePage`, `groupTabs`, `ungroup`, `showPage` — all of these operate on page ids and survive untouched (per walkthroughs 01, 03, 06, 07).
- `api.addDragEvent` — IPC contract unchanged; only the payload shape changes (per walkthrough 05 / M1).

---

## How mockups handle this

Most of the tab work is real-code wiring against existing mockup shapes; nothing here needs new foundation primitives.

- **`editor.title` / `editor.modified`** — already exposed as base-class getters in `mockups/EditorModel.ts:345-347`. Tab reads through these instead of `editor.state.get().title`. For text-bearing editors, `editor.modified` will delegate to the wrapped host's modified flag (subclass override or constructor-time forward — surfaced in T1).
- **`mainEditorId` reactivity** — `mockups/PageModel.ts:73-78` defines `IPageState.mainEditorId`. Page-state subscription `(s) => s.mainEditorId` re-renders the tab when the main editor swaps.
- **Host access pattern** — `mockups/EditorModel.ts:352-354` notes the implied `editor.contentHost` getter. Tab needs this getter (or whichever name lands) to reach the host for `filePath`, `encrypted`, `language`, `saveFile`, `renameFile`, etc. T1 + T2 nail the exact accessor name.
- **`CONTENT_HOST_TRAIT` predicate** — `mockups/traits.ts:63`. Wherever "can save? can encrypt? can rename?" is asked today via `isTextFileModel(editor)`, the new check is `editor.traits.has(CONTENT_HOST_TRAIT) && editor.contentHost instanceof TextFileModel`. T2 chooses the canonical idiom.
- **Drag payload composition** — `mockups/PersistenceTypes.ts:103-115`: `PageDescriptor` shape. The two builders (`getDragData` in PageTab.tsx, `saveState` in PagesPersistenceModel.ts) consume the same shape; T3 decides whether to factor a `page.getDescriptor()` helper.
- **`closeClick` simplification** — `mockups/PageModel.ts` and walkthrough 06 / CK7 / 07 / GK4 already cover this; T7 is a confirmation.

---

## Concerns

### T1 — Tab read-surface: editor + host state subscription

Today's tab reads everything through `useOptionalState(editor.state, selector)`. After the host split:
- `title`, `modified`, `secondaryEditor` live on `editor.state` (base shape from `mockups/EditorModel.ts:52-60`).
- `language` lives on `host.state` (per `IContentHostState` in `mockups/IContentHost.ts:38-47`).
- `filePath`, `encrypted`, `encoding`, `temp` live on `host.state` for TextFileModel (per `mockups/TextFileModel.ts:40-56`).
- `favicon`, `_anyTabAudible`, `pageMuted` live on browser-editor's `editor.state` (no host involved).
- `deleted` — currently on TextFileModel host state; mockup comment notes it can move to TextFileIOModel.

So the tab needs reactivity over BOTH `editor.state` AND `editor.contentHost?.state` (when present). Options:

- **(a) Two parallel `use()` subscriptions** — `editor.state.use(editorSelector)` for editor-owned fields, `editor.contentHost?.state.use(hostSelector)` (or a fallback when null) for host-owned fields. Two re-renders possible on a single mutation that touches both; in practice each field lives on exactly one. Component reads stay close to where today's are.

- **(b) Aggregator getters on the editor** — base class exposes `editor.language`, `editor.filePath`, `editor.encrypted` as delegating getters; text-bearing editors override to read from the host. Tab subscribes only to `editor.state.use()` and reads the getters directly during render. Requires a re-render trigger for host-driven changes — solved by the existing `descriptorChanged` Subscription on `EditorModel` (walkthrough 01 / A6) being forwarded into the editor's state version-bump, OR by a derived state slice on the editor that mirrors what the tab needs.

- **(c) Dedicated `tabView` derived slice on EditorModel** — a base method `getTabView(): { title, modified, language, filePath, encrypted, hasEncryption, temp, deleted, favicon, audible, muted }` returning the union; tab calls it during render and subscribes to a single `tabView$` Observable or to a coarse `editor.state.use()` + manual `host.state.use()` pair behind the method. Strong abstraction; new surface to maintain.

**Recommendation: (a).** Two `use()` calls is the lightest fix. Both stores already exist; both already drive re-renders. Today's `useOptionalState(editor.state, …)` is already a defensive guard against null editors; the host path mirrors that pattern with one extra `?.` chain. `(b)` is appealing for the call-site simplicity but conflates the layers we just separated — moving `filePath` onto `editor.language` would be a small re-creation of the flat `IEditorState`. `(c)` is over-engineering for one consumer. Tier 2's tab read-surface is the only place this question recurs.

### T2 — `isTextFileModel(editor)` retirement: 14 callsites, new pattern

`PageTab.tsx` has 14 references to `isTextFileModel(editor)` or `editor instanceof TextFileModel`. They split into three uses:

1. **Predicates** in conditionals: "can this tab show a Decrypt context-menu item?" "should the pinned-tab width math read encryption?" "should the language icon menu be the language picker or the editor's own getIcon?"
2. **Type guards** before calling a TextFileModel-only method: `if (editor && isTextFileModel(editor)) editor.saveFile(false)`.
3. **Reading TextFileModel-only fields**: `editor.encrypted`, `editor.decrypted`, `editor.withEncryption`.

After EPIC-028 the editor is NOT a TextFileModel — the editor (Monaco, Grid, …) wraps a TextFileModel host. The predicate has to flip to the host:

- **(a) `editor.contentHost instanceof TextFileModel`** — assumes EditorModel exposes a `contentHost: IContentHost | null` getter. Predicate becomes the new universal check; type guard becomes `const host = editor.contentHost; if (host instanceof TextFileModel) host.saveFile(false)`; field reads become `host.encrypted`, `host.decrypted`, `host.withEncryption`.
- **(b) `editor.traits.has(CONTENT_HOST_TRAIT)` for the predicate, `editor.contentHost instanceof TextFileModel` for the host-specific narrowing** — distinguishes "any host-bearing editor" from "TextFileModel-host-bearing editor." Today the only host is TextFileModel; only NoteItemEditModel will join (per C4). Predicate would still resolve to `instanceof TextFileModel` everywhere in the tab — until NoteItemEditModel lands.
- **(c) Centralized helper on the editor** — `editor.host` (typed `TextFileModel | null` once the only host type is committed, retyped to `IContentHost | null` when a second host lands) returned by an `editor.host` getter. Same as (a) but with a shorter name.
- **(b1) Refine GK2's helper into a typed accessor on `PagesQueryModel`** — `pagesModel.query.getTextFileHost(pageId): TextFileModel | null` (renames GK2's `hasTextFileHost: boolean`; same lookup, more useful return shape). Tab callsites cache once per render (`const host = pagesModel.query.getTextFileHost(page.id);`); truthy check works as predicate; same value drives method calls. Subsumes GK2's boolean helper — predicate-only callers (like `requireGroupedText`) use `!=null` checks; accessor-needing callers (PageTab + future similar surfaces) use the typed value. CK3's `canCompare(leftId, rightId)` stays a separate two-id boolean (no single thing to return; doesn't fit the accessor family).

**Recommendation: (b1).** Established by user review 2026-05-20 in favor of pattern consistency with the GK2 / CK3 helper family already centralized on `PagesQueryModel`. (a) was the original proposal but leaves scatter — every tab callsite carries `editor?.contentHost instanceof TextFileModel`. (b1) collapses to one typed lookup per render, narrows both predicate and host-method paths with a single value, and ladders cleanly into `requireGroupedText` (drops its trailing `as unknown as TextFileModel` cast). EditorModel still gets the `contentHost: IContentHost | null` accessor (B2 — needed by the chrome/switch widget, walkthroughs 09 / 10), but PageTab consumes the host through the centralized query path. When NoteItemEditModel arrives (walkthrough 29 — outside Tier 2 scope), each callsite that touched encryption / saveFile / renameFile stays narrowed to TextFileModel — those concepts don't apply to notebook notes; the helper signature stays `TextFileModel | null` until a NoteItem-host equivalent need surfaces.

### T3 — Drag payload composition: `page.getDescriptor()` helper or inline composition

The new `PageDescriptor` shape from walkthrough 04 / P1:
```ts
{
    id: string;
    pinned: boolean;
    modified: boolean;
    mainEditorId: string | null;
    editors: EditorDescriptor[];
    sidebar?: { open: boolean; width: number; activePanel: string };
}
```

Today two callers build this shape:
1. **`PagesPersistenceModel.saveState`** (`src/renderer/api/pages/PagesPersistenceModel.ts:20-42`) — inline, per-page map.
2. **`PageTab.getDragData`** (`src/renderer/ui/tabs/PageTab.tsx:419-433`) — inline, single page.

The new shape is more elaborate (the `editors[]` array + optional `sidebar` block), and `editors[]` requires mapping every editor's `getRestoreData()` plus pulling sidebar metadata off `pageNavigatorModel`. Two inline copies of that composition is risky — they will drift.

Options:

- **(a) Add `PageModel.getDescriptor(): PageDescriptor`** — single source of truth, used by both callers. Method body:
  ```ts
  getDescriptor(): PageDescriptor {
      return {
          id: this.id, pinned: this.pinned, modified: this.modified,
          mainEditorId: this._mainEditorId,
          editors: this.editors.map((e) => e.getRestoreData()),
          sidebar: this.pageNavigatorModel ? {
              open: this.pageNavigatorModel.open,
              width: this.pageNavigatorModel.width,
              activePanel: this.activePanel,
          } : undefined,
      };
  }
  ```
- **(b) Inline composition in both callers** — today's pattern. Two places to update if `PageDescriptor` shape changes again. Same risk as today.
- **(c) Free helper in PagesPersistenceModel** — `static pageToDescriptor(page): PageDescriptor` shared between `saveState` and `PageTab`. Same SoT as (a) but lives in the persistence layer.

**Recommendation: (a).** Both walkthroughs 04 and 05 named persistence and IPC drag as the two consumers of the descriptor shape — having the page itself describe its persisted form follows the same logic as `EditorModel.getRestoreData()` (each editor describes itself; one method, multiple consumers). `(c)` is acceptable but puts the helper farther from the data; `(a)` makes the tab's `getDragData` collapse to `{ ...windowMetadata, page: this.props.model.getDescriptor() }` — three lines, no shape knowledge.

### T4 — `editor.noLanguage` and `editor.getIcon` discoverability

Today's `PageTab.tsx:637` branches on `editor?.noLanguage` to render either a custom-icon placeholder (calls `editor.getIcon()` if defined) or the language-picker `IconButton`. Both fields are loose properties on `EditorModel` (`getIcon?: () => React.ReactNode`, `noLanguage = false`).

After the host split, "shows a language picker" is equivalent to "the editor's content host owns a language." The current EditorModel mockup keeps both fields (`mockups/EditorModel.ts:419-421`):

```ts
getIcon?: () => React.ReactNode;
noLanguage = false;
```

Options:

- **(a) Keep `noLanguage` and `getIcon` as explicit EditorModel base fields** — today's pattern. Per-editor opt-in for both. Pros: trivial, matches today.
- **(b) Derive `noLanguage` from `traits.has(CONTENT_HOST_TRAIT)`** — text-bearing editors have a host with language; non-text editors don't. Predicate becomes implicit. Pros: one less property per subclass. Cons: bundles a UI concern ("show language picker") with a structural fact ("wraps a host"). What about a hypothetical text-bearing editor that wants to hide the language picker? (Doesn't exist today.)
- **(c) Move both into the editor's registry descriptor (`mockups/editorRegistry.ts`)** — declare per class statically. Tab queries registry at render time. Decouples UI metadata from runtime EditorModel instances.

**Recommendation: (a).** `noLanguage` is a UI flag — independent enough from the structural trait that overloading the trait is the wrong move. (c) sounds elegant but adds a registry lookup per render for two fields that EditorModel already has. Tabs read these as direct properties on `editor` today; that pattern survives unchanged. `noLanguage` default remains `false` (text-bearing default); non-text editors continue setting it on the subclass.

### T5 — Audio fields duck-typing: keep as-is or formalize

`PageTab.tsx` reads three audio fields:
- `_anyTabAudible` from `editor.state.get()` (a per-tab BrowserView audio flag)
- `pageMuted` from `editor.state.get()`
- `editor.toggleMuteAll` — duck-typed via `(editor as any)?.toggleMuteAll`

All three are exclusively used by `BrowserEditorModel`. Today's pattern relies on the flat `IEditorState` having every possible field; `useOptionalState`'s selector provides defaults.

Options:

- **(a) Keep duck-typing** — browser editor's own state shape extends EditorStateBase with audio fields; tab's selector reads them defensively (`(s as any)?.favicon ?? ""`). One consumer, no abstraction.
- **(b) Formalize as `editor.audio?: AudioCapability` interface** — `interface AudioCapability { audible: boolean; muted: boolean; toggleMute(): void }`. BrowserEditorModel implements it. Tab calls `editor.audio?.muted` / `editor.audio?.toggleMute()`. Cleaner; introduces a typed interface for a single editor type.
- **(c) Editor-side trait `AUDIO_TRAIT`** — same shape as (b) but registered through `editor.traits`. Forward-compat for hypothetical future audio sources (video editor?).

**Recommendation: (a).** YAGNI — one consumer, one provider, no pluggability requirement. The duck-typed `(editor as any)?.toggleMuteAll` is ugly but isolated. If a second audio source appears (video editor: walkthrough 30), revisit with (b). The browser editor's state shape declares these fields publicly on its subclass-defined state interface — tab's selector with defaults reads them safely.

### T6 — Pinned-tab encryption-width branch

`PageTabs.tsx:206`:
```ts
const editor = p.mainEditor;
const isEnc = editor && isTextFileModel(editor) && (editor.encrypted || editor.decrypted);
pinnedLeft += (isEnc ? pinnedTabEncryptedWidth : pinnedTabWidth) + 2;
```

The encryption width branch needs the same flip as T2 — `isTextFileModel(editor)` becomes `editor.contentHost instanceof TextFileModel`. The `editor.encrypted` / `editor.decrypted` reads become host reads.

Options:

- **(a-helper) Inline the GK2 helper from T2's resolution** — `const host = pagesModel.query.getTextFileHost(p.id); const isEnc = host && (host.encrypted || host.decrypted);`. Same idiom as PageTab (T2). Single typed lookup; truthy check + field access in one branch.
- **(a-inline) Inline `editor.contentHost instanceof TextFileModel`** — the original T6 (a). Superseded once T2 landed on the helper.
- **(b) Extract a `pinnedWidth(page: PageModel): number` helper** — encapsulates the math. Single source if width constants change.

**Recommendation: (a-helper).** Matches T2's resolution — single canonical predicate (`getTextFileHost`) consumed wherever the host's encryption fields are read. (b) is premature factoring for one callsite; widths and `+2` column gap stay inline in `PageTabs.tsx`. The original (a-inline) recommendation is superseded by T2's helper-based pattern.

### T7 — `closeClick` redundant `fixCompareMode()` call

`PageTab.closeClick`:
```ts
if (this.isGrouped) {
    pagesModel.ungroup(page.id);
    pagesModel.fixCompareMode();  // ← redundant per CK7
    pagesModel.showPage(page.id);
}
```

Already addressed by walkthrough 06 / CK6 (delete `fixCompareMode` method) and CK7 (fold cleanup into `ungroup`), and explicitly noted by walkthrough 07 / GK4 (drop the call from `closeClick`).

Options:

- **(a) Drop the call.** Walkthrough 07's resolution; nothing new to decide here.
- **(b) Keep belt-and-suspenders.** Cargo-cult rejected by CK6 / GK4.

**Recommendation: (a) (confirmation).** This concern is here purely so the implementation-time checklist for `PageTab.tsx` doesn't miss the line. No new analysis.

### T8 — `handleClick` Ctrl+group invariants under unified `editors[]`

`PageTab.handleClick` (Ctrl+click branch):
```ts
const activeId = pagesModel.activePage?.id;
if (activeId !== pageId) {
    pagesModel.groupTabs(activeId, pageId, true);
}
```

`groupTabs` accepts either page id or editor id and resolves via `findPage`. Walkthrough 01 / A8 + walkthrough 03 already migrated `findPage` to the unified `editors[]` shape (per GK10). `groupTabs(pageId, pageId, true)` ⟶ both inputs are page ids ⟶ resolution is a direct page-id match.

Options:

- **(a) No change.** Ctrl+click still resolves correctly; `groupTabs` behavior is page-level layout state untouched by editor refactor.
- **(b) Inline the resolution to skip `findPage`** — pass page directly, skipping one lookup. Premature.

**Recommendation: (a) (confirmation).** Same reasoning as walkthrough 07 / GK10. No code change. Listed here so the implementer doesn't waste time wondering.

### T9 — Drag-out (`handleDragEnd`) interaction with walkthrough 05's `saveState`

`PageTab.handleDragEnd`:
```ts
if (droppedOutside) {
    const dropData: PageDragData = this.getDragData();
    dropData.dropPosition = { x: e.screenX, y: e.screenY };
    api.addDragEvent(dropData);
}
```

Walkthrough 05 / M3 establishes `await page.saveState()` is called inside `PagesLifecycleModel.movePageOut`, not at the tab level. `api.addDragEvent` queues an IPC event; the source-side `movePageOut` (in `PagesLifecycleModel`) runs the saveState then the splice-detach. Tab doesn't await anything.

Options:

- **(a) No change in the tab.** saveState lives at the lifecycle layer; tab fires the IPC event and forgets.
- **(b) Await `page.saveState()` here before `api.addDragEvent`.** Duplicates M3's responsibility.

**Recommendation: (a) (confirmation).** Walkthrough 05 explicitly puts the flush inside `movePageOut`. The IPC event triggers `movePageOut` on the source side; the saveState invariant holds. Tab's drag-end stays a pure dispatch.

### T10 — Same-window reorder trait payload

`setTraitDragData(e.dataTransfer, TraitTypeId.PageTab, { key: page.id })` + `getTraitDragData(e.dataTransfer)` + `pagesModel.moveTab(data.key, id)`. Pure page-id payload; trait system is in-process within one renderer.

Options:

- **(a) Keep as-is.** Page-id payload survives the unified `editors[]` migration; `pagesModel.moveTab` resolves via `findPage` (walkthrough 07 / GK10).
- **(b) Switch to a page-id-or-editor-id payload** — flexibility for "drag from editor surface area" (rare). Adds complexity for no current consumer.

**Recommendation: (a) (confirmation).** Same as T8: page-id payload is the trait system's expected shape; nothing needs touching.

---

## Proposed mockup adjustments

One mockup adjustment + one EditorModel API addition surfaced by this walkthrough.

### B1 — `PageModel.getDescriptor(): PageDescriptor`

Per T3, add to `mockups/PageModel.ts`:

```ts
/**
 * Build the page's serialized descriptor. Single source of truth for the
 * PageDescriptor shape — consumed by:
 *   - PagesPersistenceModel.saveState  (per-window file write)
 *   - PageTab.getDragData              (cross-window drag payload)
 *   - PagesLifecycleModel.duplicatePage (optional — fresh ids on the copy)
 *
 * Mirrors EditorModel.getRestoreData(): each layer describes itself; many
 * consumers read the same shape.
 */
getDescriptor(): PageDescriptor {
    return {
        id: this.id,
        pinned: this.pinned,
        modified: this.modified,
        mainEditorId: this._mainEditorId,
        editors: this.editors.map((e) => e.getRestoreData()),
        sidebar: this.pageNavigatorModel ? {
            open: this.pageNavigatorModel.open,
            width: this.pageNavigatorModel.width,
            activePanel: this.activePanel,
        } : undefined,
    };
}
```

This eliminates a known drift risk between the persistence and drag composition paths and shrinks `getDragData` to one line. Walkthrough 04's mockup didn't add it because the question hadn't been forced yet — walkthrough 08's two callers force it now.

### B2 — `EditorModel.contentHost: IContentHost | null` accessor

Per T2 / T4, add to `mockups/EditorModel.ts` (the comment at line 352-354 already foreshadows it):

```ts
/**
 * The IContentHost this editor wraps, if any. Returns null for editors
 * without a content host (PDF, Image, Browser, …).
 *
 * Text-bearing editors return their internal `_host: TextFileModel` field.
 * NoteItemEditModel-wrapping editors (walkthrough 29) return that host.
 *
 * Tab strip, switch widget, and context menus all reach the host through
 * this accessor. Replaces today's `isTextFileModel(editor)` followed by
 * direct TextFileModel-typed field reads.
 */
get contentHost(): IContentHost | null {
    return null;
}
```

Subclass overrides:
```ts
// In every text-bearing editor (Monaco, Grid, Markdown, Mermaid, Link, ...)
private _host: TextFileModel | null = null;
get contentHost(): IContentHost | null { return this._host; }
```

The mockup comment at line 352-354 implies this getter exists; B2 makes it explicit on the base class so subclasses just override.

No other mockup changes required.

---

## Open questions

None outstanding after T1–T10 resolve. The two mockup additions (B1, B2) are the only non-real-code changes; everything else is `PageTab.tsx` / `PageTabs.tsx` rewires.

---

## Files NOT changing

- `mockups/IContentHost.ts` — `getDescriptor()` already there; nothing for the tab to add to the host interface.
- `mockups/traits.ts` — `CONTENT_HOST_TRAIT` shape unchanged.
- `mockups/PersistenceTypes.ts` — `PageDescriptor` already defined for walkthrough 04; B1 only adds a producer of that shape.
- `mockups/editorRegistry.ts` — tab doesn't touch the registry.
- `mockups/ComponentQueue.ts` / `TOneState.ts` — tab uses neither.
- `src/renderer/uikit/IconButton.tsx`, `WithMenu.tsx`, `Tooltip.tsx`, `Divider.tsx` — pure UIKit primitives, no editor coupling.
- `src/renderer/api/pages/PagesLayoutModel.ts` (group/ungroup/pinTab/unpinTab/moveTab/moveTabByIndex/closeOtherPages/closeToTheRight) — page-id-keyed, untouched by editor refactor.
- `src/renderer/api/pages/PagesNavigationModel.ts` (`showPage`) — unchanged.
- `src/renderer/api/pages/PagesLifecycleModel.ts` `duplicatePage` — consumes the descriptor (covered by walkthrough 05 / M2's restorePage); tab calls it by page id, no shape knowledge.
- `src/renderer/core/traits/dnd.ts` — trait drag/drop primitives stay verbatim.
- `src/renderer/components/icons/LanguageIcon.tsx`, `src/renderer/theme/icons/*` — pure visuals.
- `src/ipc/renderer/api.ts` `addDragEvent`, `showItemInFolder` — IPC contracts unchanged (payload shape changes are descriptor-level, not API-level).
- `src/main/drag-model.ts`, `src/main/open-windows.ts` — main-process drag handlers; walkthrough 05 already covered IPC payload shape.
- `src/renderer/api/window.ts` `appWindow.windowIndex` — unchanged.
- `src/renderer/api/settings.ts` `tab-recent-languages`, `pinned-editors`, `browser-profiles` — settings unchanged.
- `src/renderer/ui/sidebar/tools-editors-registry.ts` `getCreatableItems`, `DEFAULT_PINNED_EDITORS` — used by the add-page split menu; surface unchanged.

---

## Status checklist

- [x] T1 — Tab read-surface — **(a)** two parallel `use()` subscriptions: `editor.state.use()` for editor-owned fields (`title`, `modified`, `secondaryEditor`, plus BrowserEditor's `favicon` / audio fields), `editor.contentHost?.state.use()` for host-owned fields (`language`, `filePath`, `encrypted`, `encoding`, `temp`, `deleted`). Mirrors today's defensive `useOptionalState` shape with one extra `?.` chain. Rejected (b) aggregator-getters as re-creating the flat `IEditorState` shape just split, and (c) dedicated `tabView` slice as one-consumer over-engineering
- [x] T2 — `isTextFileModel(editor)` retirement — **(b1)** add `pagesModel.query.getTextFileHost(pageId): TextFileModel | null` accessor (refines GK2's `hasTextFileHost: boolean` into a single helper that returns the typed host). All 14 PageTab callsites cache once per render: `const host = pagesModel.query.getTextFileHost(page.id);` then read fields via `host?.encrypted` / `host?.decrypted` / `host?.withEncryption` / `host?.filePath` and call methods via `if (host) host.saveFile()` / `host.renameFile(name)` / `host.showEncryptionDialog()` / `host.encryptWithCurrentPassword()` / `host.makeUnencrypted()`. GK2's boolean predicate is subsumed by the truthy check; `requireGroupedText` rewrites to use the accessor directly (drops the trailing `as unknown as TextFileModel` cast). CK3's `canCompare(leftId, rightId)` stays a separate two-id predicate — different shape, doesn't fit the accessor family. Rejected (b2) split helper-for-predicate + cast-for-method (awkward two-pattern split) and (b3) inline `editor.contentHost instanceof TextFileModel` (inconsistent with GK2's centralized predicate pattern)
- [x] T3 — Drag payload composition — **(a)** add `PageModel.getDescriptor(): PageDescriptor` (B1 mockup). Single source of truth for the new descriptor shape (walkthrough 04 / P1); consumed by `PagesPersistenceModel.saveState` (per-window save), `PageTab.getDragData` (cross-window drag payload), and optionally `PagesLifecycleModel.duplicatePage` (with fresh ids). Tab's `getDragData` collapses to `{ ...windowMetadata, page: this.props.model.getDescriptor() }` — three lines, no shape knowledge. Mirrors `EditorModel.getRestoreData()` philosophy: each layer describes itself; many consumers read the same shape. Rejected (b) inline composition in two callers (drift risk) and (c) free helper in PagesPersistenceModel (puts the producer farther from the data)
- [x] T4 — `noLanguage` / `getIcon` discoverability — **(a)** keep both as explicit EditorModel base fields (already in `mockups/EditorModel.ts:419-421`: `getIcon?: () => React.ReactNode` and `noLanguage = false`). Per-editor opt-in, identical to today's pattern. UI flag is independent of structural fact — bundling "show language picker" with `traits.has(CONTENT_HOST_TRAIT)` would overload a structural trait with a UI concern and break the hypothetical case of a text-bearing editor that wants to hide the language picker. Rejected (b) derive from trait presence (couples UI to structure) and (c) move to registry descriptor (registry lookup per render for two fields EditorModel already exposes). `noLanguage` default stays `false` (text-bearing default); non-text editors continue setting it on the subclass
- [x] T5 — Audio fields duck-typing — **(a)** keep `_anyTabAudible`, `pageMuted`, `toggleMuteAll` duck-typed via `(editor as any)?.toggleMuteAll` and selector defaults (`s._anyTabAudible ?? false`). BrowserEditor is the sole consumer; YAGNI on a formal `editor.audio?: AudioCapability` interface or `AUDIO_TRAIT`. The duck-typed read is ugly but isolated to one component (`PageTab`) reading three fields from one editor type. BrowserEditor's state shape declares these fields on its subclass-defined state interface — tab's selector with defaults reads them safely. Revisit with (b) typed interface or (c) trait registration if a second audio source ever lands (video editor — walkthrough 30 — currently uses a separate playback model and doesn't tie into the tab's mute indicator)
- [x] T6 — Pinned-tab encryption-width branch — **(a-helper)** inline the GK2 helper from T2: `const host = pagesModel.query.getTextFileHost(p.id); const isEnc = host && (host.encrypted || host.decrypted);` Same idiom as PageTab, single typed lookup per pinned predecessor, truthy check + field access in one branch. Does NOT extract a separate `pinnedWidth(page)` helper — premature factoring for one callsite; widths and `+2` column gap stay inline in `PageTabs.tsx`. Rejected (b) extract a `pinnedWidth(page: PageModel): number` helper (one callsite, no shape change benefit)
- [x] T7 — `closeClick` redundant `fixCompareMode()` call — **(a)** drop the call. Confirmation; resolved by walkthrough 06 / CK7 (folded compare cleanup into `ungroup`) + walkthrough 07 / GK4 (drop the explicit `fixCompareMode()` call from `PageTab.closeClick`'s grouped branch). Resulting flow: `ungroup → showPage`. No new decision in T7; listed so the implementation-time checklist for `PageTab.tsx` doesn't miss the line
- [x] T8 — `handleClick` Ctrl+group invariants under unified `editors[]` — **(a)** no change. Confirmation; `pagesModel.groupTabs(activeId, pageId, true)` resolves correctly because walkthrough 01 / A8 + walkthrough 03 already migrated `findPage` to handle unified `editors[]` (walkthrough 07 / GK10 confirms). Both inputs are page ids; resolution is a direct page-id match. No code change in `PageTab.handleClick`; listed so the implementer doesn't waste time wondering
- [x] T9 — `handleDragEnd` interaction with `movePageOut`'s `saveState` — **(a)** no change in the tab. Confirmation; walkthrough 05 / M3 explicitly puts `await page.saveState()` inside `PagesLifecycleModel.movePageOut` — the source-side flush runs when the IPC event triggers `movePageOut`, not at the tab level. `PageTab.handleDragEnd` fires `api.addDragEvent(getDragData())` and forgets; the saveState invariant from M3 holds via the lifecycle layer. Rejected (b) await `page.saveState()` inside the tab (duplicates M3's responsibility, splits the invariant across two layers)
- [x] T10 — Same-window reorder trait payload — **(a)** no change. Confirmation. `setTraitDragData(TraitTypeId.PageTab, { key: page.id })` + `getTraitDragData(e.dataTransfer)` + `pagesModel.moveTab(data.key, id)` is page-id-keyed and trait-system-in-process. `pagesModel.moveTab` resolves via `findPage` (already migrated to unified `editors[]` by walkthroughs 01 + 03; confirmed by 07 / GK10). Trait system primitives in `/src/renderer/core/traits/dnd.ts` are unchanged by the editor refactor. Rejected (b) page-id-or-editor-id payload (no current consumer, flexibility for no gain). No mockup change required

Mockup adjustments:
- [x] B1 — `PageModel.getDescriptor(): PageDescriptor` — added to `mockups/PageModel.ts` 2026-05-20. Builds the page's serialized descriptor by composing per-editor `getRestoreData()` calls plus optional sidebar metadata; consumed by `PagesPersistenceModel.saveState`, `PageTab.getDragData`, and `PagesLifecycleModel.duplicatePage` (with fresh ids).
- [x] B2 — `EditorModel.contentHost: IContentHost | null` accessor — added to `mockups/EditorModel.ts` 2026-05-20. Base returns null; text-bearing subclasses override to return their `_host` field. Consumed internally by `PagesQueryModel.getTextFileHost` (the T2 helper), the switch widget rendering check (walkthrough 09), and TextChrome host-instanceof branching (walkthrough 10 / C1). PageTab itself routes through the GK2 helper rather than calling this accessor directly — keeps the host-type check centralized.
