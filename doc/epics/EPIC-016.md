# EPIC-016: Secondary Editors — Sidebar Extension System

**Status:** In Progress
**Priority:** Medium
**Created:** 2026-03-30
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

A secondary editor is a sidebar panel associated with a page model. It renders its own UI in a collapsible panel within PageNavigator, alongside the Explorer panel.

```typescript
// Base PageModel gets secondary editor support
interface PageModel {
    /** Whether this page can provide a secondary editor panel. */
    readonly isSecondaryEditor: boolean;
}
```

Secondary editors are registered in a **secondary-editor-registry** (similar to the existing editor registry but simplified). Each registration maps a model type to a secondary editor component.

### Multiple Secondary Panels

NavigationData holds an **array** of secondary editor models (not just one):

```
NavigationData
  ├── treeProvider              // FileTreeProvider (Explorer panel)
  ├── secondaryModels[]         // Array of secondary editor page models
  └── activePanel               // "explorer" | secondary model id
```

Each secondary model gets its own collapsible panel in PageNavigator. The Explorer panel is always first. Secondary panels appear below.

### Page Lifecycle: "Page Removing" Stage

A new lifecycle stage — **"page removing"** — gives page models a chance to survive navigation:

```typescript
// In navigatePageTo:
const shouldDispose = await oldModel.onRemoving();
// ZipPageModel: return false (keep alive as secondary editor)
// LinksPageModel: return false (keep alive)
// Regular TextPageModel: return true (dispose normally)
```

If the page decides to keep itself alive, it stays in `navigationData.secondaryModels[]`. NavigationData owns its lifecycle from that point — disposing it when the user closes the secondary panel.

### Secondary Editor Registry

```typescript
// Simplified registry — maps model types to secondary editor components
registerSecondaryEditor("zip-page", ZipSecondaryEditor);
registerSecondaryEditor("links-page", LinksSecondaryEditor);
registerSecondaryEditor("text-html", DomSecondaryEditor);
```

Each secondary editor component receives the page model and renders its sidebar content:
- **ZipSecondaryEditor** — renders TreeProviderView (archive tree)
- **LinksSecondaryEditor** — renders decrypt button (if encrypted) + CollapsiblePanelStack with Categories/Tags/Hostnames
- **DomSecondaryEditor** — renders DOM resource tree
- **Future: RegexSecondaryEditor** — renders regex tool with match highlighting

### Panel Header as Page Tab

Secondary panel headers function like page tabs:
- Title from the page model (archive name, link collection name)
- Close button disposes the secondary editor model
- Modified indicator (for link collections with unsaved changes)
- Encrypt/decrypt icon (for encrypted `.link.json`)

### Navigation Identity

Pages opened from a secondary editor carry a `secondaryEditorId` in their openRawLink metadata. When a new page is navigated to:
1. Check if the new page `isSecondaryEditor` → add to `secondaryModels[]`
2. Check if the page was opened from an existing secondary editor (via metadata) → keep that editor alive
3. If unrelated to any secondary editor → dispose editors that don't have the page belonging to them

## Phased Implementation Plan

### Phase 0: Navigation Identity

| # | Task | Description | Depends on | Status |
|---|---|---|---|---|
| 0.1 | [Source link persistence in IPageState](../tasks/US-312-source-link-persistence/README.md) (US-312) | Add `ISourceLink` to `IPageState` storing resolved URL + accumulated metadata. Open handler builds sourceLink and passes to openFile/navigatePageTo. Persisted across restarts. Foundation for `secondaryEditorId`. | — | Done |

### Phase 1: Architecture Foundation

| # | Task | Description | Depends on | Status |
|---|---|---|---|---|
| 1.1 | Design secondary editor lifecycle | "Page removing" lifecycle stage. Page decides to survive or dispose. `secondaryModels[]` array in NavigationData. Ownership and dispose rules. | 0.1 | Planned |
| 1.2 | Secondary editor registry | Simplified registry mapping model types to secondary editor components. Registration API. | 1.1 | Planned |
| 1.3 | Add `isSecondaryEditor` to PageModel | Base infrastructure. Specific models override. | 1.1 | Planned |
| 1.4 | ZipPageModel + ZipSecondaryEditor | New editor: shows archive info/metadata instead of raw binary. Secondary editor renders TreeProviderView (archive tree). Implements ITreeProvider. Replaces standalone ZipTreeProvider. | 1.2, 1.3 | Planned |
| 1.5 | Refactor PageNavigator for secondary editor models | Render secondary panels from `secondaryModels[]` via registry. Replace current standalone ZipTreeProvider approach. Panel headers from page model metadata. | 1.4 | Planned |

### Phase 2: Link Editor Replacement

