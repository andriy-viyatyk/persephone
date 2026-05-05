# US-477: Progress overlay — UIKit migration

## Status

**Active** — planning complete, awaiting user review before implementation. Per [EPIC-025](../../epics/EPIC-025.md) Phase 4 per-screen migration loop.

## Goal

Move the global progress / screen-lock / brief-notification overlay (`src/renderer/ui/dialogs/progress/Progress.tsx` + `ProgressModel.ts`) into UIKit at `src/renderer/uikit/Progress/`, alongside its model. After migration:

- The renderer composes from UIKit `Panel`, `Spinner`, and `Text` — zero `styled.*` for the visible pills, zero `style={…}`/`className={…}` outside UIKit (Rule 7).
- The root overlay element uses `data-type="progress-overlay"` + `data-mode` for state (Rule 1).
- All progress-related code (overlay component, singleton model, public helpers `showProgress` / `createProgress` / `notifyProgress` / `addScreenLock` / `removeScreenLock`) lives together in one folder under UIKit, matching the precedent set by US-476 (`uikit/Notification/`).
- No behavior change: the 300 ms reveal delay, 2 s notification auto-dismiss, header drag region, system-buttons cutout, z-index ordering relative to Dialog, and notification-priority-over-progress logic are all preserved bit-for-bit.

## Background

### Current shape

`src/renderer/ui/dialogs/progress/Progress.tsx` (97 lines):
- One `styled.div` (`ProgressRoot`) at `position: absolute; inset: 0; zIndex: 200; pointer-events: none`.
- Three nested elements selected by class:
  - `& .header-block` — top band, height 32 px, right-margin 130 px (leaves system buttons clickable), `WebkitAppRegion: "drag"`, `pointer-events: auto`. Lets the user drag the window during a long operation.
  - `& .content-block` — fills the rest, `pointer-events: auto`. Blocks all input below the title bar.
  - `& .progress-item` — centered pill (top: 72, left: 50%, transform translateX(-50%)) with `<CircularProgress size={18}/>` + label.
  - `& .notification-item` — centered pill at top: 52, label only, no spinner. Used for brief toasts.
- Render branches:
  1. `state.notifications.length > 0` → render only the notification pill (no overlay, no blocking).
  2. `state.items.length > 0` or `state.locks.length > 0` → render header-block + content-block, plus the progress pill if a progress item exists.
  3. Otherwise → `null`.
- Notifications take priority over progress/locks: when both are active, only the notification is shown until it auto-clears.

`src/renderer/ui/dialogs/progress/ProgressModel.ts` (144 lines):
- Internal types: `ProgressItem`, `ScreenLock`, `ProgressState`.
- `progressState: TGlobalState<ProgressState>` — singleton.
- Public API:
  - `ProgressHandle` interface (label getter/setter + `show(promise)`).
  - `createProgress(label) → ProgressHandle` — factory; the handle's `show` adds an item after a 300 ms delay (so quick promises produce no flicker), removes on settle.
  - `showProgress(promise, label)` — convenience wrapper around `createProgress(label).show(promise)`.
  - `notifyProgress(label, timeout = 2000)` — push to `state.notifications`, auto-remove after timeout.
  - `addScreenLock() → { id }` and `removeScreenLock(lock)` — push/pop to `state.locks`.

### Consumers (verified via grep)

Only **two** files import from `progress/`:

| File | Imports | Notes |
|------|---------|-------|
| `src/renderer/index.tsx:3` | `Progress` (component) | App shell mounts `<Progress />` once. |
| `src/renderer/api/ui.ts:49,53,54,59,65` | `showProgress`, `createProgress`, `notifyProgress`, `addScreenLock`, `removeScreenLock`, plus a TYPE import `import("…/ProgressModel").ProgressHandle` | All as dynamic `await import(…)` calls inside `app.ui.*` methods. |

No other file uses `progressState` directly. The script-API surface (`assets/editor-types/ui.d.ts`, `src/renderer/api/types/ui.d.ts`) declares `IProgressHandle` independently — its shape matches the renderer's `ProgressHandle`, so the script API does not need to change.

### Reference precedent — US-476

