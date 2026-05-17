# US-531: `showPopupMenu` — UIKit Menu migration

## Status

**Implemented.** Awaiting manual smoke test. Part of
[EPIC-025](../../epics/EPIC-025.md) Phase 4 per-screen migration —
stays `[ ]` in the dashboard until EPIC-025 closes per the
deferred-review model.

## Goal

Migrate the app-level popup-menu API (`showAppPopupMenu` / `closeAppPopupMenu`)
off legacy `components/overlay/{Popper,PopupMenu}` to UIKit `Menu`. After this
task, no file in `src/renderer/ui/dialogs/poppers/` imports from
`components/overlay/`, and the only remaining UIKit gap (ref forwarding on
`Menu` so `overlayRegistry` can address the floated DOM) is closed by a
small additive change to UIKit Menu.

## Background

### Files being migrated

- `src/renderer/ui/dialogs/poppers/showPopupMenu.tsx` — renders
  `<PopupMenu>` inside `ReactDOM.createPortal(<div ref={overlayRef}>…)`
  with a virtual anchor at `(x, y)`. Adds default Copy / Paste / Inspect
  items based on the current selection / focused element / clipboard
  state. Exports `showAppPopupMenu`, `closeAppPopupMenu`, and
  `ShowAppPopupMenuOptions`.
- `src/renderer/ui/dialogs/poppers/types.ts` — declares `TPopperModel`
  with a `position: PopperPosition` field (currently sourced from
  `components/overlay/Popper`). The `position` field is dead code in
  the current tree (never read); only the import needs to swap.

### Caller-surface audit

All `showAppPopupMenu(…)` call sites grepped from the repo:

| Caller | Args passed | Uses `popperProps`? |
|---|---|---|
| `editors/browser/BrowserWebviewModel.ts:522` | `(menuX, menuY, items, { skipInspect: true })` | No |
| `editors/graph/GraphView.tsx:439` | `(rect.left, rect.bottom + 2, buildSelectionMenu(…))` | No |
| `editors/graph/GraphViewModel.ts:608` | `(clientX, clientY, items)` | No |
| `editors/link-editor/LinkEditor.tsx:218` | `(rect.left, rect.bottom + 2, items)` | No |
| `editors/rest-client/RestClientEditor.tsx:755` | `(e.clientX, e.clientY, items)` | No |
| `components/tree-provider/CategoryView.tsx:147` | `(rect.left, rect.bottom + 2, items)` | No |
| `components/data-grid/AVGrid/model/ContextMenuModel.tsx:31,149` | `(e.clientX, e.clientY, items[])` | No |
| `api/internal/GlobalEventService.ts:84` | `(e.clientX, e.clientY, event?.items || [])` | No |

`closeAppPopupMenu()` is only called from `editors/graph/ForceGraphRenderer.ts:346`.

**Result:** zero callers pass `popperProps`. The legacy
`PopperProps`-style fourth argument is unused. The migrated API can
drop it entirely.

### `MenuItem` shape parity

Both legacy `components/overlay/PopupMenu` and UIKit `uikit/Menu/types.ts`
re-export the **same** `MenuItem` interface from
`src/renderer/api/types/events.d.ts`:

```ts
// api/types/events.d.ts (single source of truth)
export interface MenuItem {
    label: string;
    onClick?: () => void;
    disabled?: boolean;
    icon?: any;
    invisible?: boolean;
    startGroup?: boolean;
    hotKey?: string;
    selected?: boolean;
    id?: string;
    items?: MenuItem[];   // ← sub-menu (called `items`, not `submenu`)
    minor?: boolean;
}
```

UIKit `Menu` supports every field (search-on-overflow > 20 items,
`startGroup` divider, `hotKey`, `selected` check, `items` sub-menu,
`minor` muted label, `invisible` filter). Verified in
`uikit/Menu/Menu.tsx` and `uikit/Menu/MenuModel.ts:prepared`. No
shape diff. No caller-side fix-up needed.

### `MenuItem` import-path caller flips — deferred

~10 caller files import `MenuItem` from `components/overlay/PopupMenu`.
Because the type is shape-identical and the legacy file is **not** being
deleted in US-531 (it still backs `WithPopupMenu` until rest-client
migrates), those caller flips are not strictly required for US-531 to
land. They become a precondition for [US-532](../US-532-legacy-components-removal/README.md)
deleting `components/overlay/`. **Decision: defer to US-532** — it's
a cheap repo-wide find/replace and centralising it there keeps US-531
diff small and reviewable.

### `PopperPosition` → `PopoverPosition` parity

