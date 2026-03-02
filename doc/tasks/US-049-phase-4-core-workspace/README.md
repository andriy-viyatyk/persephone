# US-049: Phase 4a — Event Services Extraction

## Status

🔄 **Ready for Implementation**
- Event extraction architecture finalized
- 5 internal services designed
- Bootstrap sequence (3-layer) defined
- Low-risk refactoring of existing code

See: `/doc/future-architecture/8.app-pages.md` (Sections 3-5, 9-13)

## Overview

Extract event handling from React components (EventHandler, MainPage) into 5 internal service classes. Establish explicit 3-layer bootstrap sequence without React lifecycle dependencies. This is a **preparation task** for US-050 (Pages API).

**Outcome:** Cleaner bootstrap architecture, EventHandler eliminated, ready for Pages API implementation.

---

## Problem Being Solved

Current issues:
1. Event handling scattered across EventHandler, MainPage, pages-store
2. Bootstrap sequence implicit and mixed with React lifecycle
3. EventHandler component too complex (9 responsibilities)
4. MainPage mixed rendering with keyboard/drag logic
5. No clear initialization ordering (services → pages → events)

---

## What This Task Does (NOT)

❌ Does NOT create Pages API (`app.pages`)
❌ Does NOT refactor pagesModel to submodels
❌ Does NOT change page functionality
❌ Does NOT affect user experience

**This task ONLY:** Reorganizes event handling for cleaner architecture

---

## What This Task Does

✅ Extract 5 internal event services:
  - `GlobalEventService` - contextmenu, drag-drop, unhandled rejections
  - `KeyboardService` - global shortcuts (Ctrl+Tab, Ctrl+W, etc.)
  - `WindowStateService` - window maximize/zoom state
  - `DownloadTrackerService` - download tracking init
  - `RendererEventsService` - IPC event subscriptions

✅ Add explicit `app.initEvents()` method with guard code

✅ Update bootstrap sequence in `renderer.tsx`:
  ```
  app.initServices()
  app.initPages()
  app.initEvents()  ← NEW LAYER
  setContent(<App />)
  ```

✅ Delete/simplify:
  - EventHandler.tsx (entirely removed)
  - MainPage keyboard/drag handlers (moved to services)
  - Event subscriptions from pages-store (consolidated in RendererEventsService)

---

## Implementation Checklist

### Phase 1: Create Event Services
- [ ] Create `/src/renderer/api/internal/` folder
- [ ] Create `GlobalEventService.ts` (contextmenu, drag-drop, error handler)
- [ ] Create `KeyboardService.ts` (global shortcuts)
- [ ] Create `WindowStateService.ts` (window state subscriptions)
- [ ] Create `DownloadTrackerService.ts` (downloads init)
- [ ] Create `RendererEventsService.ts` (IPC subscriptions → pages)

### Phase 2: App Bootstrap Layer
- [ ] Add `initEvents()` method to `app.ts`
- [ ] Add guard flags: `_eventsInitialized`, `_pagesInitialized`, `_servicesInitialized`
- [ ] Add guard check to `init()`, `initServices()`
- [ ] Parallel import + init of 5 services in `initEvents()`

### Phase 3: Update Bootstrap Sequence
- [ ] Update `renderer.tsx` bootstrap():
  - Add `await app.initPages()`
  - Add `await app.initEvents()`
  - Move `api.windowReady()` to after `initEvents()`
- [ ] Remove `EventHandler` import from `index.tsx`

### Phase 4: Refactor Components
- [ ] Remove all event handlers from `MainPage.tsx`
  - Remove keydown listener
  - Remove onDrop/onWheel handlers
  - Keep render logic only
- [ ] Delete `EventHandler.tsx` entirely
- [ ] Move drag event wrapper div handler to GlobalEventService

### Phase 5: Consolidate IPC Events
- [ ] Extract page event subscriptions from `pages-store.ts` init()
- [ ] Move to `RendererEventsService.ts`:
  - eOpenFile → pages.open()
  - eOpenDiff → pages.openDiff()
  - eShowPage → pages.show()
  - eMovePageIn → pages.movePageIn()
  - eMovePageOut → pages.movePageOut()
  - eOpenUrl → openUrlInBrowserTab()
  - eOpenExternalUrl → openUrlInBrowserTab(external)
  - eBeforeQuit → pages.save()
