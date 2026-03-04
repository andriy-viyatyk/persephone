# US-051: Window API Consolidation — Absorb MainPageModel into `app.window`

## Status

**Status:** In Progress
**Priority:** High
**Started:** 2026-03-03

## Summary

Absorb all MainPageModel state and logic into `app.window`, eliminating triple-duplicated event subscriptions and method wrappers. MainPage becomes a pure render function. Window state becomes scriptable.

## Why

- **Triple duplication:** `eWindowMaximized` / `eZoomChanged` subscribed in 3 places: `Window` constructor, `WindowStateService`, and `MainPageModel`
- **Method duplication:** `minimizeWindow()`, `closeWindow()`, `resetZoom()`, `toggleWindow()` in MainPageModel are thin wrappers around what `app.window` already provides
- **State duplication:** `maximized` and `zoomLevel` stored in both MainPageModel and `appWindow`
- **`menuBarOpen` is window-level state** currently trapped inside a React component model, inaccessible to scripts/AI
- **Scriptability:** Moving everything to `app.window` allows scripts and future AI bot to access window state and manipulate it

## Acceptance Criteria

- [x] `app.window` owns all window state: `isMaximized`, `zoomLevel`, `menuBarOpen`
- [x] `app.window` has reactive state via `TOneState` with `.use()` for React
- [x] Event subscriptions exist ONLY in `WindowStateService` (removed from Window constructor)
- [x] `WindowStateService` uses proper internal methods (no `(appWindow as any)` cast)
- [x] MainPageModel deleted — MainPage is a pure render function using `app.window`
- [x] New methods added: `toggleWindow()`, `toggleMenuBar()`
- [x] `window.d.ts` updated with new properties/methods for script IntelliSense
- [ ] No regressions in window controls (minimize, maximize, restore, close)
- [ ] No regressions in zoom indicator
- [ ] No regressions in menu bar toggle
- [x] Documentation updated

## What Was Found (Analysis)

### Triple Event Subscription

| Location | File | Events |
|---|---|---|
| Window constructor | `api/window.ts:13-18` | `eWindowMaximized`, `eZoomChanged` |
| WindowStateService | `api/internal/WindowStateService.ts:11-17` | Same, via `(appWindow as any)` |
| MainPageModel | `app/MainPage.tsx:104-124` | Same, into local state |

### Method Duplication

| MainPageModel | appWindow |
|---|---|
| `minimizeWindow()` → `api.minimizeWindow()` | `minimize()` → same |
| `closeWindow()` → `api.closeWindow()` | `close()` → same |
| `resetZoom()` → `api.resetZoom()` | `resetZoom()` → same |
| `toggleWindow()` → check maximized → restore/maximize | `isMaximized` + `restore()`/`maximize()` |

### State Only in MainPageModel

| State | Current Location | Target |
|---|---|---|
| `menuBarOpen` | MainPageModel only | `app.window.menuBarOpen` |

## Files to Modify

- `src/renderer/api/window.ts` — Add `TOneState`, reactive state, `toggleWindow()`, `toggleMenuBar()`, internal update methods
- `src/renderer/api/types/window.d.ts` — Add `menuBarOpen`, `toggleWindow()`, `toggleMenuBar()` for script IntelliSense
- `src/renderer/api/internal/WindowStateService.ts` — Use proper internal methods instead of `(appWindow as any)`
- `src/renderer/app/MainPage.tsx` — Delete MainPageModel, make pure render function using `app.window`

## Implementation Progress

### Step 1: Refactor `app.window` with reactive state
- [x] Add `TOneState` to Window class with `{ isMaximized, zoomLevel, menuBarOpen }`
- [x] Add `toggleWindow()` method
- [x] Add `menuBarOpen` property + `toggleMenuBar()` method
- [x] Add `.use()` React hook method (NOT in .d.ts)
- [x] Add internal `_updateMaximized()` / `_updateZoomLevel()` methods for WindowStateService
- [x] Remove event subscriptions from Window constructor

### Step 2: Update WindowStateService
- [x] Use `_updateMaximized()` / `_updateZoomLevel()` instead of `(appWindow as any)`

### Step 3: Update app.ts
- [x] Change getter type from `IWindow` to `Window` (concrete class, so `.use()` is accessible)

### Step 4: Simplify MainPage
- [x] Delete `MainPageModel` class and `defaultMainPageState`
- [x] Make MainPage read state from `app.window.use()`
- [x] Call `app.window.*` methods directly (minimize, toggleWindow, close, etc.)
- [x] Remove unused imports (TComponentModel, useComponentModel, api, rendererEvents)

### Step 5: Update declarations + docs
- [x] Update `window.d.ts` with new properties/methods
- [x] Update API reference `doc/future-architecture/api-reference/window.md`
- [x] Fix zoomLevel default doc (was `1.0`, corrected to `0`)
- [ ] `assets/editor-types/` — auto-copied by Vite plugin at build time

## Notes

### 2026-03-03
- Analysis revealed triple event subscription duplication
- Decision: `menuBarOpen` is window-level state, belongs in `app.window`
- `.use()` stays hidden from scripts (React-only, not in `.d.ts`) per existing convention
- This is a continuation of Phase 2 (`app.window`) — consolidation that became visible after Phase 4 cleaned up other areas

## Related

- Previous: US-050 (Phase 4b — Pages API)
- Previous: US-044 (Phase 2 — original `app.window` implementation)
- Migration plan: [/doc/future-architecture/migration/5.app-window.md](../../future-architecture/migration/5.app-window.md)
