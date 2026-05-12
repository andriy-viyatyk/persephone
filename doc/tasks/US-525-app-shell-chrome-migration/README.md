# US-525: App shell + PageNavigator — chrome migration

## Status

**Placeholder** — Phase 4 per-screen migration under [EPIC-025](../../epics/EPIC-025.md).
Plan to be authored before implementation.

## Goal

Migrate the last legacy holdouts in the application shell to UIKit
primitives:

- `src/renderer/ui/app/MainPage.tsx`
- `src/renderer/ui/app/Pages.tsx`
- `src/renderer/ui/app/AsyncEditor.tsx`
- `src/renderer/ui/navigation/PageNavigator.tsx`

After this task, no file under `src/renderer/ui/app/` or
`src/renderer/ui/navigation/` imports from
`components/basic|form|layout|overlay/`. This closes the last gap in
the application chrome (sidebar, tabs, dialogs, and overlays are
already on UIKit per US-479…US-497, US-432, US-481).

## Background

### Files in scope

Confirmed via grep for legacy imports:

- `ui/app/MainPage.tsx` — uses legacy `FlexSpace`
  (`components/layout/Elements`) and legacy `Button`.
- `ui/app/Pages.tsx` — uses legacy `Splitter`.
- `ui/app/AsyncEditor.tsx` — uses legacy `CircularProgress` and
  `EditorErrorBoundary`. `EditorErrorBoundary` is the in-editor error
  fallback; classify as chrome and decide whether to migrate or keep
  under Rule-7 exception.
- `ui/navigation/PageNavigator.tsx` — uses legacy
  `CollapsiblePanelStack` and `CollapsiblePanel`. UIKit equivalent
  landed via US-517.

### Files NOT in scope (verified)

- `ui/navigation/LazySecondaryEditor.tsx` — under `ui/` (chrome) and
  exempt under Rule 7's chrome exception. Per US-507 precedent.
- `ui/navigation/secondary-editor-registry.ts` — registry, no JSX.
- `ui/app/RenderEditor.tsx` — does not import legacy primitives
  (verified via grep). Confirm during planning.

### Reference migrations

- **US-517 CollapsiblePanelStack** — landed the UIKit primitive used
  by `PageNavigator`. US-517 explicitly called out PageNavigator as an
  "opportunistic" follow-up — this task fulfils that.
- **US-509 Grid editor chrome** — reference for "small chrome,
  multiple primitives" migration pattern.
- **US-477 Progress** — landed UIKit `Spinner` / `Progress` primitive
  to replace `CircularProgress`.

### UIKit primitive availability

All primitives needed are landed:

- `Spacer` (replaces `FlexSpace`) — Phase 4 baseline.
- `Button` — Phase 4 baseline.
- `Splitter` — US-486.
- `CollapsiblePanelStack` — US-517.
- `Spinner` (replaces `CircularProgress` for indeterminate cases)
  — landed under US-477 (per epic doc).
- `name?: string` — US-521.

### Risk surface

`MainPage.tsx` and `Pages.tsx` are the outermost layout host —
regressions here affect every page. Splitter behavior in `Pages.tsx`
controls the grouped-pages side-by-side layout. Smoke testing must
cover grouped-page activation, splitter drag, and persistence of
splitter position.

`PageNavigator.tsx` hosts the secondary editor sidebar — regressions
break Explorer / Search / Archive / Link-Category / Link-Hostnames /
Link-Tags panel display.

## Implementation plan

*To be authored.* High-level outline:

1. `MainPage.tsx` — drop `FlexSpace` → `Spacer`; legacy `Button` →
   UIKit `Button`.
2. `Pages.tsx` — legacy `Splitter` → UIKit `Splitter`. Preserve
   `onResize` callback and persisted-position contract.
3. `AsyncEditor.tsx` — `CircularProgress` → UIKit `Spinner`. Decide
   whether to migrate `EditorErrorBoundary` (likely keep under Rule-7
   chrome exception; out of scope).
4. `PageNavigator.tsx` — `CollapsiblePanelStack` /
   `CollapsiblePanel` from `components/layout/` →
   `uikit/CollapsiblePanelStack`. Preserve `headerRef` portal
   contract used by every secondary editor.
5. Adopt `name?` debug attribute per US-521 convention.
6. Baseline-relative `tsc` + `lint` pass; full chrome smoke.

## Concerns / Open questions

*Authored placeholder — to be expanded.*

- **`EditorErrorBoundary` migration.** It lives under
  `components/basic/` but provides crash-recovery chrome inside every
  async editor. Either migrate it to `uikit/` (semantic
  recategorisation) or keep it under Rule-7 chrome exception. Decide
  before implementation.
- **`CircularProgress` vs `Spinner`.** UIKit has `Spinner` for
  indeterminate loading and `ProgressOverlay` for full-screen
  blocking spinners. `AsyncEditor.tsx` uses `CircularProgress` while
  an editor module is being dynamically imported — pick the closest
  UIKit replacement and validate the visual.
- **Splitter `onResize` persistence.** `Pages.tsx` persists splitter
  position to settings on resize. UIKit `Splitter` must expose the
  same callback or an equivalent. Verify before starting.
- **PageNavigator headerRef contract.** Every secondary editor uses
  `createPortal(headerContent, headerRef)` (see US-507 background).
  UIKit `CollapsiblePanelStack` must expose `headerRef` identically.
  Verify before starting.

## Acceptance criteria

- No imports from `components/basic|form|layout|overlay/` in any file
  under `src/renderer/ui/app/` or
  `src/renderer/ui/navigation/PageNavigator.tsx`.
- No `@emotion/styled` usage in those files beyond per-file Rule-7
  chrome exceptions.
- Splitter persistence behaviour preserved.
- Secondary editor portal contract preserved.
- All migrated UIKit primitives carry meaningful `name` debug
  attributes per US-521.
- `npm run lint` baseline unchanged.
- `npx tsc --noEmit` baseline unchanged.
- Manual smoke covering: window open, grouped-pages splitter drag +
  persistence, dynamic editor load spinner, error fallback, every
  secondary editor (Explorer, Search, Archive, Link panels) renders
  correctly inside PageNavigator.

This task does NOT run `/review`, `/document`, or `/userdoc` — those
run at EPIC-025 close per the deferred-review model.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Related primitives: US-517 CollapsiblePanelStack, US-486 Splitter,
  US-477 Spinner / Progress
- Predecessor: US-517 noted PageNavigator as an "opportunistic"
  retrofit — this task fulfils it.
- Related: US-507 Explorer + Search secondary editors (consumers of
  the headerRef portal contract)
