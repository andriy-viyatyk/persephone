# US-050: Phase 4b — Pages API (`app.pages` + `IPage`)

## Status

📋 **Design Complete, Awaiting US-049**
- Complete Pages API architecture designed
- Submodel pattern (AVGridModel) finalized
- Interface specifications ready
- Depends on US-049 (Event Services) being complete first

See: `/doc/future-architecture/8.app-pages.md` (Sections 1-2, 6-8, 14)

## Overview

Refactor pages system into the App Object Model. Implement `IPageCollection` and `IPage` public interfaces, organize internal logic into 5 submodels using AVGridModel pattern, and establish clear page lifecycle with explicit bootstrap.

**Prerequisite:** US-049 (Event Services Extraction) must be complete

**Outcome:** Clean `app.pages` API, pages-store simplified, submodel architecture, ready for scripting/AI integration

---

## Problem Being Solved

Current issues:
1. Pages accessed via `pagesModel` singleton (no app.pages API)
2. 40+ page operations scattered, no clear organization
3. No formal page lifecycle (created → initialized → active → disposed)
4. Complex state management (grouping, pinning, navigation mixed)
5. No public interface definition for scripts
6. Hard to test (tightly coupled to React, IPC)

---

## What This Task Does

✅ Create 5 submodels organized by concern:
  - `PagesLifecycleModel` - create, open, close, navigate
  - `PagesNavigationModel` - show, showNext, showPrev
  - `PagesLayoutModel` - move, pin, group
  - `PagesPersistenceModel` - save, restore
  - `PagesQueryModel` - find, queries

✅ Create `PagesCollectionFacade`:
  - Thin wrapper that delegates to submodels
  - Implements `IPageCollection` interface
  - Clean public API (15 methods, not 40+)

✅ Define public interfaces:
  - `IPageCollection` - what scripts can do with pages
  - `IPage` - per-page interface for scripts

✅ Wire into `app.pages`:
  - Update `app.ts`: expose `pages` property
  - Replace `pagesModel` singleton
  - Guard prevents re-initialization

✅ Migrate all consumers:
  - Tab components use `app.pages`
  - Navigation features use `app.pages`
  - Delete old `pages-store.ts`, `page-factory.ts`, `page-actions.ts`

---

## Architecture: Submodel Pattern (AVGridModel)

```
PagesModel (base state + core)
  ├─ OpenFilesState (pages[], ordered[], groupings)
  └─ Core subscriptions + lifecycle hooks

Five Category Submodels (each handles one concern):
  ├─ PagesLifecycleModel(base)   → create, open, close, navigate
  ├─ PagesNavigationModel(base)  → show, showNext, showPrev
  ├─ PagesLayoutModel(base)      → move, pin, group
  ├─ PagesPersistenceModel(base) → save, restore
  └─ PagesQueryModel(base)       → find, queries

PagesCollectionFacade (composition)
  ├─ References all 5 submodels
  ├─ Delegates to appropriate submodel
  └─ Implements IPageCollection interface

IPageCollection (public interface)
  └─ What scripts can call
```

---

## Implementation Checklist

### Phase 1: Create Interfaces & Base Model
- [ ] Create `/src/renderer/api/types/pages.d.ts`:
  - `IPageCollection` interface (15 public methods)
  - `IPage` interface (page state + conditional type casts)
- [ ] Create `/src/renderer/api/pages/PagesModel.ts`:
  - `OpenFilesState` type definition
  - Constructor (no init side effects)
  - Shared state + lifecycle hooks

### Phase 2: Create 5 Submodels
- [ ] `PagesLifecycleModel.ts`:
  - `create(type): IPage`
  - `async open(filePath): Promise<IPage>`
  - `async close(pageId): Promise<boolean>`
  - `async navigate(pageId, newFilePath): Promise<boolean>`
  - Private: `createPageFromFile()`, `attachPage()`, `detachPage()`, `removePage()`

- [ ] `PagesNavigationModel.ts`:
  - `show(pageId): void`
  - `showNext(): void`
  - `showPrev(): void`
  - Private: `onPageShowRequested()`

- [ ] `PagesLayoutModel.ts`:
  - `move(pageId, toIndex): void`
  - `pin(pageId): void`
  - `unpin(pageId): void`
  - `group(leftId, rightId): void`
  - `ungroup(pageId): void`
  - Private: `fixGrouping()`, `fixCompareMode()`