| # | Task | Description | Depends on | Status |
|---|---|---|---|---|
| 2.1 | LinksPageModel + LinksSecondaryEditor | Refactor LinksPageModel to implement ITreeProvider. Secondary editor renders decrypt button (if encrypted) + collapsible Categories/Tags/Hostnames panels. Uses existing pipe for encrypted files. | 1.3 | Planned |
| 2.2 | Tags/Hostnames sub-panels in LinksSecondaryEditor | Inner panels: Tags panel (`provider.hasTags`), Hostnames panel (`provider.hasHostnames`). Uses `CollapsiblePanelStack`. | 2.1 | Planned |
| 2.3 | Pinned items panel in CategoryView | Shown when `provider.pinnable`. Calls `getPinnedItems()`, `pin()`, `unpin()`. | 2.1 | Planned |
| 2.4 | TreeProviderItemTile component | Tile renderer for CategoryView. Shows `imgSrc` for links, image preview for images. | — | Planned |
| 2.5 | `.link.json` browsing via secondary editor | User opens `.link.json` → LinksPageModel registers as secondary editor. CategoryView shows link items. Encrypted files handled by existing decrypt flow. | 2.1, 2.2, 2.3, 2.4 | Planned |
| 2.6 | Non-HTTP links in link collections | Local file paths and cURL commands as link items. Type-based icons. | 2.5 | Planned |
| 2.7 | Verify Link editor feature parity | Test: pinned links, view modes, drag-drop, edit/delete, context menus. | 2.5 | Planned |
| 2.8 | Decommission standalone Link editor | Remove registration, delete old components. | 2.7 | Planned |

### Phase 3: Browser & Advanced Features

| # | Task | Description | Depends on | Status |
|---|---|---|---|---|
| 3.1 | Browser editor integration | Replace embedded LinkEditor with secondary editor panels. Event channel pattern for link opening. | 2.1 | Planned |
| 3.2 | Multi-file drop → .link.json | Create temp `.link.json` in cache, open as page with LinksPageModel. | 2.5 | Planned |
| 3.3 | DOMSecondaryEditor (TextPageModel + HTML) | Secondary editor for HTML content. Scrapes DOM resources. Categories: images, scripts, styles, media. | 1.2, 1.3 | Planned |
| 3.4 | Content search for LinksPageModel | Instant in-memory search by title/href/tags. | EPIC-015 4.1, 2.1 | Planned |
| 3.5 | Expose LinkTreeProvider in script `io` namespace | `io.LinkTreeProvider`. Script type definitions. | 2.1 | Planned |
| 3.6 | RegexSecondaryEditor (prototype) | Secondary editor for TextPageModel. Regex input + match highlighting in monaco. Example of non-tree secondary editor. | 1.2, 1.3 | Planned |

## Key Design Decisions

1. **How does a "headless" page model survive navigation?** — **Resolved.** `navigatePageTo` already transfers NavigationData from old to new page. Add a guard: if the old model is in `navigationData.secondaryModels[]`, skip dispose. The model stays alive because NavigationData holds a reference. Disposed when user closes the secondary panel.

2. **Tab title/icon** — **Resolved.** Tab title and icon always come from the **primary (center area) page model**. Secondary editors live in the sidebar only and do not affect the tab. `PageTab` renders `model.state.use().title` which is the current center-area page — this already works correctly and requires no changes.

3. **Dispose ownership** — **Resolved.** NavigationData's lifetime equals the tab lifetime. It is created when a page first opens, copied to each navigated page via `navigatePageTo`, and disposed when the user closes the tab (click "X" or "Close other tabs"). On dispose, NavigationData iterates and disposes all secondary models in `secondaryModels[]`. Individual secondary models can also be disposed when the user closes their sidebar panel.

4. **Navigation identity** — **Resolved.** Implemented as Phase 0 (prerequisite for secondary editors). The approach:
   - `ILinkMetadata` already supports custom fields via `[key: string]: unknown` — metadata like `secondaryEditorId` can be passed through `openRawLink`.
   - All metadata merges through the 3-layer pipeline (parsers → resolvers → open-handler) — already works.
   - **New:** `IPageState` gains a `sourceLink` field that stores the full link descriptor (raw string + resolved metadata). Persisted and restored across app restarts.
   - The source link serves as page identity — allows the system to know what a page is and how it was opened.
   - Secondary editors use `secondaryEditorId` in the source link metadata to associate navigated pages with their owning secondary editor.

### Tab close with secondary editors

When a page tab is closing and has secondary editor models, iterate through each model that has unsaved changes and show a save dialog — same pattern as "Close other tabs":

1. Iterate through secondary models with `modified` state
2. For each modified secondary: expand and highlight its panel (so user sees which model is being asked about)
3. Show save dialog: "Save changes to [model title]?" — Save / Don't Save / Cancel
4. **Save** → save the model, continue iteration
5. **Don't Save** → dispose without saving, continue iteration
6. **Cancel** → stop iteration, cancel tab close, keep panel expanded on the model that was cancelled

This reuses the existing `confirmRelease()` pattern on PageModel. No new dialog infrastructure needed. The panel expand + highlight gives visual context so the user knows which secondary editor has unsaved changes.

## References

- **EPIC-015:** ITreeProvider infrastructure, TreeProviderView, CategoryView, PageNavigator
- **Current Link editor:** `src/renderer/editors/link-editor/` — feature reference for parity
- **Archive service:** `src/renderer/api/archive-service.ts` — used by ZipPageModel
- **Editor registry:** `src/renderer/editors/registry.ts` — pattern for secondary-editor-registry
