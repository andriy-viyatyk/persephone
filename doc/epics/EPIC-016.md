# EPIC-016: Secondary Editors — Sidebar Extension System

**Status:** Completed
**Priority:** Medium
**Created:** 2026-03-30
**Completed:** 2026-04-02
**Depends on:** EPIC-015 (ITreeProvider infrastructure)

## Goal

Introduce a "secondary editor" architecture where page models can register sidebar panels that render alongside the primary content area. Secondary editors survive page navigation — they stay alive as headless models while the content area shows different pages. This enables Link editor replacement, archive browsing, Browser bookmarks integration, DOM resource browsing, and general-purpose sidebar tools.

## Motivation

EPIC-015 established `ITreeProvider` and the secondary panel in PageNavigator. The current design uses standalone `ZipTreeProvider` instances created separately from page models. This works for archives but doesn't scale well:

- **Link editor** needs encryption support — the page model already handles decrypt via its pipe
- **Lifecycle** is split — page model and tree provider have separate dispose/restore flows
- **Restore** requires recreating providers separately from page restore
- **Browser** needs DOMTreeProvider that's just a TextPageModel with HTML content
- **Future tools** (regex matcher, outline view, etc.) need a sidebar extension point

A general-purpose "secondary editor" system solves all of these.

## High-Level Design

### Secondary Editor Concept

A secondary editor is a sidebar panel associated with a page model. It renders its own UI in a collapsible panel within PageNavigator, alongside the Explorer panel. The secondary editor is **not a separate model** — it's a React component that receives the current PageModel via props.

```typescript
// PageModel gets a secondaryEditor field (similar to editor)
interface PageModel {
    /** Active secondary editor panel ID. Manages secondaryModels[] membership. */
    secondaryEditor: string | undefined;
}
```

The active editor on a page decides when to set/clear `secondaryEditor`:
- ZipPageModel sets `secondaryEditor = "zip-tree"` on creation
- LinksPageModel in link-view mode sets `secondaryEditor = "link-category"`; switching to monaco clears it
- TextPageModel with regex tool sets `secondaryEditor = "regex-tool"`; switching to grid-view clears it

The getter/setter manages `NavigationData.secondaryModels[]` membership automatically:
- **Set:** adds the model to `secondaryModels[]`
- **Clear:** removes the model from `secondaryModels[]`

Secondary editors are registered in a **secondary-editor-registry** that maps `secondaryEditor` string values to sidebar React components via dynamic imports.

### Multiple Secondary Panels

NavigationData holds an **array** of page models that have `secondaryEditor` set:

```
NavigationData
  ├── treeProvider              // FileTreeProvider (Explorer panel)
  ├── secondaryModels[]         // PageModel instances with secondaryEditor set
  └── activePanel               // "explorer" | "search" | secondary model id
```

PageNavigator renders each secondary model using the registry:
```
{secondaryModels.map(m => {
    const Component = resolveSecondaryEditor(m.secondaryEditor);
    return <Component model={m} />;
})}
```

### Page Lifecycle: `beforeNavigateAway(newModel)`

A lifecycle hook gives page models a chance to survive navigation. The new model is passed so the old model can inspect `newModel.sourceLink` (from US-312) to decide whether to stay:

```typescript
// In navigatePageTo (after newModel is created, before NavigationData transfer):
oldModel.beforeNavigateAway(newModel);

// Base PageModel: clears secondaryEditor → removed from secondaryModels[]
// ZipPageModel override: checks newModel.sourceLink.metadata.sourceId === this.id
//   → match (file opened from this archive): keeps secondaryEditor → stays
//   → no match (unrelated file): clears secondaryEditor → removed and disposed
```

The model survives in `secondaryModels[]` because NavigationData is transferred (not recreated) during navigation. Disposed when the user closes the secondary panel or when the tab closes.

### Secondary Editor Registry

```typescript
// Maps secondaryEditor string values to sidebar React components
secondaryEditorRegistry.register({
    id: "zip-tree",
    label: "Archive",
    loadComponent: () => import("./archive/ZipSecondaryEditor"),
});
secondaryEditorRegistry.register({
    id: "link-category",
    label: "Links",
    loadComponent: () => import("./link-editor/LinksCategoryEditor"),
});
```