UIKit `uikit/Popover/PopoverModel.ts:18` states the relationship
verbatim:

> `PopoverPosition` is shape-identical to legacy `PopperPosition` (minus
> `anchorType`).

| Field | Legacy `PopperPosition` | UIKit `PopoverPosition` |
|---|---|---|
| `elementRef` | ✓ | ✓ |
| `x` | ✓ | ✓ |
| `y` | ✓ | ✓ |
| `placement` | ✓ | ✓ |
| `offset` | `[skidding, distance]` | `[crossAxis, mainAxis]` (same shape) |
| `anchorType` | `"vertical" \| "horizontal"` | (gone — UIKit uses `placement` only) |

`showAppPopupMenu` never sets `anchorType` (default vertical) and never
sets `placement`. Default placement in both legacy (`bottom-start` for
vertical) and UIKit Popover (`bottom-start`) match.

### Offset middleware shape

- Legacy: `floatingOffset({ mainAxis: offset[1], crossAxis: offset[0] })` —
  `Popper.tsx:177`.
- UIKit: `floatingOffset({ mainAxis: offset[1], crossAxis: offset[0] })` —
  `PopoverModel.ts:171`.

Identical. Current `defaultOffset = [8, 0]` (skidding 8, distance 0)
transfers unchanged.

### `flip` middleware fallback placements