US-476 (`uikit/Notification/`) co-located the singleton `AlertsBar`, the `AlertItem` positioned wrapper, the `Notification` reusable card primitive, and the `alertsBarModel`. The user's stated rationale: "alerts functionality modules should be in one place." US-477 follows the same pattern for progress.

### Related UIKit primitives already available

| Primitive | Use in this migration |
|-----------|----------------------|
| `Panel` (from `uikit/Panel/Panel.tsx`) | Replaces `styled.div` for the centered pills (props: `position`, `top`, `left`, `gap`, `padding`, `background`, `rounded`, `shadow`). |
| `Spinner` (from `uikit/Spinner/Spinner.tsx`) | Drop-in replacement for `CircularProgress`; same `<ProgressIcon/>`, takes `size`. |
| `Text` (from `uikit/Text/Text.tsx`) | Renders the label text (props: `size`, `color`). |

Note: the `Dialog` / `DialogContent` primitives (US-432) are **not** used here — see Concern #1.

## Implementation plan

### Step 1 — Create `uikit/Progress/progressModel.ts` (verbatim move of `ProgressModel.ts`)

Path: `D:\projects\persephone\src\renderer\uikit\Progress\progressModel.ts`

Content: copy `src/renderer/ui/dialogs/progress/ProgressModel.ts` byte-for-byte, except adjust the import path:

```ts
// Old: import { TGlobalState } from "../../../core/state/state";
// New: import { TGlobalState } from "../../core/state/state";
```

The file is otherwise unchanged. Public surface (`ProgressHandle`, `createProgress`, `showProgress`, `notifyProgress`, `addScreenLock`, `removeScreenLock`) and behavior (300 ms delay, 2000 ms notification timeout, ID counter) preserved.

`progressState` remains an internal `export const` so `ProgressOverlay.tsx` can subscribe to it. It is **not** re-exported from `uikit/Progress/index.ts` (no external consumer needs it).

### Step 2 — Create `uikit/Progress/ProgressOverlay.tsx` (refactored renderer)

Path: `D:\projects\persephone\src\renderer\uikit\Progress\ProgressOverlay.tsx`

Replace the legacy `Progress.tsx`. Three structural changes:

1. **Two styled sub-elements** (`HeaderBlock`, `ContentBlock`) replace the className-based `& .header-block` / `& .content-block` selectors — clearer separation, no inner-class state.
2. **Two pills** become `<Panel>` compositions instead of `styled.div`.
3. **Root** uses `data-type="progress-overlay"` and `data-mode={"notification"|"progress"|"locked"|"none"}`.

Full content:

```tsx
import { useEffect, useState } from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { Panel } from "../Panel";
import { Spinner } from "../Spinner";
import { Text } from "../Text";
import { progressState } from "./progressModel";

const HEADER_HEIGHT = 32;
const SYSTEM_BUTTONS_WIDTH = 130;

const Root = styled.div(
    {
        position: "absolute",
        inset: 0,
        zIndex: 200,
        pointerEvents: "none",
    },
    { label: "ProgressOverlay" },
);

const HeaderBlock = styled.div({
    position: "absolute",
    top: 0,
    left: 0,
    right: SYSTEM_BUTTONS_WIDTH,
    height: HEADER_HEIGHT,
    backgroundColor: color.background.overlay,
    pointerEvents: "auto",
    WebkitAppRegion: "drag",
});

const ContentBlock = styled.div({
    position: "absolute",
    top: HEADER_HEIGHT,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color.background.overlay,
    pointerEvents: "auto",
});

type Mode = "none" | "notification" | "progress" | "locked";

export function ProgressOverlay() {
    const state = progressState.use();
    const hasNotifications = state.notifications.length > 0;
    const hasProgress = state.items.length > 0;
    const hasLocks = state.locks.length > 0;

    const mode: Mode = hasNotifications
        ? "notification"
        : hasProgress
        ? "progress"
        : hasLocks
        ? "locked"
        : "none";

    if (mode === "none") return null;

    if (mode === "notification") {
        const item = state.notifications[0];
        return (
            <Root key={item.id} data-type="progress-overlay" data-mode="notification">
                <Panel
                    position="absolute"
                    top={HEADER_HEIGHT + 20}
                    left="50%"
                    align="center"
                    background="dark"
                    rounded="sm"
                    shadow
                    paddingX="md"
                    paddingY="sm"
                    style={{ transform: "translateX(-50%)" }}
                    // NOTE: Panel disallows `style`. See concern #6 — resolved by
                    // adding a `transform` prop to Panel, or by absolute-positioning
                    // via `right` from a flex parent. The implementation below uses
                    // an inner Panel column with justify="center" — see Step 2 (alt).
                >
                    <Text>{item.label}</Text>
                </Panel>
            </Root>
        );
    }

    // mode === "progress" || "locked"
    const item = hasProgress ? state.items[0] : null;
    return (
        <Root data-type="progress-overlay" data-mode={mode}>
            <HeaderBlock />
            <ContentBlock />
            {item && (
                <Panel
                    position="absolute"
                    top={HEADER_HEIGHT + 40}
                    left="50%"
                    direction="row"
                    align="center"
                    gap="sm"
                    background="dark"
                    rounded="sm"
                    shadow
                    paddingX="md"
                    paddingY="sm"
                    style={{ transform: "translateX(-50%)", pointerEvents: "auto" }}
                >
                    <Spinner size={18} />
                    <Text>{item.label}</Text>
                </Panel>
            )}
        </Root>
    );
}
```