Each secondary editor component receives the PageModel and renders its sidebar content:
- **ZipSecondaryEditor** — receives ZipPageModel, renders TreeProviderView (archive tree)
- **LinksCategoryEditor** — receives TextPageModel (link-view), renders Categories/Tags/Hostnames
- **DomSecondaryEditor** — receives TextPageModel (HTML), renders DOM resource tree
- **Future: RegexSecondaryEditor** — receives TextPageModel (monaco), renders regex tool

### Panel Header as Page Tab

Secondary panel headers function like page tabs:
- Title from the registry `label` or the page model title
- Close button — **only shown for models that are NOT the active page** (survived navigation). Clicking disposes the model. The active page's own secondary panel has no close button — it's controlled by the `secondaryEditor` field.
- Modified indicator (for link collections with unsaved changes)
- Encrypt/decrypt icon (for encrypted `.link.json`)

### Navigation Identity

Pages carry `sourceLink` (US-312) with the original URL and metadata that opened them. Secondary editors can use `sourceLink.metadata` to identify pages opened from their context (e.g., a file opened from the zip tree carries the archive path in its sourceLink metadata).

During navigation (`navigatePageTo`):
1. New model is created from the target file
2. `oldModel.beforeNavigateAway(newModel)` — model inspects `newModel.sourceLink` to decide whether to keep or clear its `secondaryEditor`
3. If old model kept `secondaryEditor`, it is NOT disposed (only detached from page collection)
4. NavigationData transfers to the new page — surviving secondary models in `secondaryModels[]` carry over
5. New page sets its own `secondaryEditor` (if any) — added to `secondaryModels[]`

## Phased Implementation Plan

### Phase 0: Navigation Identity

| # | Task | Description | Depends on | Status |
|---|---|---|---|---|
| 0.1 | [Source link persistence in IPageState](../tasks/US-312-source-link-persistence/README.md) (US-312) | Add `ISourceLink` to `IPageState` storing resolved URL + accumulated metadata. Open handler builds sourceLink and passes to openFile/navigatePageTo. Persisted across restarts. Foundation for `beforeNavigateAway(newModel)` identity checks. | — | Done |

### Phase 1: Architecture Foundation

| # | Task | Description | Depends on | Status |
|---|---|---|---|---|
| 1.1 | [Design secondary editor lifecycle](../tasks/US-313-secondary-editor-lifecycle/README.md) (US-313) | `secondaryModels[]` array in NavigationData. Management methods (add/remove/find). Dispose integration. Tab close save prompts via `confirmSecondaryRelease()`. Persistence of model descriptors. | 0.1 | Done |
| 1.2 | [Secondary editor registry + PageModel integration](../tasks/US-314-secondary-editor-registry/README.md) (US-314) | SecondaryEditorRegistry mapping `secondaryEditor` strings to sidebar components. `secondaryEditor` getter/setter on PageModel (manages secondaryModels[] membership). `beforeNavigateAway()` lifecycle hook. `restoreSecondaryModels()` on NavigationData. Public `newPageModelFromState`. Absorbs original task 1.3. | 1.1 | Done |
| ~~1.3~~ | ~~Add `isSecondaryEditor` to PageModel~~ | Absorbed into 1.2 — replaced by `secondaryEditor` getter/setter and `beforeNavigateAway()` on PageModel. | — | — |
| 1.4 | [Refactor PageNavigator for secondary editor models](../tasks/US-316-pagenavigator-secondary-editors/README.md) (US-316) | Render secondary panels from `NavigationData.secondaryModels[]` via secondary editor registry. Reactive version counter for `secondaryModels`. `LazySecondaryEditor` async loader. Panel headers with registry label + close button (non-active models only). Keep old secondaryProvider system until 1.5 replaces it. | 1.2 | Done |
| 1.5 | [ZipPageModel + ZipSecondaryEditor](../tasks/US-315-zip-page-model/README.md) (US-315) | Dedicated `zip-view` page-editor. ZipPageModel owns ZipTreeProvider, renders TreeProviderView as main content. ZipSecondaryEditor sidebar component registered as "zip-tree". `beforeNavigateAway()` + `setOwnerPage()` for navigation survival. `NavigationData.ownerModel` + `PageModel.ownerPage`. `expandSecondaryPanel` event. Explorer `sourceId` metadata. Removed old secondaryProvider system. Simplified CategoryEditor. | 1.4 | Done |