- [ ] Simplify `pages-store.ts` init() - just page subscriptions

### Phase 6: Testing & Verification
- [ ] Test app starts without errors
- [ ] Test keyboard shortcuts work (Ctrl+Tab, Ctrl+W, Ctrl+N, Ctrl+O)
- [ ] Test right-click context menu
- [ ] Test drag-drop (files and tabs)
- [ ] Test IPC events (open file from main, quit, etc.)
- [ ] Test unhandled promise rejection shows notification
- [ ] Test window maximize/zoom state updates
- [ ] Build and verify no TypeScript errors

### Phase 7: Cleanup & Documentation
- [ ] Update `index.tsx` imports (remove EventHandler)
- [ ] Verify no references to old EventHandler remain
- [ ] Update CLAUDE.md key files list if needed
- [ ] Test on cold start - pages restore correctly
- [ ] Test no console errors during bootstrap

---

## Files to Create (5)

```
/src/renderer/api/internal/
├── GlobalEventService.ts         (contextmenu, drag, drop, error handler)
├── KeyboardService.ts            (global keyboard shortcuts)
├── WindowStateService.ts         (window state IPC subscriptions)
├── DownloadTrackerService.ts     (downloads init)
└── RendererEventsService.ts      (IPC event subscriptions)
```

---

## Files to Delete (1)

```
DELETE:
└── /src/renderer/app/EventHandler.tsx
```

---

## Files to Modify (6)

```
MODIFY:
├── /src/renderer.tsx                    <- Update bootstrap sequence
├── /src/renderer/index.tsx              <- Remove EventHandler
├── /src/renderer/api/app.ts             <- Add initEvents(), guards
├── /src/renderer/app/MainPage.tsx       <- Remove Event listeners
├── /src/renderer/store/pages-store.ts   <- Move IPC subs to service
└── (potentially) Other files importing EventHandler
```

---

## Bootstrap Sequence (After This Task)

```
renderer.tsx
    ↓
bootstrap()
    ├─ import("./renderer/index")  [side effects only, NO EventHandler]
    ├─ app.init()                   [version fetch, with guard]
    │
    ├─ app.initServices()           [settings, fs, ui, etc., with guard]
    │
    ├─ app.initPages()              [restore + CLI args, with guard]
    │
    ├─ app.initEvents()             [*** NEW LAYER ***]
    │  ├─ GlobalEventService.init()
    │  ├─ KeyboardService.init()
    │  ├─ WindowStateService.init()
    │  ├─ DownloadTrackerService.init()
    │  └─ RendererEventsService.init()
    │
    ├─ api.windowReady()           [signal to main process]
    │
    └─ setContent(<AppContent />)  [render with all systems ready]
```

---

## Acceptance Criteria

✅ All event handlers extracted to services
✅ EventHandler component deleted
✅ MainPage is simple render-only component
✅ App starts without errors
✅ All keyboard shortcuts work
✅ All IPC events work
✅ Bootstrap sequence clear and documented
✅ No console warnings/errors
✅ Passes build and tests
✅ Ready for US-050 (Pages API)

---

## Risk Assessment

**Risk Level:** 🟢 **LOW**

**Why:**
- Only refactoring existing code (no new functionality)
- Services are internal only (not exposed to scripts)
- Event handlers extracted as-is (no behavior changes)
- Guard code prevents double-initialization
- Can test each service independently

**Testing Strategy:**
1. Unit test each service's init()
2. Integration test bootstrap sequence
3. Manual test keyboard shortcuts, context menu, IPC
4. Verify no regressions in page operations

**Rollback Plan:** If issues arise, services can be re-integrated back into components

---

## Dependencies

**Blocks:** US-050 (Phase 4b — Pages API)

**Blocked By:** Nothing (independent task)

---

## Related Documentation

- Architecture Design: `/doc/future-architecture/8.app-pages.md` (Sections 3-5, 9-13)
- Bootstrap Details: Section 9 (Complete Bootstrap Timeline)
- Service Details: Section 4 (Service Details)
- Architecture Diagram: Section 13 (Final Architecture Diagram)

---

## Notes

- This task is **self-contained** and can be shipped independently
- After this task, app bootstrap will be explicit and testable
- Pages API (US-050) can proceed with confidence on clean architecture
- Event services can be extended (new global events) without touching components