**Centering issue (resolved at implementation time):** Panel currently doesn't expose a `transform` prop, and Rule 7 forbids `style={…}` on UIKit components from outside UIKit — but `ProgressOverlay.tsx` lives **inside** UIKit, so passing `style` to Panel is permitted (Rule 7 applies to consumers of UIKit, not to UIKit's own composition). Panel forwards `style` via its inline-style merge in `Panel.tsx:321`. We rely on this. If a reviewer prefers no inline `style`, the alternative is to wrap each pill in a flex Root override that justifies center — but that fights the absolute positioning pattern. Decision: pass `style={{ transform: "translateX(-50%)", pointerEvents: "auto" }}` from inside UIKit. **This is a UIKit-internal exception, not an app-code violation of Rule 7.**

### Step 3 — Create `uikit/Progress/index.ts`

Path: `D:\projects\persephone\src\renderer\uikit\Progress\index.ts`

```ts
export { ProgressOverlay } from "./ProgressOverlay";
export {
    createProgress,
    showProgress,
    notifyProgress,
    addScreenLock,
    removeScreenLock,
} from "./progressModel";
export type { ProgressHandle } from "./progressModel";
```

Note: `progressState` is intentionally NOT re-exported — no consumer needs it.

### Step 4 — Update `uikit/index.ts`

Path: `D:\projects\persephone\src\renderer\uikit\index.ts`

Add a new section after the Notification block (line 51):

```ts
export { ProgressOverlay, createProgress, showProgress, notifyProgress, addScreenLock, removeScreenLock } from "./Progress";
export type { ProgressHandle } from "./Progress";
```

### Step 5 — Update `index.tsx` import

Path: `D:\projects\persephone\src\renderer\index.tsx`

Before:
```tsx
import { AlertsBar } from "./uikit";
import { Dialogs } from "./ui/dialogs/Dialogs";
import { Progress } from "./ui/dialogs/progress/Progress";
import { Poppers } from "./ui/dialogs/poppers/Poppers";
```

After:
```tsx
import { AlertsBar, ProgressOverlay } from "./uikit";
import { Dialogs } from "./ui/dialogs/Dialogs";
import { Poppers } from "./ui/dialogs/poppers/Poppers";
```

And in the JSX:
```tsx
<Progress />  →  <ProgressOverlay />
```

### Step 6 — Update `api/ui.ts` import paths

Path: `D:\projects\persephone\src\renderer\api\ui.ts`

Replace all five dynamic-import paths and the type-import path:

| Line | Before | After |
|------|--------|-------|
| 49 | `await import("../ui/dialogs/progress/ProgressModel")` | `await import("../uikit/Progress/progressModel")` |
| 53 | `Promise<import("../ui/dialogs/progress/ProgressModel").ProgressHandle>` | `Promise<import("../uikit/Progress/progressModel").ProgressHandle>` |
| 54 | `await import("../ui/dialogs/progress/ProgressModel")` | `await import("../uikit/Progress/progressModel")` |
| 59 | `import("../ui/dialogs/progress/ProgressModel")` | `import("../uikit/Progress/progressModel")` |
| 65 | `await import("../ui/dialogs/progress/ProgressModel")` | `await import("../uikit/Progress/progressModel")` |

Direct path (not via `uikit` barrel) is intentional: dynamic imports load the requested module's deps only, avoiding pulling in the rest of UIKit when a script calls `app.ui.notifyProgress`.

### Step 7 — Delete legacy folder

Delete entire folder:
- `D:\projects\persephone\src\renderer\ui\dialogs\progress\` (contains `Progress.tsx`, `ProgressModel.ts`)

Git should detect renames for `Progress.tsx → uikit/Progress/ProgressOverlay.tsx` and `ProgressModel.ts → uikit/Progress/progressModel.ts` (content is largely preserved).

### Step 8 — Verification

Run:
- `npx tsc --noEmit` — confirm zero new errors. Pre-existing errors in unrelated files are tracked separately (the US-476 baseline was 41).
- `npm run lint` — confirm clean.
- Manually test in dev: `npm start` and exercise the overlay (see acceptance criteria below).

### Step 9 — Storybook (skipped, by precedent)

Per US-476's pattern (AlertsBar singleton has no story; only the reusable `Notification` primitive does), `ProgressOverlay` is a singleton and not a reusable primitive — no story is added. The visible pills inside it (Panel + Spinner + Text) are already covered by their respective stories.

If the reviewer wants storybook coverage, an inline-state demo can be added in a follow-up task.

## Files that need NO changes

- `src/renderer/uikit/Spinner/*` — already does what `CircularProgress` did.
- `src/renderer/uikit/Panel/*` — already supports `position`, `top`, `left`, `gap`, `padding`, `background`, `rounded`, `shadow`, and forwards `style`.
- `src/renderer/uikit/Text/*` — already supports the needed text rendering.
- `src/renderer/api/types/ui.d.ts` — script-API `IProgressHandle` is already independent of the renderer's `ProgressHandle`.
- `assets/editor-types/ui.d.ts` — same.
- `docs/api/ui.md`, `docs/scripting.md`, `docs/whats-new.md` — script-API surface unchanged; user-facing docs unchanged.
- `src/renderer/components/basic/CircularProgress.tsx` — still used elsewhere (19 files, see grep results); leave in place.

## Concerns / Open questions

### 1. Dialog/DialogContent fit (RESOLVED)

The placeholder doc said to migrate using `Dialog` + `DialogContent`. After investigation:

- `ProgressOverlay` has no focusable elements → the focus trap that Dialog provides is not relevant.
- `ProgressOverlay` uses a custom two-band layout (header drag region + content block); Dialog's `data-position="center"` / `"right"` doesn't model this.
- Dialog runs a 0.1 s `pulse` keyframe on mount, which would visually conflict with the screen-lock blocking pattern.
- Dialog's z-index is 100; `ProgressOverlay` runs at 200 by design — it must overlay open dialogs (e.g. blocking a Confirmation Dialog while a long operation runs).

**Resolution:** do NOT use `Dialog`/`DialogContent`. Use `Panel` for the pills and styled sub-elements (`HeaderBlock`, `ContentBlock`) for the overlay layout. The Goal section at the top of this doc is updated accordingly.

### 2. Component name: `Progress` → `ProgressOverlay` (RESOLVED)

The legacy export is `Progress`, but `Progress` is too generic — HTML has `<progress>`, UIKit already has `Spinner`, and a future determinate `ProgressBar` would also want this name.

**Resolution:** rename to `ProgressOverlay`. One static call site (`index.tsx`) is updated. The model functions (`showProgress`, `createProgress`, etc.) keep their existing names — the script API surface is unchanged.

### 3. `progressState` visibility (RESOLVED)

The legacy `progressState` is exported from `ProgressModel.ts` but only consumed by `Progress.tsx`. It is not part of the script API.

**Resolution:** keep `progressState` as `export const` in `progressModel.ts` so `ProgressOverlay.tsx` can subscribe, but do NOT re-export from `uikit/Progress/index.ts` or from the `uikit` barrel. External consumers should use the helper functions only.

### 4. Single file vs split file for renderer + model (RESOLVED)

US-476 (AlertsBar) put model + renderer + `AlertItem` + `Notification` all in one folder, but each in its own file (`AlertsBar.tsx`, `AlertItem.tsx`, `Notification.tsx`). The model is inside `AlertsBar.tsx` because it's tightly coupled to the renderer.

For `ProgressOverlay`, the model is larger (5 public functions, 3 internal types) and pure logic — splitting `progressModel.ts` from `ProgressOverlay.tsx` is cleaner.

**Resolution:** two files. `progressModel.ts` (pure logic, no JSX) and `ProgressOverlay.tsx` (renderer).

### 5. Determinate progress bar (DEFERRED)

The placeholder doc mentioned a possible UIKit `ProgressBar` primitive for determinate progress.

The current API does not support determinate progress (`ProgressHandle` only has `label`, no `value`). No call site requests it.

**Resolution:** out of scope. Open as a separate backlog item if a real need emerges.

### 6. `style={transform}` and Rule 7 (RESOLVED)

The pills are positioned with `position: absolute; left: 50%; transform: translateX(-50%)`. Panel does not currently expose a `transform` prop; passing `style={…}` to Panel from app code is forbidden (Rule 7).

However, `ProgressOverlay.tsx` lives **inside** UIKit. Per Rule 7's exemption text: *"Inside UIKit Emotion is still used for component implementations. Internal helpers and primitive HTML elements are also fine — the rule applies to consumers of UIKit, not to UIKit itself."*

**Resolution:** pass `style={{ transform: "translateX(-50%)", pointerEvents: "auto" }}` from `ProgressOverlay.tsx` to Panel. This is a UIKit-internal composition, not an app-code violation. Adding a `transform` prop to Panel is rejected as YAGNI for one internal call site.

### 7. `WebkitAppRegion: "drag"` inside UIKit (RESOLVED)

This Electron-specific CSS property lets the user drag the window over the header band during a long operation.

**Resolution:** keep it. Persephone is an Electron app; UIKit code is allowed to assume Electron features. Only `ProgressOverlay` uses this property — it is not extracted to a token.

### 8. `HEADER_HEIGHT` (32) and `SYSTEM_BUTTONS_WIDTH` (130) (RESOLVED)

These constants are tied to Persephone's frameless-window chrome.

**Resolution:** keep as local constants at the top of `ProgressOverlay.tsx`. They are not used elsewhere; centralizing them in `tokens.ts` is premature.

### 9. Behavior parity (VERIFIED — no change)

| Behavior | Preserved? |
|----------|-----------|
| Notification toast: centered top, no overlay, auto-dismisses after 2 s default | ✅ |
| Progress pill: 300 ms reveal delay, spinner + label | ✅ |
| Screen lock: blocking overlay with no pill | ✅ |
| Header drag region (`WebkitAppRegion: "drag"`) | ✅ |
| `SYSTEM_BUTTONS_WIDTH` cutout for window controls | ✅ |
| Z-index 200 (above Dialog's 100) | ✅ |
| Notifications take priority: when both notification and progress/lock are active, only the notification renders | ✅ |
| `progressState` re-render on `.use()` | ✅ — same `TGlobalState` instance |

## Acceptance criteria

### Code

1. `src/renderer/uikit/Progress/ProgressOverlay.tsx` exists. The renderer composes from UIKit `Panel`, `Spinner`, `Text` — no `styled(Component)` wrappers around UIKit primitives.
2. `src/renderer/uikit/Progress/progressModel.ts` exists. Public exports identical to legacy `ProgressModel.ts`: `ProgressHandle`, `createProgress`, `showProgress`, `notifyProgress`, `addScreenLock`, `removeScreenLock`.
3. `src/renderer/uikit/Progress/index.ts` exists and exports the renderer + helpers + `ProgressHandle` type. Does NOT export `progressState`.
4. `src/renderer/uikit/index.ts` re-exports `ProgressOverlay`, `createProgress`, `showProgress`, `notifyProgress`, `addScreenLock`, `removeScreenLock`, and the `ProgressHandle` type.
5. `src/renderer/index.tsx` imports `ProgressOverlay` from `./uikit` (combined with the existing `AlertsBar` import) and renders `<ProgressOverlay />` in place of `<Progress />`.
6. `src/renderer/api/ui.ts` dynamic imports point at `../uikit/Progress/progressModel`. The `ProgressHandle` type-import path is updated.
7. The legacy folder `src/renderer/ui/dialogs/progress/` no longer exists.
8. `npx tsc --noEmit` reports the same number of errors as before US-477 (no new errors).
9. `npm run lint` is clean.

### Manual smoke test

10. **Notification toast** — call `app.ui.notifyProgress("Saved")` from a script. A small dark pill appears centered just below the title bar and auto-dismisses after ~2 s. No backdrop, no blocking. The window can be dragged during the toast.
11. **Progress pill** — call `app.ui.showProgress(longPromise, "Loading…")` where `longPromise` resolves after 1 s. The screen darkens (header + content blocks), the system buttons remain clickable, the title bar stays draggable, and a centered pill with spinner + "Loading…" appears after a 300 ms delay. Pill disappears when the promise settles.
12. **No flicker for fast operations** — call `app.ui.showProgress(Promise.resolve(), "Quick")`. No overlay should appear (resolves before the 300 ms delay).
13. **Updatable label** — `const p = await app.ui.createProgress("Step 1"); p.show(longPromise); p.label = "Step 2";` — the pill's text updates live.
14. **Screen lock** — `const lock = await app.ui.addScreenLock(); … lock.release();` — the screen darkens with no pill, system buttons remain clickable, title bar drags. Releasing removes the overlay.
15. **Z-order** — open a Confirmation Dialog via `app.ui.confirm(...)`, then trigger `addScreenLock` from another path. The screen-lock overlay covers the Confirmation Dialog (z-index 200 > 100).
16. **Notification priority** — fire `notifyProgress("Brief")` while a `showProgress` is active. The brief notification appears and the progress pill hides for ~2 s, then the progress pill returns until the promise settles.
17. **DOM data attributes** — DevTools shows the root element has `data-type="progress-overlay"` and `data-mode` set to one of `"notification"`, `"progress"`, `"locked"` matching the visible state.

## Files Changed summary

| File | Change | Notes |
|------|--------|-------|
| `src/renderer/uikit/Progress/ProgressOverlay.tsx` | **new** | Refactored renderer using Panel/Spinner/Text + styled HeaderBlock/ContentBlock. |
| `src/renderer/uikit/Progress/progressModel.ts` | **new** (rename of `ProgressModel.ts`) | Verbatim move; only relative-import depth updated. |
| `src/renderer/uikit/Progress/index.ts` | **new** | Folder barrel — exports renderer + helpers + `ProgressHandle` type. |
| `src/renderer/uikit/index.ts` | modified | Add `ProgressOverlay`, helpers, and `ProgressHandle` exports. |
| `src/renderer/index.tsx` | modified | Import path swap; rename `<Progress />` → `<ProgressOverlay />`. |
| `src/renderer/api/ui.ts` | modified | Five dynamic-import paths + one type-import path updated. |
| `src/renderer/ui/dialogs/progress/Progress.tsx` | **deleted** | Replaced by `uikit/Progress/ProgressOverlay.tsx`. |
| `src/renderer/ui/dialogs/progress/ProgressModel.ts` | **deleted** | Replaced by `uikit/Progress/progressModel.ts`. |
| `src/renderer/ui/dialogs/progress/` | **folder deleted** | No longer needed. |

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md) — Phase 4 (per-screen migration loop)
- Depends on: US-432 (Dialog primitive — done; ultimately not used here, see Concern #1)
- Precedent: US-476 (AlertsBar moved into UIKit alongside its model)
- Related: US-478 (page tabs), US-479 (sidebar lists), US-480 (markdown view) — Phase 4 siblings