- [ ] `PagesPersistenceModel.ts`:
  - `async restore(): Promise<void>`
  - `async save(): Promise<void>`
  - Private: `restoreState()`, `saveState()`, `saveStateDebounced()`, `restoreModel()`

- [ ] `PagesQueryModel.ts`:
  - `find(pageId): PageModel | undefined`
  - `get pages(): PageModel[]`
  - `get active(): PageModel | undefined`
  - `getGrouped(pageId): PageModel | undefined`
  - `isLastPage(pageId): boolean`

### Phase 3: Create Facade & Wrappers
- [ ] `PagesCollectionFacade.ts`:
  - Constructor: takes PagesModel, creates all 5 submodels
  - Delegates: routes calls to appropriate submodel
  - Implements: `IPageCollection` interface

- [ ] `page.ts`:
  - Thin wrapper over PageModel
  - Implements `IPage` interface
  - Conditional type casts (asText, asBrowser, etc.)

### Phase 4: Wire Into App
- [ ] Update `/src/renderer/api/app.ts`:
  - Add `_pages?: IPageCollection` property
  - Update `initPages()` method:
    - Create PagesCollectionFacade
    - Assign to `this._pages`
    - Call `restore()` with error handling
    - Call `handleArgs()` internal method
  - Update `initEvents()`:
    - RendererEventsService delegates to `app.pages`
  - Do NOT expose in `.d.ts` (internal only, use via `app` interface)

- [ ] Create `/src/renderer/api/pages.ts`:
  - Export singleton: `export const pages = app.pages`
  - For backward compatibility during migration

### Phase 5: Migrate Consumers
- [ ] Tab components:
  - Replace `pagesModel` imports with `app.pages`
  - Update method calls (pagesModel.open → app.pages.open)
  - ~8 files affected

- [ ] Navigation features:
  - Replace `pagesModel` imports with `app.pages`
  - ~5 files affected

- [ ] Editor components:
  - Replace `pagesModel` imports with `app.pages`
  - ~3 files affected

- [ ] IPC event handlers:
  - Already delegated via RendererEventsService (from US-049)
  - Verify no direct pagesModel calls remain

### Phase 6: Delete Old Code
- [ ] Delete `/src/renderer/store/pages-store.ts`
- [ ] Delete `/src/renderer/store/page-factory.ts`
- [ ] Delete `/src/renderer/store/page-actions.ts`
- [ ] Remove imports from all affected files
- [ ] Verify no circular dependencies introduced

### Phase 7: Testing & Verification
- [ ] Unit tests for each submodel:
  - Lifecycle: create, open, close, navigate
  - Navigation: show, showNext, showPrev
  - Layout: move, pin, group operations
  - Persistence: save, restore operations
  - Queries: find, active, grouped

- [ ] Integration tests:
  - Bootstrap sequence: restore → handleArgs → initEvents
  - File opening with --file CLI arg
  - Diff opening with --diff CLI arg
  - Error handling during restore
  - Error handling during user actions

- [ ] Manual testing:
  - Create/close pages
  - Open files
  - Move tabs
  - Pin/unpin tabs
  - Group pages
  - Keyboard shortcuts
  - Drag-drop operations

- [ ] Build verification:
  - TypeScript compile: no errors
  - ESLint: no violations
  - Bundling: successful
  - Dev start: no console errors

### Phase 8: Documentation
- [ ] Update `/CLAUDE.md`:
  - Key files: add pages API paths
  - Quick start documentation
- [ ] Update `/doc/architecture/` references:
  - Link to new architecture
  - Update pages-store docs
- [ ] Document `IPageCollection` interface:
  - Method signatures
  - Error conditions
  - Usage examples
- [ ] Document page lifecycle:
  - State transitions
  - When page is "ready"
  - Restoration semantics

---

## Public API Surface: `IPageCollection`