### Phase 2: Link Editor Replacement

| # | Task | Description | Depends on | Status |
|---|---|---|---|---|
| 2.1 | LinksPageModel + LinksSecondaryEditor | LinksPageModel (link-view editor) sets `secondaryEditor = "link-category"`. Secondary component renders decrypt button (if encrypted) + collapsible Categories/Tags/Hostnames panels. Implements ITreeProvider for category browsing. Uses existing pipe for encrypted files. Overrides `beforeNavigateAway()` to survive when navigated page was opened from this collection. | 1.5 | Planned |
| 2.2 | Tags/Hostnames sub-panels in LinksSecondaryEditor | Inner panels: Tags panel (`provider.hasTags`), Hostnames panel (`provider.hasHostnames`). Uses `CollapsiblePanelStack`. | 2.1 | Planned |
| 2.3 | Pinned items panel in CategoryView | Shown when `provider.pinnable`. Calls `getPinnedItems()`, `pin()`, `unpin()`. | 2.1 | Planned |
| 2.4 | TreeProviderItemTile component | Tile renderer for CategoryView. Shows `imgSrc` for links, image preview for images. | — | Planned |
| 2.5 | `.link.json` browsing via secondary editor | User opens `.link.json` → link-view editor sets `secondaryEditor = "link-category"`. CategoryView shows link items. Encrypted files handled by existing decrypt flow. Switching to monaco clears `secondaryEditor`. | 2.1, 2.2, 2.3, 2.4 | Planned |
| 2.6 | Non-HTTP links in link collections | Local file paths and cURL commands as link items. Type-based icons. | 2.5 | Planned |
| 2.7 | Verify Link editor feature parity | Test: pinned links, view modes, drag-drop, edit/delete, context menus. | 2.5 | Planned |
| 2.8 | Decommission standalone Link editor | Remove registration, delete old components. | 2.7 | Planned |

### Phase 3: Browser & Advanced Features

| # | Task | Description | Depends on | Status |
|---|---|---|---|---|
| 3.1 | Browser editor integration | Replace embedded LinkEditor with secondary editor panels. Event channel pattern for link opening. | 2.1 | Planned |
| 3.2 | Multi-file drop → .link.json | Create temp `.link.json` in cache, open as page with LinksPageModel. | 2.5 | Planned |
| 3.3 | DOMSecondaryEditor (TextPageModel + HTML) | Secondary editor for HTML content. Scrapes DOM resources. Categories: images, scripts, styles, media. | 1.5 | Planned |
| 3.4 | Content search for LinksPageModel | Instant in-memory search by title/href/tags. | EPIC-015 4.1, 2.1 | Planned |
| 3.5 | Expose LinkTreeProvider in script `io` namespace | `io.LinkTreeProvider`. Script type definitions. | 2.1 | Planned |
| 3.6 | RegexSecondaryEditor (prototype) | Secondary editor for TextPageModel. Regex input + match highlighting in monaco. Example of non-tree secondary editor. | 1.5 | Planned |

### Phase 4: Archive Expansion

| # | Task | Description | Depends on | Status |
|---|---|---|---|---|
| 4.1 | Adopt libarchive-wasm for multi-format archive support | Replace `jszip` with `libarchive-wasm` (WASM-based, MIT) in archive-service. Supports RAR v4/v5, 7z, TAR, gzip, bzip2, lzma/xz, cab, ISO — all via one pure-WASM dependency (no native binaries). Generalize `ZipTreeProvider` → `ArchiveTreeProvider`. Update `ARCHIVE_EXTENSIONS` and `isArchiveFile()` to include `.rar`, `.7z`, `.tar.gz`, `.tar.bz2`, `.cab`, `.iso`. Archive icon for all formats. | 1.4 | Planned |

## Key Design Decisions