- Legacy: `flip({ fallbackPlacements: ["bottom-start", "bottom-end", "top-start", "top-end"] })`.
- UIKit: `flip()` — default fallback is opposite axis only
  (`top-start` when `bottom-start` doesn't fit).

For showAppPopupMenu (cursor-anchored), the difference is observable
only when the cursor is near a horizontal screen edge: legacy can shift
to `bottom-end` / `top-end`; UIKit only flips vertical axis. Practical
impact is minimal — the menu's max-width is 800px so this only triggers
on very narrow viewports or extreme corner clicks. **Accept as-is.** If
clipping is reported, address as a UIKit Popover enhancement (broader
fallback list) under a follow-up — not as a blocker for US-531.

### `overlayRegistry` integration — the one snag

Legacy code wraps the menu in `<div ref={overlayRef}>` and portals it
to `document.body`. The `<div>` contains all rendered menu DOM (because
legacy `Popper` renders inline, not via its own portal). The
`overlayRegistry.register(el)` call then makes
`overlayRegistry.isSuppressed(trigger)` return true for any trigger
outside that subtree, suppressing page-level Tooltips while the menu
is open.

UIKit `Popover` portals itself (`ReactDOM.createPortal(<Root>, document.body)`
in `uikit/Popover/Popover.tsx:142`). Wrapping `<Menu>` in a `<div>`
and registering that `<div>` would no longer work: the actual menu DOM
would be elsewhere (in body, via Popover's portal), so the wrapper
`<div>` no longer `contains()` it.

**Solution:** add `forwardRef<HTMLDivElement, MenuProps>` to UIKit
`Menu`, forwarding the ref through to its inner `Popover` (which
already supports `forwardRef`). The `showPopupMenu` wrapper then
obtains the Popover's floated root via a callback ref and registers
**that** with `overlayRegistry`. Cleanest, additive, non-breaking.

This is the only UIKit enhancement required by US-531.

### `closePopper(showAppPopupMenuId)` "close before open" pattern

Preserved verbatim — this lives in the `Poppers.tsx` dialog router
infrastructure and is independent of which primitive renders the menu.
Right-click inside `<webview>` (Browser editor) reaches
`showAppPopupMenu` via IPC, so DOM click-outside doesn't fire to close
the previous menu. The explicit `closePopper(showAppPopupMenuId)` at
the top of `showAppPopupMenu` handles this.

### Focus restoration

`previouslyFocused = document.activeElement` saved before
`showPopper`, restored after `await`. Preserved verbatim.

## Implementation plan

### Step 1 — UIKit enhancement: `forwardRef` on `Menu`

**File:** `src/renderer/uikit/Menu/Menu.tsx`

Convert `Menu` from a plain function component to a `React.forwardRef`,
forwarding the ref to the inner `Popover`. No prop-surface change; this
is purely additive.

**Before** (current):
```tsx
export function Menu(props: MenuProps) {
    const model = useComponentModel(props, MenuModel, defaultMenuState);
    // …
    return (
        <>
            <Popover {...rest} open={open} onClose={model.onPopoverClose} …>
                …
            </Popover>
            …
        </>
    );
}
```

**After:**
```tsx
export const Menu = React.forwardRef<HTMLDivElement, MenuProps>(function Menu(
    props,
    ref,
) {
    const model = useComponentModel(props, MenuModel, defaultMenuState);
    // …
    return (
        <>
            <Popover ref={ref} {...rest} open={open} onClose={model.onPopoverClose} …>
                …
            </Popover>
            …
        </>
    );
});
```

The fragment-wrapping submenu render at the bottom of the function stays unchanged.

**Verification:**
- `Menu.story.tsx` still compiles and renders both `SMALL_ITEMS` and `SUBMENU_ITEMS` (no behaviour change — story doesn't use `ref`).
- `WithMenu.tsx` still compiles (it doesn't pass `ref`).
- New ref forwarding lands on the same DOM element as `Popover`'s root
  (the floated `data-type="popover"` div).

### Step 2 — Migrate `showPopupMenu.tsx`

**File:** `src/renderer/ui/dialogs/poppers/showPopupMenu.tsx`

Replace legacy imports, simplify the render to a single `<Menu>` (no
outer wrapper portal), wire the ref-callback to `overlayRegistry`,
and drop the unused `popperProps` plumbing.

**Imports to remove:**
- `import { MenuItem, PopupMenu } from "../../../components/overlay/PopupMenu";`
- `import { PopperProps } from "../../../components/overlay/Popper";`
- `import ReactDOM from "react-dom";`
- `import { useEffect } from "react";` (replaced)

**Imports to add:**
- `import { Menu } from "../../../uikit/Menu";`
- `import type { MenuItem } from "../../../uikit/Menu";`

**Imports to keep:**
- `useMemo`, `useRef`, `useCallback` from `react`
- `TPopperModel` from `./types`
- `closePopper`, `showPopper` from `./Poppers`
- `VirtualElement` from `@floating-ui/react`
- `CopyIcon`, `CursorIcon`, `EmptyIcon` from `../../../theme/icons`
- `DefaultView`, `ViewPropsRO`, `Views` from `../../../core/state/view`
- `TComponentState` from `../../../core/state/state`
- `overlayRegistry` from `../../../uikit/shared/overlayRegistry`
- `api` from `../../../../ipc/renderer/api`

**State shape — drop `poperProps` field:**

Before:
```ts
const defaultAppPopupMenuState = {
    x: 0,
    y: 0,
    items: [] as MenuItem[],
    poperProps: undefined as PopperProps | undefined,
    skipInspect: false,
};
```

After:
```ts
const defaultAppPopupMenuState = {
    x: 0,
    y: 0,
    items: [] as MenuItem[],
    skipInspect: false,
};
```

**`addDefaultMenus` body:** unchanged. It manipulates `s.items` only.

**`AppPopupMenu` render function — full rewrite:**

```tsx
function AppPopupMenu({ model }: ViewPropsRO<AppPopupMenuModel>) {
    const { items, x, y } = model.state.use();
    const registeredRef = useRef<HTMLDivElement | null>(null);

    // Callback ref: register the Popover's floated root with overlayRegistry
    // so page-level Tooltips are suppressed while the menu is open.
    // Tooltips inside this subtree (e.g. on menu items themselves) remain
    // allowed via overlayRegistry.isSuppressed's `contains()` check.
    const setMenuRef = useCallback((el: HTMLDivElement | null) => {
        if (registeredRef.current) {
            overlayRegistry.unregister(registeredRef.current);
        }
        registeredRef.current = el;
        if (el) overlayRegistry.register(el);
    }, []);

    const elementRef = useMemo<VirtualElement>(() => ({
        getBoundingClientRect() {
            return {
                x, y, top: y, left: x, bottom: y, right: x, width: 0, height: 0,
            };
        },
    }), [x, y]);

    return (
        <Menu
            ref={setMenuRef}
            name="app-popup-menu"
            open
            items={items}
            elementRef={elementRef}
            offset={defaultOffset}
            onClose={() => model.close()}
        />
    );
}
```

**Public API — simplify `ShowAppPopupMenuOptions`:**

Before:
```ts
export interface ShowAppPopupMenuOptions {
    popperProps?: PopperProps;
    skipInspect?: boolean;
}

export const showAppPopupMenu = async (
    x: number, y: number, items: MenuItem[],
    options?: ShowAppPopupMenuOptions | PopperProps,
) => {
    closePopper(showAppPopupMenuId);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const opts: ShowAppPopupMenuOptions =
        options && "skipInspect" in options
            ? options
            : { popperProps: options as PopperProps | undefined };
    const state = new TComponentState(defaultAppPopupMenuState);
    state.update((s) => {
        s.x = x; s.y = y; s.items = [...items];
        s.poperProps = opts.popperProps;
        s.skipInspect = opts.skipInspect || false;
    });
    // …
};
```

After:
```ts
export interface ShowAppPopupMenuOptions {
    /** Skip the default "Inspect" menu item (e.g. when the caller provides its own). */
    skipInspect?: boolean;
}

export const showAppPopupMenu = async (
    x: number, y: number, items: MenuItem[],
    options?: ShowAppPopupMenuOptions,
) => {
    closePopper(showAppPopupMenuId);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const state = new TComponentState(defaultAppPopupMenuState);
    state.update((s) => {
        s.x = x; s.y = y; s.items = [...items];
        s.skipInspect = options?.skipInspect || false;
    });
    const model = new AppPopupMenuModel(state);
    await model.addDefaultMenus();
    if (!model.state.get().items.length) return;
    await showPopper<void>({ viewId: showAppPopupMenuId, model });
    previouslyFocused?.focus();
};
```

`closeAppPopupMenu` is unchanged.

### Step 3 — Migrate `types.ts`

**File:** `src/renderer/ui/dialogs/poppers/types.ts`

Swap the one legacy import. The `position` field is unused in the
current tree but typed for completeness — keep it, just change the
type source.

**Before:**
```ts
import { PopperPosition } from "../../../components/overlay/Popper";

export class TPopperModel<T = any, R = any> extends TDialogModel<T, R> {
    position: PopperPosition = {};
}
```

**After:**
```ts
import { PopoverPosition } from "../../../uikit/Popover/Popover";

export class TPopperModel<T = any, R = any> extends TDialogModel<T, R> {
    position: PopoverPosition = {};
}
```

Note: `TPopperModel` still backs `CsvOptionsModel`, `ColumnsOptionsModel`,
`SubMenuModel` (in legacy `PopupMenu.tsx`), `BrowserDownloadsPopup`,
and the migrated `AppPopupMenuModel`. None read `position`. Safe swap.

### Step 4 — Verification sweep

After the three file changes:

1. `npm run lint` — clean.
2. `npx tsc --noEmit` — no new errors (compare against the pre-existing
   baseline noted in US-530).
3. Grep:
   - `from "[^"]*components/overlay/(Popper|PopupMenu)"` inside
     `src/renderer/ui/dialogs/poppers/` — must return zero matches.
   - Legacy folder import count outside `ui/dialogs/poppers/` is
     unchanged (caller flips deferred to US-532).
4. Manual smoke — see "Test surface" below.

## Concerns / Open questions

### A. UIKit Menu `forwardRef` — confirm this is the preferred enhancement

The alternatives were:
- Auto-register every Popover with `overlayRegistry` (changes behaviour
  for Select / WithMenu / autocomplete dropdowns — too broad for a
  migration task).
- Add a callback prop like `onFloatingMount` to Menu (single-purpose,
  uglier).
- `document.querySelector('[data-type="popover"][data-name="…"]')`
  fallback (fragile).

**Recommendation:** `forwardRef`. Smallest UIKit surface change, generic
capability (other future use cases for "give me the floated DOM" are
plausible), no behaviour change for existing callers.

### B. Drop `popperProps` from `ShowAppPopupMenuOptions` — confirm

No caller in the repo passes it. Keeping it would force the migrated
file to import `PopoverProps` for type-aliasing and to pass through a
property no one uses. Dropping it shrinks the public API.

**Recommendation:** drop. Re-add as `popoverProps` (typed as
`Partial<PopoverProps>`) only if a future caller needs it.

### C. Defer `MenuItem` caller-import flips to US-532 — confirm

The ~10 callers can stay on
`import { MenuItem } from "components/overlay/PopupMenu"` for the
duration of US-531 because the type is identical. Flipping them is a
prerequisite for US-532 deleting the folder, which is the natural
home for a repo-wide find/replace sweep.

**Recommendation:** defer. Keep US-531 diff focused on the two files
that actually change behaviour.

### D. UIKit Popover `flip` fallback narrower than legacy — accept

Legacy uses 4 vertical fallbacks; UIKit Popover uses 1 (opposite
axis). Practical impact is limited to cursor near horizontal screen
edge in narrow viewports.

**Recommendation:** accept. Surface as a separate Popover enhancement
if reported.

### E. Swap `TPopperModel.position` type to `PopoverPosition` — confirm

The field is dead code (never read). Swapping the type still preserves
the declaration for any future caller that wants to read or set
`model.position`.

**Recommendation:** swap. Keeps `types.ts` clean of legacy imports.

## Test surface (manual smoke)

After implementation:

- Right-click in a Text page: default menu (Copy / Paste / Inspect)
  appears based on selection / focus / clipboard.
- Right-click in an editable area (Input / Textarea / contentEditable):
  Paste appears; click inserts at cursor; `input` event fires.
- Right-click with text selected anywhere: Copy appears with separator
  above Inspect.
- Right-click on a graph node / log row / browser tab / link-editor
  item: caller-supplied items render alongside defaults.
- Right-click inside a `<webview>` (Browser editor) on a normal page:
  menu appears at click coordinate.
- Right-click twice quickly in a `<webview>`: old menu closes
  immediately, new menu appears at second click coordinate
  (`closePopper(showAppPopupMenuId)` path).
- Multi-screen: menu appears at correct coordinates on a non-primary
  monitor.
- **Tooltip suppression:** while menu is open, hover a page tooltip
  trigger (e.g. a toolbar button); the tooltip MUST NOT appear. Hover
  a menu item (some items have hint titles); their tooltip MUST
  appear. This validates the `overlayRegistry` callback-ref hook-up.
- Focus restoration: previously-focused element regains focus after
  menu closes.
- Submenu (Browser context menu → Open in profile X): submenu opens
  on hover (400 ms), selecting an item closes both menus.

## Acceptance criteria

- [ ] `src/renderer/ui/dialogs/poppers/showPopupMenu.tsx` has zero
      imports from `components/overlay/`.
- [ ] `src/renderer/ui/dialogs/poppers/types.ts` has zero imports
      from `components/overlay/`.
- [ ] `MenuItem` and the `showAppPopupMenu` / `closeAppPopupMenu`
      public API names are preserved.
- [ ] `ShowAppPopupMenuOptions` no longer exposes `popperProps`.
- [ ] UIKit `Menu` is a `React.forwardRef` and the forwarded ref
      lands on its `Popover` floated root.
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no new errors.
- [ ] Manual smoke test (see above) passes for at least: text page,
      editable input, graph node, browser webview, browser URL bar,
      tooltip-suppression while menu open.

This task does NOT run `/review`, `/document`, or `/userdoc` — those
run at EPIC-025 close per the epic's deferred-review model.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/uikit/Menu/Menu.tsx` | Convert `Menu` to `React.forwardRef<HTMLDivElement, MenuProps>`; forward ref to inner `Popover`. |
| `src/renderer/ui/dialogs/poppers/showPopupMenu.tsx` | Replace `PopupMenu` with UIKit `Menu`; drop outer portal wrapper; wire `overlayRegistry` via callback ref; drop unused `popperProps` plumbing. |
| `src/renderer/ui/dialogs/poppers/types.ts` | Swap `PopperPosition` import for UIKit `PopoverPosition`. |

## Files NOT changed

- `src/renderer/components/overlay/PopupMenu.tsx` — still used by
  `WithPopupMenu` (rest-client). Deletion is US-532.
- `src/renderer/components/overlay/Popper.tsx` — still used by
  `CsvOptions`, `ColumnsOptions`, `WithPopupMenu`. Deletion is US-532.
- `src/renderer/components/overlay/WithPopupMenu.tsx` — three
  rest-client callers (`RestClientEditor.tsx`, `RequestBuilder.tsx`,
  `ResponseViewer.tsx`). Rest-client per-screen migration is its own
  task (or absorbed into US-532's prep).
- `src/renderer/ui/dialogs/poppers/Poppers.tsx` — dialog router
  infrastructure; not coupled to the menu primitive.
- All ~10 `MenuItem` caller files (`BrowserWebviewModel.ts`,
  `BrowserUrlBarModel.ts`, `link-open-menu.tsx`,
  `RestClientEditor.tsx`, `RequestBuilder.tsx`, `ResponseViewer.tsx`,
  `GraphView.tsx`, `GraphViewModel.ts`, `ForceGraphRenderer.ts`,
  `LinkEditor.tsx`, `CategoryView.tsx`, `ContextMenuModel.tsx`,
  `GlobalEventService.ts`, `ui/dialogs/index.ts`) — `MenuItem` import
  flips deferred to US-532.
- `src/renderer/uikit/Menu/MenuModel.ts`, `WithMenu.tsx`,
  `types.ts`, `index.ts`, `Menu.story.tsx` — no Menu surface change
  beyond the `forwardRef` conversion in `Menu.tsx`.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration (overlay infrastructure)
- Depends on: [US-481](../US-481-uikit-menu-with-menu/README.md) (UIKit Menu + WithMenu)
- Depends on: [US-466](../US-466-uikit-popover/README.md) (UIKit Popover)
- Unblocks: [US-532](../US-532-legacy-components-removal/README.md) (legacy folder deletion)