```typescript
interface IPageCollection {
  // Queries (read-only)
  readonly pages: IPage[];
  readonly active: IPage | null;
  find(pageId: string): IPage | null;
  getGrouped(pageId: string): IPage | null;

  // Lifecycle
  create(type: string): IPage;
  async open(filePath: string): Promise<IPage>;
  async close(pageId: string): Promise<boolean>;
  async navigate(pageId: string, newFilePath: string): Promise<boolean>;

  // Navigation
  show(pageId: string): void;
  showNext(): void;
  showPrev(): void;

  // Layout
  move(pageId: string, toIndex: number): void;
  pin(pageId: string): void;
  unpin(pageId: string): void;
  group(leftId: string, rightId: string): void;
  ungroup(pageId: string): void;

  // Persistence
  async restore(): Promise<void>;
  async save(): Promise<void>;

  // Internal (in .d.ts but not recommended for scripts)
  readonly onShow: Subscription<IPage>;
  readonly onFocus: Subscription<IPage>;
}
```

---

## Files to Create (9)

```
/src/renderer/api/
├── pages.ts                        (singleton re-export)
├── pages/
│   ├── types.d.ts                 (IPageCollection, IPage interfaces)
│   ├── PagesModel.ts               (base state)
│   ├── PagesLifecycleModel.ts
│   ├── PagesNavigationModel.ts
│   ├── PagesLayoutModel.ts
│   ├── PagesPersistenceModel.ts
│   ├── PagesQueryModel.ts
│   └── PagesCollectionFacade.ts
└── page.ts                         (IPage wrapper)
```

---

## Files to Delete (3)

```
DELETE:
├── /src/renderer/store/pages-store.ts
├── /src/renderer/store/page-factory.ts
└── /src/renderer/store/page-actions.ts
```

---

## Files to Modify (12)

```
MODIFY:
├── /src/renderer/api/app.ts                  (add pages property, wire initPages)
├── /src/renderer/app/MainPage.tsx            (replace pagesModel with app.pages)
├── /src/renderer/features/tabs/            (all tab components, ~8 files)
├── /src/renderer/features/navigation/      (~3 files)
├── /src/renderer/editors/browser/          (~2 files)
├── /src/ipc/renderer/renderer-events.ts    (verify RendererEventsService delegates)
└── (other files importing pagesModel)
```

---

## Acceptance Criteria

✅ All pages operations accessible via `app.pages`
✅ 5 submodels properly organized
✅ `IPageCollection` interface clearly defined
✅ File operations and tests passing
✅ Bootstrap sequence works
✅ All keyboard shortcuts work
✅ All IPC events work
✅ State persistence works (restore on start)
✅ No direct pagesModel calls remain
✅ No console errors/warnings
✅ Build passes, TypeScript clean
✅ Ready for scripting/AI integration

---

## Risk Assessment

**Risk Level:** 🟡 **MEDIUM**

**Why:**
- Significant refactoring of core page management
- Affects multiple consumer files
- Pages are central to app functionality
- Mistakes could affect page state persistence

**Mitigation:**
- Submodels tested independently
- Backward-compatible API during migration
- Comprehensive integration tests
- Gradual consumer migration (can stop and verify at each step)

**Testing Strategy:**
1. Unit test each submodel
2. Integration test bootstrap + pages setup
3. Integration test page operations
4. Manual regression testing
5. Full E2E testing

---

## Dependencies

**Depends On:** US-049 (Event Services Extraction) - MUST be complete first

**Blocks:** None (independent functionality)

**Enables:**
- Scripting system (scripts call `app.pages`)
- AI agent integration (external code uses `app.pages` API)
- Future: pages sync between windows, collaborative editing

---

## Timeline Estimate

- Phase 1 (interfaces): ~2 hours
- Phase 2 (submodels): ~4 hours
- Phase 3 (facade): ~1 hour
- Phase 4 (wiring): ~1 hour
- Phase 5 (migration): ~3 hours
- Phase 6-8 (testing + docs): ~4 hours
- **Total: ~15 hours** (spread across multiple sessions)

---

## Related Documentation

- Architecture Design: `/doc/future-architecture/8.app-pages.md` (Sections 1-2, 6-8, 14)
- Window Bootstrap: Section 1 (Window Bootstrap Lifecycle)
- Page Lifecycle: Section 2 (Page Lifecycle State Machine)
- Public API: Section 6 (Public Interface Definitions)
- Submodels: Section 4-5 (Service Details, Action Categorization)
- Architecture Diagram: Section 13 (Final Architecture Diagram)

---

## Notes

- This is the **main Pages API refactoring** (US-050)
- Complements US-049 (Event Services)
- After both tasks: app bootstrap is clean, pages API is testable
- Pages are ready for external consumers (scripts, AI agents)
- Can be extended with additional page types/operations without breaking API