1. **How does a page model survive navigation?** — **Resolved.** `navigatePageTo` calls `oldModel.beforeNavigateAway(newModel)`. The old model decides to keep or clear its `secondaryEditor`. If kept, the model stays in `NavigationData.secondaryModels[]` and is NOT disposed (only detached from the page collection). NavigationData transfers to the new page, carrying the surviving model. Disposed when user closes the secondary panel or when the tab closes.

2. **Tab title/icon** — **Resolved.** Tab title and icon always come from the **primary (center area) page model**. Secondary editors live in the sidebar only and do not affect the tab. `PageTab` renders `model.state.use().title` which is the current center-area page — this already works correctly and requires no changes.

3. **Dispose ownership** — **Resolved.** NavigationData's lifetime equals the tab lifetime. It is created when a page first opens, copied to each navigated page via `navigatePageTo`, and disposed when the user closes the tab (click "X" or "Close other tabs"). On dispose, NavigationData iterates and disposes all secondary models in `secondaryModels[]`. Individual secondary models can also be disposed when the user closes their sidebar panel.

4. **Navigation identity** — **Resolved.** Implemented as Phase 0 (US-312). `IPageState.sourceLink` stores the resolved URL + accumulated metadata. Secondary editors use `sourceLink.metadata` in `beforeNavigateAway(newModel)` to decide whether the new page was opened from their context. For example, ZipPageModel checks `newModel.sourceLink?.metadata?.sourceId === this.id` — if the file was opened from this archive's tree, the zip panel stays; otherwise it's removed.

### Tab close with secondary editors

When a page tab is closing and has secondary editor models, iterate through each model that has unsaved changes and show a save dialog — same pattern as "Close other tabs":

1. Iterate through secondary models with `modified` state
2. For each modified secondary: expand and highlight its panel (so user sees which model is being asked about)
3. Show save dialog: "Save changes to [model title]?" — Save / Don't Save / Cancel
4. **Save** → save the model, continue iteration
5. **Don't Save** → dispose without saving, continue iteration
6. **Cancel** → stop iteration, cancel tab close, keep panel expanded on the model that was cancelled

This reuses the existing `confirmRelease()` pattern on PageModel. No new dialog infrastructure needed. The panel expand + highlight gives visual context so the user knows which secondary editor has unsaved changes.

## Open Concerns

### A. Close button on secondary panels — Resolved

The active page's own secondary panel does **not** render a close button — the panel is controlled by the `secondaryEditor` field, which is set/cleared by the editor. Showing a close button would create inconsistency (panel closed but `secondaryEditor` still set on the active model).

Only secondary panels belonging to **other** models (ones that survived navigation via `beforeNavigateAway`) render a close button. Clicking it calls `removeSecondaryModel(model)` which disposes the model (it has no other references — it's not the active page).

### B. Multiple secondary editors from different models

Multiple secondary models from different sources (e.g., `.link.json` inside `.zip` — both zip-tree and link-category panels) should work naturally with the array-based design. Each model has its own pipe (LinksPageModel would have `FileProvider → ZipTransformer`), so closing the zip panel doesn't break the links model.

Dependent secondary models (where one model relies on another's state) are not currently planned. If such a scenario arises, it will be addressed at that time.

## Completion Notes

Phase 0 (Navigation Identity) and Phase 1 (Architecture Foundation) are complete. The secondary editor infrastructure — registry, lifecycle, PageNavigator rendering, and the first concrete implementation (ZipPageModel) — is fully functional.

Phases 2 (Link Editor Replacement), 3 (Browser & Advanced Features), and 4 (Archive Expansion) have been moved to **[EPIC-018](EPIC-018.md)** — Secondary Editors: Content Applications. These will be implemented after EPIC-017 (PageContainer Architecture), which may simplify some of the remaining work.

## References

- **EPIC-015:** ITreeProvider infrastructure, TreeProviderView, CategoryView, PageNavigator
- **EPIC-018:** Continuation — Link Editor, Browser integration, archive expansion
- **EPIC-017:** PageContainer Architecture — refactors the page/navigation ownership model
- **Current Link editor:** `src/renderer/editors/link-editor/` — feature reference for parity
- **Archive service:** `src/renderer/api/archive-service.ts` — used by ZipPageModel
- **Editor registry:** `src/renderer/editors/registry.ts` — pattern for secondary-editor-registry
