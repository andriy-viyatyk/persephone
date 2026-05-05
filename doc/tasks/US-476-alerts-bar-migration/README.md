# US-476: AlertsBar + AlertItem — UIKit migration

## Goal

Migrate the toast/alert strip at [src/renderer/ui/dialogs/alerts/](../../../src/renderer/ui/dialogs/alerts/) into UIKit as a single `uikit/Notification/` module. After this task:

- All alerts code lives in `src/renderer/uikit/Notification/` — the primitive, the host component, the positioning wrapper, and the model. The legacy `src/renderer/ui/dialogs/alerts/` folder is deleted.
- The new files contain zero `@emotion/styled` imports outside the primitive, zero `style={...}` attributes, zero `className={...}` attributes, zero `clsx` calls.
- Severity coloring (info / success / warning / error), the entrance slide-in animation, and the close button live inside a new UIKit primitive — `uikit/Notification/Notification.tsx` — keyed by `data-type="notification"` and `data-severity="…"` (Rule 1).
- `AlertItem.tsx` becomes a thin positioning shell: it owns the auto-close timer and the absolute `top`/`right` placement (via `Panel`), and renders `<Notification>` for the visible body.
- `alertsBarModel.addAlert(message, type)` keeps its existing public signature and Promise-resolve semantics. All 30+ callers across the app and scripting API ([api/ui.ts:39](../../../src/renderer/api/ui.ts#L39)) keep working — only their import paths change.

This is the next per-screen migration of [EPIC-025](../../epics/EPIC-025.md) Phase 4.

## Background

### EPIC-025 Phase 4 context

Per-screen migration loop (from [EPIC-025](../../epics/EPIC-025.md) Phase 4):

1. Pick a screen
2. Audit which UIKit components are needed and which are missing
3. Build missing components / prop extensions in Storybook first
4. Rewrite the screen with UIKit
5. Smoke-test the screen

### Why a new `Notification` primitive (not a Panel extension)

Severity coloring (info / success / warning / error) is too specific to belong on `Panel`. The four severities have a coordinated background + text + border + close-icon-hover-color set, plus a leading icon and a slide-in animation — all behaviors that belong together in one focused component, not spread across Panel props.

Three options were considered:

1. **Add `severity` / `variant` to `Panel`** — pollutes a layout primitive with notification-specific styling and the icon/close composition still has nowhere to live.
2. **Inline `styled.div` in `AlertItem.tsx`** — violates Rule 7 (no Emotion in app code).
3. **Build a UIKit `Notification` primitive** ✅ — focused presentation component; severity styling, icon, close button, and slide-in animation all live in one place.

Option 3 also leaves a reusable building block for future inline notifications (progress dialog errors, script result banners, etc.) without driving any of those today.

### Current implementation

#### [src/renderer/ui/dialogs/alerts/AlertsBar.tsx](../../../src/renderer/ui/dialogs/alerts/AlertsBar.tsx) — 137 lines

The host component. Owns the global `alertsBarModel` (queue of up to 3 alerts; oldest non-error is evicted when a 4th arrives), tracks per-alert measured heights for stack offsets, and renders one `<AlertItem>` per alert with computed `top`/`right`. The file has **zero Emotion / clsx / className** today — it is already a pure model + render component.

The model exposes the public API the rest of the app uses:

```ts
export const alertsBarModel = new AlertsBarModel(new TGlobalState(defaultAlertsBarState));

// Public API — must remain stable:
alertsBarModel.addAlert(message: string, type: TMessageType): Promise<unknown>
```

`AlertsBar` measures each rendered AlertItem via a callback ref and calls `model.updateHeight(a, ref.scrollHeight)` so subsequent alerts in the stack get correctly offset `top` values:

```tsx
<AlertItem
    key={a.key}
    data={a}
    top={model.alertTop(a)}
    right={16}
    ref={(ref: HTMLDivElement) => ref && model.updateHeight(a, ref.scrollHeight)}
/>
```

Stack layout: first alert at `top: 42`. Each subsequent alert sits below the previous by `prevHeight + 8` (gap). Heights default to 40 until measured.

#### [src/renderer/ui/dialogs/alerts/AlertItem.tsx](../../../src/renderer/ui/dialogs/alerts/AlertItem.tsx) — 193 lines

Where all the legacy styling lives:

- `AlertItemRoot = styled.div<{top, right}>(...)` — 90 lines of CSS-in-JS:
  - `position: absolute; top; right; zIndex: 1000`
  - `border: 1px solid; borderColor: color.border.default; borderRadius: 6`
  - `padding: 8px 32px 8px 8px; display: flex; columnGap: 8; cursor: pointer`
  - Slide-in keyframe animation (from `right: -300` → final `right`), 0.2s ease-in-out
  - `transition: top 0.2s ease-in-out` for stack-shuffle smoothing
  - `& .icon { display: flex; align-items: center; & svg { width: 20; height: 20 } }`
  - `& .message { white-space: pre-wrap; display: flex; align-items: center }`
  - `& .closeButton { position: absolute; top: 4; right: 4 }`
  - Four `&.errorItem` / `&.infoItem` / `&.successItem` / `&.warningItem` blocks setting backgroundColor / color / borderColor + close-icon-hover color from `color.{error,success,warning}.{background,text,border,textHover}` and `color.background.message` / `color.icon.default` for info.
- `clsx({ errorItem, infoItem, successItem, warningItem })` to pick the severity class.
- Legacy `<Button size="small" type="icon">` from `components/basic/Button` for the close X.
- Severity → `<ErrorIcon|WarningIcon|SuccessIcon|InfoIcon>` lookup.
- `useEffect` auto-close timer based on type (`info`/`warning` → 5s, `success` → 2s, `error` → 0 = no auto-close).
- Click on body fires `data.onClose('clicked')`; click on X fires `data.onClose()` (different return value to the awaiting caller).

### TMessageType

[src/renderer/core/utils/types.ts:7](../../../src/renderer/core/utils/types.ts#L7):

```ts
export type TMessageType = "info" | "success" | "warning" | "error";
```

### Public API surface

`AlertsBar` is mounted in [src/renderer/index.tsx:16](../../../src/renderer/index.tsx#L16). The model is consumed via `alertsBarModel.addAlert()` from:

- [src/renderer/api/ui.ts:39](../../../src/renderer/api/ui.ts#L39) — `app.ui.notify()` script API entry point.
- ~30 internal callers (editors, models, content parsers, lifecycle, etc.) located via grep.

**None of these caller surfaces change.** The migration is internal to the alerts/ folder plus the new UIKit primitive.

### Audit — element by element

| Old element | UIKit replacement | Gap |
|---|---|---|
| `AlertItemRoot` (positioning + visible body fused) | Split into two: `<Panel position="absolute" top right zIndex={1000}>` (positioning) wrapping `<Notification type message onClick onClose/>` (visible body) | new component — Notification |
| Severity background/text/border (4 variants) | `Notification` styled root with `data-severity={type}` selectors mapping to `color.{error,success,warning}.{background,text,border}` and `color.background.message` for info | inside the new primitive |
| Slide-in keyframe (right: -300 → final right) | `Notification` keyframe using `transform: translateX(300px) → translateX(0)` (decoupled from positioning) | inside the new primitive |
| `transition: top 0.2s ease-in-out` (stack shuffle) | not implemented — drift accepted (alerts will snap to new top instead of sliding when one above closes) | drift |
| `& .icon` (20×20 svg wrapper) | `Notification` renders the matching severity icon at 20×20 directly inside its styled root (same `& svg { width: 20; height: 20 }` rule) | inside the new primitive |
| `& .message` (pre-wrap, flex center) | `<Text size="base" color="inherit" preWrap>` inside the Notification body. `color="inherit"` lets the parent's `data-severity` color cascade. | none — Text already supports `preWrap` |
| `<Button size="small" type="icon" className="closeButton close-alert">` for X | UIKit `<IconButton size="sm" icon={<CloseIcon/>} title="Close" />` positioned via parent-selector CSS inside the Notification root (`& > [data-part="close"] { position: absolute; top: 4; right: 4 }`) | UIKit IconButton size="sm" is 24×24 with 16×16 icon — exact match for legacy. |
| Close-icon hover color (per-severity `textHover`) | Notification overrides IconButton's hover color via parent selector: `&[data-severity="error"] [data-type="icon-button"]:hover { color: var(--color-error-text-hover) }`. Etc. for success / warning. Info keeps default IconButton hover behavior. | parent-selector override inside Notification — fine |
| `cursor: pointer` on the whole row + click-to-dismiss | Notification root is a `<div role="status" onClick>` — body click fires `onClick`; the close X stops propagation and fires `onClose`. AlertItem maps `onClick → onClose("clicked")` and `onClose → onClose()` to preserve resolve-value semantics. | none |

### UIKit additions

**One new component**, no existing primitive changes:

#### `uikit/Notification/Notification.tsx` (new)

```tsx
import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { spacing, gap, radius, height } from "../tokens";
import { CloseIcon, ErrorIcon, InfoIcon, SuccessIcon, WarningIcon } from "../../theme/icons";
import { IconButton } from "../IconButton/IconButton";
import { Text } from "../Text/Text";

export type NotificationSeverity = "info" | "success" | "warning" | "error";

export interface NotificationProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className"> {
    /** Severity. Drives background, text, border, icon, and close-button hover color. */
    type: NotificationSeverity;
    /** Notification message. Renders with `white-space: pre-wrap` so `\n` are preserved. */
    message: string;
    /** Body click handler. The close-button click does NOT propagate here. */
    onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
    /** Close-button click handler. When omitted, the close button is not rendered. */
    onClose?: () => void;
}

const slideIn = `@keyframes notification-slide-in {
    from { transform: translateX(300px); }
    to   { transform: translateX(0); }
}`;

const Root = styled.div(
    {
        position: "relative",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        columnGap: gap.lg,                        // 8
        padding: `${spacing.md}px ${spacing.xxxl}px ${spacing.md}px ${spacing.md}px`,
        // 8 / 32 / 8 / 8 — right padding leaves room for the absolutely-positioned close X
        border: "1px solid",
        borderColor: color.border.default,
        borderRadius: radius.lg,                  // 6
        animation: "notification-slide-in 0.2s ease-in-out",

        "& [data-part='icon']": {
            display: "inline-flex",
            alignItems: "center",
            "& svg": { width: 20, height: 20 },
        },
        "& [data-part='close']": {
            position: "absolute",
            top: spacing.sm,                      // 4
            right: spacing.sm,                    // 4
        },

        // --- Severity ---
        '&[data-severity="info"]': {
            backgroundColor: color.background.message,
            "& [data-part='icon']": { color: color.icon.default },
        },
        '&[data-severity="error"]': {
            backgroundColor: color.error.background,
            color: color.error.text,
            borderColor: color.error.border,
            '& [data-part="close"] [data-type="icon-button"]':         { color: color.error.text },
            '& [data-part="close"] [data-type="icon-button"]:hover':   { color: color.error.textHover },
        },
        '&[data-severity="success"]': {
            backgroundColor: color.success.background,
            color: color.success.text,
            borderColor: color.success.border,
            '& [data-part="close"] [data-type="icon-button"]':         { color: color.success.text },
            '& [data-part="close"] [data-type="icon-button"]:hover':   { color: color.success.textHover },
        },
        '&[data-severity="warning"]': {
            backgroundColor: color.warning.background,
            color: color.warning.text,
            borderColor: color.warning.border,
            '& [data-part="close"] [data-type="icon-button"]':         { color: color.warning.text },
            '& [data-part="close"] [data-type="icon-button"]:hover':   { color: color.warning.textHover },
        },

        // --- Cursor (only when a body click handler is wired up) ---
        "&[data-clickable]": { cursor: "pointer" },
    },
    { label: "Notification" },
);

const SEVERITY_ICON: Record<NotificationSeverity, React.ReactNode> = {
    info:    <InfoIcon />,
    success: <SuccessIcon />,
    warning: <WarningIcon />,
    error:   <ErrorIcon />,
};

const ARIA_ROLE: Record<NotificationSeverity, "alert" | "status"> = {
    error:   "alert",
    warning: "status",
    success: "status",
    info:    "status",
};

const ARIA_LIVE: Record<NotificationSeverity, "assertive" | "polite"> = {
    error:   "assertive",
    warning: "polite",
    success: "polite",
    info:    "polite",
};

export const Notification = React.forwardRef<HTMLDivElement, NotificationProps>(
    function Notification({ type, message, onClick, onClose, ...rest }, ref) {
        const handleClose = (e: React.MouseEvent) => {
            e.stopPropagation();
            onClose?.();
        };

        return (
            <>
                <style>{slideIn}</style>
                <Root
                    ref={ref}
                    data-type="notification"
                    data-severity={type}
                    data-clickable={onClick ? "" : undefined}
                    role={ARIA_ROLE[type]}
                    aria-live={ARIA_LIVE[type]}
                    onClick={onClick}
                    {...rest}
                >
                    <span data-part="icon">{SEVERITY_ICON[type]}</span>
                    <Text size="base" color="inherit" preWrap>{message}</Text>
                    {onClose && (
                        <span data-part="close">
                            <IconButton
                                size="sm"
                                icon={<CloseIcon />}
                                title="Close"
                                onClick={handleClose}
                            />
                        </span>
                    )}
                </Root>
            </>
        );
    },
);
```

Notes on the implementation:

- **Slide-in animation** uses `transform: translateX(300px) → translateX(0)` so it does not interact with the parent's `right` positioning. (The legacy implementation animated `right: -300 → finalRight`, which only worked because the legacy root was the same element that owned `right`.) Inlined keyframes via `<style>{...}</style>` keep this self-contained — the alternative (`@emotion/react` `keyframes`) would also work but adds a second Emotion API to the file.
- **`role="alert"` for error, `role="status"` for others** — error notifications interrupt screen readers immediately; others wait for the next pause. Matches WAI-ARIA notification patterns.
- **`data-clickable`** keeps the cursor: pointer behavior limited to alerts that actually have an `onClick` handler; if a future caller passes only `onClose` (or nothing), the body is not "clickable-looking" misleadingly.
- **Close button inside parent-selector zone** — Notification overrides IconButton's color/hover via `data-severity` selectors. This is a reasonable cross-component override because Notification is the immediate parent and the override is keyed on its own severity attribute, not on a name from somewhere else in the tree.
- **No animation on the stack shuffle** — when an earlier alert closes, later alerts will snap to their new `top`. The legacy `transition: top 0.2s ease-in-out` is dropped (drift). Reinstating it later would mean adding a `transition` prop to `Panel`, which is too generic; better to add a focused affordance if/when the drift is judged unacceptable.

#### `uikit/Notification/Notification.story.tsx` (new)

Storybook story with controls:

- `type: "info" | "success" | "warning" | "error"` (segmented control)
- `message: string` (text input — accept multi-line via `\n`)
- `onClick: bool` (toggles whether to wire up a body click handler — visible cursor + click log)
- `onClose: bool` (toggles whether the close X is rendered)

Confirms severity coloring, slide-in animation (re-mounting via story replay), close-button hover color override, and the `data-clickable` cursor toggle.

#### `uikit/Notification/index.ts` (new)

```ts
export { Notification } from "./Notification";
export type { NotificationProps, NotificationSeverity } from "./Notification";
```

#### `uikit/index.ts` (modify)

Add under "Overlay" section:

```ts
export { Notification } from "./Notification";
export type { NotificationProps, NotificationSeverity } from "./Notification";
```

#### `editors/storybook/storyRegistry.ts` (modify)

Register `notificationStory` after the existing entries (alphabetical or by adoption order — match the existing convention there).

### Files involved

| File | Role | Change |
|------|------|--------|
| [src/renderer/uikit/Notification/Notification.tsx](../../../src/renderer/uikit/Notification/Notification.tsx) | New UIKit primitive | Create |
| [src/renderer/uikit/Notification/AlertsBar.tsx](../../../src/renderer/uikit/Notification/AlertsBar.tsx) | Toast queue host (moved from `ui/dialogs/alerts/`) | Create — copy verbatim from old location, only update its internal import to `./AlertItem` |
| [src/renderer/uikit/Notification/AlertItem.tsx](../../../src/renderer/uikit/Notification/AlertItem.tsx) | Toast row (moved + rewritten) | Create — drops Emotion / clsx / legacy Button; renders `<Panel>` + `<Notification>` |
| [src/renderer/uikit/Notification/Notification.story.tsx](../../../src/renderer/uikit/Notification/Notification.story.tsx) | Storybook story | Create |
| [src/renderer/uikit/Notification/index.ts](../../../src/renderer/uikit/Notification/index.ts) | Barrel | Create |
| [src/renderer/uikit/index.ts](../../../src/renderer/uikit/index.ts) | UIKit barrel | Add Notification + AlertsBar + alertsBarModel + AlertData exports |
| [src/renderer/editors/storybook/storyRegistry.ts](../../../src/renderer/editors/storybook/storyRegistry.ts) | Story registry | Register `notificationStory` |
| [src/renderer/index.tsx](../../../src/renderer/index.tsx) | App entry | Update `AlertsBar` import path: `./ui/dialogs/alerts/AlertsBar` → `./uikit` |
| [src/renderer/api/ui.ts](../../../src/renderer/api/ui.ts) | Script API `notify()` | Update `alertsBarModel` import path: `../ui/dialogs/alerts/AlertsBar` → `../uikit` |
| [src/renderer/editors/graph/GraphViewModel.ts](../../../src/renderer/editors/graph/GraphViewModel.ts) | Graph editor (uses `addAlert` directly) | Update `alertsBarModel` import path: `../../ui/dialogs/alerts/AlertsBar` → `../../uikit` |
| [src/renderer/ui/dialogs/index.ts](../../../src/renderer/ui/dialogs/index.ts) | Dialogs barrel | Remove the three `AlertsBar` / `AlertItem` / `AlertData` re-exports (lines 3–5) |
| [src/renderer/ui/dialogs/alerts/AlertItem.tsx](../../../src/renderer/ui/dialogs/alerts/AlertItem.tsx) | Old location | **Delete** |
| [src/renderer/ui/dialogs/alerts/AlertsBar.tsx](../../../src/renderer/ui/dialogs/alerts/AlertsBar.tsx) | Old location | **Delete** (folder `ui/dialogs/alerts/` becomes empty and is removed) |

### Files NOT changed

- `src/renderer/theme/color.ts` — severity color tokens (`color.error.*`, `color.success.*`, `color.warning.*`, `color.background.message`) already exist; no new tokens needed.
- `src/renderer/theme/icons.tsx` — `ErrorIcon`, `WarningIcon`, `SuccessIcon`, `InfoIcon`, `CloseIcon` already exist; no changes.
- `src/renderer/components/basic/Button.tsx` — kept (other consumers exist); only AlertItem stops importing it.
- All ~30 callers of `alertsBarModel.addAlert()` / `app.ui.notify()` — public API unchanged. Only the three direct `alertsBarModel` import sites listed above (`api/ui.ts`, `editors/graph/GraphViewModel.ts`) and the `<AlertsBar />` mount in `index.tsx` get path updates. Indirect callers via `app.ui.notify()` are unaffected.

## Implementation plan

### Step 1 — Create `Notification` primitive

1. Create folder `src/renderer/uikit/Notification/`.
2. Write `Notification.tsx` per the implementation in the Background section above.
3. Write `index.ts` exporting `Notification`, `NotificationProps`, `NotificationSeverity`.

### Step 2 — Add Notification story

1. Write `Notification.story.tsx` with the controls listed above (type, message, onClick toggle, onClose toggle).
2. Verify visually in Storybook: each severity renders correctly; slide-in plays on remount; close-X hover color matches severity textHover; clicking the X does not also fire body onClick (test by wiring both and watching the log).

### Step 3 — Register Notification + alerts module in UIKit barrel

[src/renderer/uikit/index.ts](../../../src/renderer/uikit/index.ts) — add under the "Overlay" section (alongside `Popover`, `Tooltip`, `Dialog`):

```ts
// Overlay
export { Popover } from "./Popover";
// ...existing exports...
export { Notification } from "./Notification";
export type { NotificationProps, NotificationSeverity } from "./Notification";
export { AlertsBar, AlertItem, alertsBarModel } from "./Notification";
export type { AlertData } from "./Notification";
```

The single `./Notification` barrel re-exports both the primitive and the alerts host (see Step 9 below).

### Step 4 — Register Notification story

[src/renderer/editors/storybook/storyRegistry.ts](../../../src/renderer/editors/storybook/storyRegistry.ts) — add `notificationStory` import + register call alongside existing UIKit stories.

### Step 5 — Move and rewrite `AlertItem.tsx`

Create `src/renderer/uikit/Notification/AlertItem.tsx` with the following body. The legacy file at `src/renderer/ui/dialogs/alerts/AlertItem.tsx` is deleted in Step 8.

```tsx
import { forwardRef, useEffect } from "react";
import { TMessageType } from "../../core/utils/types";
import { Panel } from "../Panel";
import { Notification } from "./Notification";

export interface AlertData {
    message: string;
    type: TMessageType;
    key: number;
    onClose: (value?: unknown) => void;
}

interface AlertItemProps {
    data: AlertData;
    top: number;
    right: number;
}

const AUTOCLOSE_SECONDS: Record<TMessageType, number> = {
    info:    5,
    warning: 5,
    success: 2,
    error:   0, // no auto-close for errors
};

export const AlertItem = forwardRef<HTMLDivElement, AlertItemProps>(
    function AlertItem({ data, top, right }, ref) {
        const { onClose } = data;
        const autoClose = AUTOCLOSE_SECONDS[data.type];

        useEffect(() => {
            if (!autoClose) return;
            let live = true;
            const timer = setTimeout(() => { if (live) onClose(); }, autoClose * 1000);
            return () => { live = false; clearTimeout(timer); };
        }, [autoClose, onClose]);

        return (
            <Panel
                ref={ref}
                position="absolute"
                top={top}
                right={right}
                zIndex={1000}
            >
                <Notification
                    type={data.type}
                    message={data.message}
                    onClick={() => onClose("clicked")}
                    onClose={() => onClose()}
                />
            </Panel>
        );
    },
);
```

Notes:

- `AlertData` interface is preserved (same shape as before — `message`, `type`, `key`, `onClose`).
- The forwarded ref points at `Panel`'s root `<div>`. Because `Panel` has no padding/border/margin, its `scrollHeight` equals the inner Notification's measured height — so AlertsBar's `model.updateHeight(a, ref.scrollHeight)` keeps producing correct stack offsets. **Verified during audit:** Panel's inline style here has no padding / border / margin set, so the wrapper div is laid out at `top: 0; left: 0` of the Notification's content rect.
- Body click → `onClose("clicked")`. X click → `onClose()`. Same Promise-resolve values as legacy.
- `clsx` and the `className` prop on `AlertItemProps` are removed — no consumer passes a className (verified via grep).
- The legacy `Button` import is removed (no other change needed in `components/basic/Button.tsx`; other consumers remain).

### Step 6 — Move `AlertsBar.tsx` into UIKit

Create `src/renderer/uikit/Notification/AlertsBar.tsx`. The body is a verbatim copy of the legacy `src/renderer/ui/dialogs/alerts/AlertsBar.tsx` with three small adjustments:

1. Import paths shift one level deeper:
   - `from '../../../core/state/model'` → `from '../../core/state/model'`
   - `from '../../../core/utils/types'` → `from '../../core/utils/types'`
   - `from '../../../core/state/state'` → `from '../../core/state/state'`
   - `from './AlertItem'` → unchanged (sibling import)
2. No code logic changes. The model class, `alertsBarModel` singleton, `AlertsBar` component, and helper functions all stay byte-identical.
3. The legacy file `src/renderer/ui/dialogs/alerts/AlertsBar.tsx` is deleted in Step 8.

The model is intentionally kept inside `AlertsBar.tsx` (not split into a separate `alertsBarModel.ts`) to minimize diff. Both consumers (`api/ui.ts`, `editors/graph/GraphViewModel.ts`) only need `alertsBarModel`, which is re-exported from `uikit/Notification/index.ts` and `uikit/index.ts`.

### Step 7 — Update consumer imports

Three files import directly from the legacy path. Update each:

#### [src/renderer/index.tsx](../../../src/renderer/index.tsx) — line 1

```diff
- import { AlertsBar } from "./ui/dialogs/alerts/AlertsBar";
+ import { AlertsBar } from "./uikit";
```

#### [src/renderer/api/ui.ts](../../../src/renderer/api/ui.ts) — line 11

```diff
- import { alertsBarModel } from "../ui/dialogs/alerts/AlertsBar";
+ import { alertsBarModel } from "../uikit";
```

#### [src/renderer/editors/graph/GraphViewModel.ts](../../../src/renderer/editors/graph/GraphViewModel.ts) — line 15

```diff
- import { alertsBarModel } from "../../ui/dialogs/alerts/AlertsBar";
+ import { alertsBarModel } from "../../uikit";
```

#### [src/renderer/ui/dialogs/index.ts](../../../src/renderer/ui/dialogs/index.ts) — lines 2–5

Remove the alerts re-exports entirely. After the edit, the file should read:

```ts
export { Dialogs, dialogsState, showDialog, closeDialog } from './Dialogs';

// Poppers
export { Poppers, showPopper, closePopper, visiblePoppers } from './poppers/Poppers';
export { showAppPopupMenu } from './poppers/showPopupMenu';
export { TPopperModel } from './poppers/types';
export type { IPopperViewData } from './poppers/types';
```

Verified via grep: nothing imports `AlertsBar`, `AlertItem`, or `AlertData` from `./ui/dialogs` (only directly from `./ui/dialogs/alerts/AlertsBar`). Removing the re-exports is safe.

### Step 8 — Delete legacy alerts folder

Delete:

- `src/renderer/ui/dialogs/alerts/AlertItem.tsx`
- `src/renderer/ui/dialogs/alerts/AlertsBar.tsx`
- The now-empty `src/renderer/ui/dialogs/alerts/` directory.

### Step 9 — Write `uikit/Notification/index.ts`

```ts
export { Notification } from "./Notification";
export type { NotificationProps, NotificationSeverity } from "./Notification";
export { AlertsBar, alertsBarModel } from "./AlertsBar";
export { AlertItem } from "./AlertItem";
export type { AlertData } from "./AlertItem";
```

### Step 10 — Run TypeScript check

`npx tsc --noEmit` — confirm no new errors. Expected touched files: the four new `uikit/Notification/*` files, `uikit/index.ts`, `storyRegistry.ts`, `index.tsx`, `api/ui.ts`, `editors/graph/GraphViewModel.ts`, `ui/dialogs/index.ts`.

### Step 11 — Manual smoke test (user)

User performs the smoke checks listed in Acceptance Criteria below.

### Step 12 — Update dashboard

When this task is completed, follow CLAUDE.md's epic-task model: keep US-476 unchecked in the dashboard until `/review` is requested for the epic.

## Concerns / Open questions

All resolved before implementation; record kept here for future readers.

### 1. Should severity styling live on `Panel` or in a new primitive? — RESOLVED: new primitive

Adding `severity` to `Panel` would couple a layout primitive to notification-specific styling and would not solve the icon + close-button composition problem. A focused `Notification` component owns severity coloring, the leading icon, and the close X together — and is reusable by future inline-notification surfaces (progress dialog errors, script result banners, etc.) without driving any of them today.

### 2. Slide-in via `right` keyframe vs `transform` — RESOLVED: `transform: translateX`

The legacy keyframe animates `right: -300 → finalRight`. That only works because the legacy root owned both the animation and the `right` positioning. After the migration, positioning sits on `Panel` (parent) and the animated body sits on `Notification` (child). Switching to `transform: translateX(300px) → translateX(0)` decouples animation from positioning — the same animation works regardless of the parent's `right` value. Visually identical to the user.

### 3. `transition: top 0.2s ease-in-out` for stack shuffle — RESOLVED: drop, accept drift

The legacy code smooths the case where an earlier alert closes and later ones slide up to take its place. Implementing this in UIKit would require a `transition` prop on `Panel`, which is too generic to add for one consumer. Drift accepted: alerts will snap (rather than slide) to their new top when the stack reshuffles. Cosmetic only; can be reinstated later via a focused mechanism if it proves visible.

### 4. Close-icon hover color override — RESOLVED: parent-selector inside Notification

UIKit `IconButton` has its own hover color (`color.icon.default`). Legacy AlertItem overrides this to `color.{severity}.textHover` per severity. Notification's styled root targets `[data-part="close"] [data-type="icon-button"]` under each `[data-severity="..."]` selector. This is a controlled cross-component override — keyed on Notification's own attribute, scoped to its own subtree.

### 5. `IconButton` click event bubbling — RESOLVED: stopPropagation in `handleClose`

Without `e.stopPropagation()`, clicking the close X would also fire the body `onClick` (because IconButton sits inside the Notification root). The handleClose handler stops propagation explicitly. Verified the click model matches legacy:
- Body click → `onClose("clicked")` (resolve value `"clicked"`).
- X-button click → `onClose()` (resolve value `undefined`).

### 6. Height measurement after the rewrite — RESOLVED: `Panel`'s scrollHeight equals Notification's height

AlertsBar measures each rendered alert via `ref.scrollHeight` to compute stack offsets. The forwarded ref now points at `Panel`'s outer `<div>`, which contains the Notification as its only child. Because the Panel here has no padding / border / margin (only positioning props, which are inline-styled but don't affect content rect), `Panel.scrollHeight === Notification.scrollHeight`. Verified by reading [Panel.tsx](../../../src/renderer/uikit/Panel/Panel.tsx): only `position`/`top`/`right`/`zIndex` are emitted to inline style for these props, which don't grow the content rect.

### 7. Public API surface — RESOLVED: unchanged

`alertsBarModel.addAlert(message, type)` keeps its exact signature, return type (`Promise<unknown>`), and resolve semantics. The 30+ callers across editors / models / scripting API need no changes. Verified by grep — every caller goes through this single entry point.

### 8. AlertItem still has its own `useEffect` for auto-close — RESOLVED: timing is per-alert behavior, not per-presentation

Auto-close timing (info/warning 5s, success 2s, error 0s) belongs in AlertItem because it depends on `data.type`, `data.onClose`, and the alert's lifecycle in the queue — not on how the visual body looks. Notification stays purely presentational; the timer stays in AlertItem. Symmetrical with: `Dialog` doesn't auto-close itself either; consumers wire that up.

### 9. Should AlertsBar move into UIKit? — RESOLVED: yes, into `uikit/Notification/`

All alerts code lives together in `uikit/Notification/`: the primitive (Notification), the host (AlertsBar), the positioning wrapper (AlertItem), and the model (alertsBarModel singleton inside AlertsBar.tsx). Reasoning: the alerts module is a small, tightly coupled unit; keeping presentational primitive separate from its host scattered the functionality across two folders. UIKit is the project's canonical home for reusable UI components, and AlertsBar is reusable in principle (its policies — max 3, evict-non-error, severity types, Promise-resolve close — are generic, not app-specific). Three external consumers (`index.tsx`, `api/ui.ts`, `editors/graph/GraphViewModel.ts`) get one-line import-path updates; the rest of the app reaches alerts via `app.ui.notify()` and is unaffected.

### 10. ARIA semantics — RESOLVED: `role="alert"` for error, `role="status"` for others

Severity-level priority for assistive tech. Errors use `role="alert"` + `aria-live="assertive"` (interrupt). Info / success / warning use `role="status"` + `aria-live="polite"` (queue at next pause). Matches WAI-ARIA notification patterns and is appropriate for the cases where this primitive is used.

## Acceptance criteria

1. `src/renderer/uikit/Notification/AlertItem.tsx` exists; contains zero `@emotion/styled` imports, zero `clsx` calls, zero `style={...}`, zero `className={...}`, zero imports from `components/basic/Button`.
2. `src/renderer/uikit/Notification/AlertsBar.tsx` exists; logic is byte-equivalent to the legacy file (only relative-import depths differ).
3. The legacy folder `src/renderer/ui/dialogs/alerts/` no longer exists.
4. `uikit/Notification/Notification.tsx` exists; exports `Notification`, `NotificationProps`, `NotificationSeverity`.
5. `uikit/Notification/index.ts` re-exports `Notification`, `AlertsBar`, `AlertItem`, `alertsBarModel`, `NotificationProps`, `NotificationSeverity`, `AlertData`.
6. `uikit/index.ts` exports `Notification`, `AlertsBar`, `AlertItem`, `alertsBarModel`, `AlertData`, `NotificationProps`, `NotificationSeverity` under the "Overlay" section.
7. `src/renderer/index.tsx`, `src/renderer/api/ui.ts`, and `src/renderer/editors/graph/GraphViewModel.ts` import from `./uikit` / `../uikit` / `../../uikit` respectively. No file in `/src` still references `ui/dialogs/alerts/`.
8. `src/renderer/ui/dialogs/index.ts` no longer re-exports `AlertsBar`, `AlertItem`, or `AlertData`.
9. `Notification.story.tsx` exists and is registered in `editors/storybook/storyRegistry.ts`.
10. Notification root has `data-type="notification"`, `data-severity` matching the prop, `role="alert"` for error and `role="status"` for info/success/warning, and `aria-live="assertive"` (error) or `aria-live="polite"` (other) — verifiable via DevTools.
11. `npx tsc --noEmit` reports no new errors.
12. **Smoke test — info alert**: trigger via `app.ui.notify("Hello", "info")` from a script. Toast appears top-right with the info message background, info icon, "Hello" message text. Auto-closes after 5 seconds.
13. **Smoke test — success alert**: `app.ui.notify("Saved", "success")`. Green-tinted toast, success icon. Auto-closes after 2 seconds.
14. **Smoke test — warning alert**: `app.ui.notify("Heads up", "warning")`. Yellow-tinted toast, warning icon. Auto-closes after 5 seconds.
15. **Smoke test — error alert**: `app.ui.notify("Failed", "error")`. Red-tinted toast, error icon. Does NOT auto-close. Stays until clicked.
16. **Smoke test — slide-in animation**: Each new alert slides in from the right over ~0.2s. No layout flicker on the alerts already in the stack.
17. **Smoke test — body click vs X click**:
    - Click the toast body → it dismisses; the awaiting Promise resolves with `"clicked"`.
    - Click the close X → it dismisses; the awaiting Promise resolves with `undefined`.
    - The X click does not also fire the body click (no double-resolve).
18. **Smoke test — close-X hover color**: Hover the close X on an error toast — icon color shifts from `color.error.text` to `color.error.textHover`. Same on success / warning. On info, the close X uses default IconButton hover (`color.icon.light → color.icon.default`).
19. **Smoke test — stack of 3**: Trigger 3 alerts in quick succession. All three render stacked top-to-bottom with 8px gaps. Trigger a 4th non-error alert — the oldest non-error is evicted (queue stays at 3). Trigger 4 errors — all 4 stack (errors are not evicted).
20. **Smoke test — long message wrapping**: trigger an alert with `"line one\nline two\nlong message that wraps eventually..."`. Newlines render as line breaks (white-space: pre-wrap inherited via Notification's Text); long content wraps within the toast width.
21. **Smoke test — DevTools**: each toast root in the DOM has `data-type="notification"` and a `data-severity` matching the alert type. The IconButton inside has `data-type="icon-button"` and `data-size="sm"`. The outer positioning wrapper has `data-type="panel"`.
22. **Smoke test — graph editor alert**: open a graph page and trigger one of `GraphViewModel`'s warning alerts (e.g., attempt a circular grouping). Confirm the alert renders correctly and the import path change in `GraphViewModel.ts` did not break the call site.
23. **Smoke test — themes**: cycle through `default-dark`, `light-modern`, `monokai`. Severity colors update with the theme; close-X hover color uses the active theme's `*-text-hover` token in each.

## Files Changed summary

| File | Action | Notes |
|------|--------|-------|
| [src/renderer/uikit/Notification/Notification.tsx](../../../src/renderer/uikit/Notification/Notification.tsx) | Create | New UIKit primitive — severity, icon, close X, slide-in animation, ARIA semantics |
| [src/renderer/uikit/Notification/AlertsBar.tsx](../../../src/renderer/uikit/Notification/AlertsBar.tsx) | Create | Moved verbatim from `ui/dialogs/alerts/AlertsBar.tsx`. Only adjustment: relative import depths (`../../../core/...` → `../../core/...`) |
| [src/renderer/uikit/Notification/AlertItem.tsx](../../../src/renderer/uikit/Notification/AlertItem.tsx) | Create | Rewrite of legacy AlertItem as pure UIKit composition: `<Panel position absolute>` + `<Notification>`. Auto-close timer preserved. |
| [src/renderer/uikit/Notification/Notification.story.tsx](../../../src/renderer/uikit/Notification/Notification.story.tsx) | Create | Storybook story with type / message / onClick / onClose controls |
| [src/renderer/uikit/Notification/index.ts](../../../src/renderer/uikit/Notification/index.ts) | Create | Barrel — re-exports primitive, host, item, model, types |
| [src/renderer/uikit/index.ts](../../../src/renderer/uikit/index.ts) | Modify | Export `Notification`, `AlertsBar`, `AlertItem`, `alertsBarModel`, `AlertData`, `NotificationProps`, `NotificationSeverity` under Overlay |
| [src/renderer/editors/storybook/storyRegistry.ts](../../../src/renderer/editors/storybook/storyRegistry.ts) | Modify | Register `notificationStory` |
| [src/renderer/index.tsx](../../../src/renderer/index.tsx) | Modify | Update `AlertsBar` import path to `./uikit` |
| [src/renderer/api/ui.ts](../../../src/renderer/api/ui.ts) | Modify | Update `alertsBarModel` import path to `../uikit` |
| [src/renderer/editors/graph/GraphViewModel.ts](../../../src/renderer/editors/graph/GraphViewModel.ts) | Modify | Update `alertsBarModel` import path to `../../uikit` |
| [src/renderer/ui/dialogs/index.ts](../../../src/renderer/ui/dialogs/index.ts) | Modify | Remove `AlertsBar` / `AlertItem` / `AlertData` re-exports (no consumer uses them via this barrel) |
| `src/renderer/ui/dialogs/alerts/AlertItem.tsx` | Delete | Replaced by `uikit/Notification/AlertItem.tsx` |
| `src/renderer/ui/dialogs/alerts/AlertsBar.tsx` | Delete | Replaced by `uikit/Notification/AlertsBar.tsx` |
| `src/renderer/ui/dialogs/alerts/` (folder) | Delete | Now empty after the two file deletions |
| [doc/active-work.md](../../active-work.md) | No change during planning | Dashboard entry already linked to this README |

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Related precedents: US-432 (Dialog primitive), US-462 (TorStatusOverlay), US-463 (BrowserDownloads)
