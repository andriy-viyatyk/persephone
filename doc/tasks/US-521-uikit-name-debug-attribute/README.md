# US-521: UIKit `name` debug attribute for all primitives

## Status

**Implemented — awaiting epic-close review.** Part of [EPIC-025](../../epics/EPIC-025.md) Phase 4 — UIKit primitive infrastructure.

Primitive-only task. Per-screen adoption happens opportunistically during in-flight migrations (US-515 onward) — no migration retrofits in this scope.

## Goal

Add an optional `name?: string` prop to every UIKit primitive. The component emits the value as `data-name="…"` on the same DOM element that already carries its `data-type`. This gives developers a single, consistent way to label any UIKit element so that DOM inspector output can be mapped back to the source line that rendered it.

```tsx
// Source
<Panel name="url-bar-wrapper" flex={1} data-url-bar="">…</Panel>
<IconButton name="page-menu" size="sm" icon={<MoreVertIcon />} title="Page Menu" onClick={…} />

// Inspector
<div data-type="panel" data-name="url-bar-wrapper" data-url-bar="">…</div>
<button data-type="icon-button" data-name="page-name" data-size="sm">…</button>
```

`name` is always optional. Skipped where the parent + `data-type` are enough to identify the element. Recommended on any primitive that appears multiple times in a tree (Panel, IconButton, Splitter, Divider, etc.).

## Background

Across the EPIC-025 migrations, the most common ergonomic complaint is that DOM inspector output is hard to map back to JSX: dozens of `<div data-type="panel">` look identical, and `<button data-type="icon-button">` with `<svg>` inside doesn't reveal what action the icon represents. `data-type` answers "what kind of primitive" — it does not answer "which one".

UIKit components already pass through arbitrary `data-*` attributes via the `HTMLAttributes` spread, so `<Panel data-name="foo">` works today at the type level. But it's not discoverable, not consistent, and there's no documented convention. A typed `name` prop fixes all three: IntelliSense surfaces it, every primitive supports it, and `uikit/CLAUDE.md` mandates it for new components.

## Scope

Every UIKit primitive in `src/renderer/uikit/`. Includes leaf primitives (Panel, Button, IconButton, Input, …) and composite primitives that wrap other primitives (AlertItem, AlertsBar, WithMenu).

### Files NOT changed

- `src/renderer/uikit/tokens.ts` — no component to extend.
- `src/renderer/uikit/index.ts` — exports unchanged.
- `src/renderer/uikit/shared/highlight.tsx` (and any similar helpers) — utility contexts, not user-facing primitives.
- Story files (`*.story.tsx`) — story-driven prop editors will discover `name` automatically via the prop type; no story edit required.
- All non-UIKit application code — adoption happens opportunistically during per-screen migrations, not in this task.

## Implementation pattern

For each primitive's root element, add `name` to props and emit `data-name`:

```tsx
export interface FooProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className"> {
    /** Optional debug label emitted as `data-name` on the root element. Use to disambiguate
     *  multiple instances of this primitive in DOM inspector output. */
    name?: string;
    // … existing props
}

export function Foo({ name, ...rest }: FooProps) {
    return (
        <Root
            data-type="foo"
            data-name={name}     // undefined → React drops the attribute
            {...rest}
        >
            …
        </Root>
    );
}
```

**Rules:**
- `data-name` goes on the **same element** as `data-type`. One element per primitive.
- Pass `undefined` (not `""` and not `null`) when `name` is unset — React then omits the attribute entirely, keeping inspector output clean.
- Destructure `name` before the spread so the rest-spread doesn't double-emit.
- The prop is **always optional**. No call-site is required to pass it.

For composite primitives that wrap another UIKit primitive (no own `data-type`), forward `name`:

```tsx
// AlertItem composes Notification — forward name into it
export function AlertItem({ name, data, top, right }: AlertItemProps) {
    return <Notification name={name} {...notificationProps} />;
}
```

For render-prop wrappers (WithMenu) — `name` forwards to the inner Menu's `data-name`.

## Implementation plan

### Phase 1 — Leaf primitives with own `data-type`

Add `name?: string` prop + `data-name={name}` emission. One pass per file, ~3 lines per file.

| File | Root element receiving `data-name` |
|---|---|
| `Panel/Panel.tsx` | `<Root data-type="panel">` (line ~330) |
| `Button/Button.tsx` | `<Root data-type="button">` (line ~162) |
| `IconButton/IconButton.tsx` | `<Root data-type="icon-button">` (line ~142) |
| `Input/Input.tsx` | `<Wrapper data-type="input">` (line ~161) |
| `Textarea/Textarea.tsx` | `<Wrapper data-type="textarea">` (line ~208) |
| `Spacer/Spacer.tsx` | `<Root data-type="spacer">` (line ~16/23 — two render paths) |
| `Divider/Divider.tsx` | `<Root data-type="divider">` (line ~37) |
| `Checkbox/Checkbox.tsx` | `<Root data-type="checkbox">` (line ~65) |
| `Label/Label.tsx` | `<Root data-type="label">` (line ~49) |
| `Spinner/Spinner.tsx` | `<Root data-type="spinner">` (line ~46) |
| `Dot/Dot.tsx` | `<Root data-type="dot">` (line ~125) |
| `Text/Text.tsx` | `<Root data-type="text">` (line ~127) |
| `Slider/Slider.tsx` | `<Root data-type="slider">` (line ~129) |
| `Splitter/Splitter.tsx` | `<Root data-type="splitter">` (line ~150) |
| `Tag/Tag.tsx` | `<Root data-type="tag">` (line ~148) |
| `TagsInput/TagsInput.tsx` | `<Wrapper data-type="tags-input">` (line ~98) |
| `Tooltip/Tooltip.tsx` | `<Floating data-type="tooltip">` (line ~171) |
| `Popover/Popover.tsx` | `<Floating data-type="popover">` (line ~144) — resize-handle is a separate inner element, leave alone |
| `Dialog/Dialog.tsx` | `<Backdrop data-type="dialog">` (line ~171) |
| `Dialog/DialogContent.tsx` | `<Root data-type="dialog-content">` (line ~98) |
| `Notification/Notification.tsx` | `<Root data-type="notification">` (line ~123) |
| `Progress/ProgressOverlay.tsx` | `<Root data-type="progress-overlay">` (lines ~63 and ~84 — two render paths) |
| `Toolbar/Toolbar.tsx` | inner `<Panel data-type="toolbar">` — pass `name` to Panel (Toolbar is `styled(Panel)`) |
| `SegmentedControl/SegmentedControl.tsx` | `<Root data-type="segmented-control">` if present, otherwise the wrapping element |
| `Menu/Menu.tsx` | `<Popover … data-type="menu">` (line ~175) — forward `name` to Popover |
| `Select/Select.tsx` | `<Root data-type="select">` (line ~104) |
| `PathInput/PathInput.tsx` | `<Wrapper data-type="path-input">` (line ~102) |
| `Breadcrumb/Breadcrumb.tsx` | `<Root data-type="breadcrumb">` (line ~91) |
| `CollapsiblePanelStack/CollapsiblePanelStack.tsx` | `<StackRoot data-type="collapsible-panel-stack">` (line ~171) — and consider `name` per collapsible-panel child too |
| `RadioGroup/RadioGroup.tsx` | `<Root data-type="radio-group">` (line ~210) |
| `ListBox/ListBox.tsx` | `<Root data-type="list-box">` (one of lines 155/171/189 depending on variant; emit on all paths) |
| `Tree/Tree.tsx` | `<Root data-type="tree">` (lines 245/261/279 — emit on all paths) |

### Phase 2 — Sub-item primitives

These render as children of a parent primitive (Tree row, ListBox row, etc.). `name` is useful when one specific row matters; usually skipped.

| File | Root element |
|---|---|
| `ListBox/ListItem.tsx` | `<Root data-type="list-item">` (line ~128) |
| `ListBox/SectionItem.tsx` | `<Root data-type="list-section">` (line ~47) |
| `Tree/TreeItem.tsx` | `<Root data-type="tree-item">` (line ~202) |
| `Tree/SectionItem.tsx` | `<Root data-type="tree-section">` (line ~63) |
| `Menu/Menu.tsx` (`MenuRow`) | `<RowRoot data-type="menu-row">` (line ~195) — name typically supplied via MenuItem; skip if name comes from MenuItem.label already |
| `RadioGroup/RadioGroup.tsx` (per-radio) | `<Item data-type="radio">` (line ~233) — usually skipped; each radio is identified by its label |
| `Popover/Popover.tsx` resize handle | `data-type="popover-resize-handle"` — internal, skip |
| `CollapsiblePanelStack/CollapsiblePanelStack.tsx` per-panel | `data-type="collapsible-panel"` — accept `name` on individual panel descriptors if the descriptor API allows |

### Phase 3 — Composite primitives (no own `data-type`)

Forward `name` to the underlying UIKit primitive.

| File | Forwarding target |
|---|---|
| `Notification/AlertItem.tsx` | forward `name` → `<Notification name={name}>` |
| `Notification/AlertsBar.tsx` | forward `name` → its wrapping `<Panel name={name}>` (or accept it on the outer if it has its own root) |
| `Menu/WithMenu.tsx` | render-prop wrapper — accept `name` and forward → `<Menu name={name}>` |

### Phase 4 — Documentation

Update `src/renderer/uikit/CLAUDE.md`:

1. **Extend Rule 1** ("Data attributes for state") with a new sub-section:

    ```markdown
    ### Debug naming via `data-name`

    Every primitive accepts an optional `name?: string` prop. When set, the value is
    emitted as `data-name="…"` on the same element that carries `data-type`. This is a
    debug-inspection aid — it never affects styling, state, or behavior.

    ```tsx
    <Panel name="url-bar-wrapper" flex={1}>…</Panel>
    // → <div data-type="panel" data-name="url-bar-wrapper">
    ```

    **When to set `name`** (in call sites):
    - Multiple instances of the same primitive in one tree (especially `Panel`,
      `IconButton`, `Splitter`, `Divider`).
    - Any `IconButton` — the `<svg>` child doesn't reveal the action.
    - Any element that participates in cross-component selectors (`closest`,
      `querySelector`) — name doubles as a stable hook.

    **When to skip:** purely structural one-off Panels where the surrounding
    `data-type` chain already identifies the element.

    **Authoring requirement:** every new UIKit primitive MUST accept `name?: string`
    and emit `data-name={name}` on the same element as its `data-type`. Pass
    `undefined` (not `""`) when unset — React then omits the attribute.
    ```

2. **Add `name` to the standard state-attributes table** in Rule 1:

    | Attribute | Values | When to use |
    |-----------|--------|-------------|
    | `data-name` | free-form string | optional debug label set by the caller (`name` prop). Never used for styling. |

3. **Update the "Component file template"** in CLAUDE.md (~line 470) to include `name`:

    ```tsx
    export interface ButtonProps {
        name?: string;          // ← new
        label: string;
        onClick: () => void;
        // …
    }

    export function Button({ name, label, onClick, /* … */ }: ButtonProps) {
        return (
            <Root
                data-type="button"
                data-name={name}     // ← new
                /* … */
            >
                {label}
            </Root>
        );
    }
    ```

4. **Update Naming conventions table** with `name` row:

    | Concept | Use | Avoid |
    |---|---|---|
    | Debug identifier | `name` | `id`, `label`, `debugId` |

## Concerns

### C1 — Naming: `name` vs `id` vs `debugId` `[recommendation: name]`

`id` collides with HTML `id` semantics and is already in `HTMLAttributes`. `debugId` is honest but verbose for every call site. **`name`** matches the existing prop convention (short, predictable), is debug-by-intent (not a global DOM id), and emits as `data-name` so it never conflicts with HTML form `name`.

### C2 — Type-only vs runtime check `[recommendation: typed prop, no runtime check]`

Defining `name?: string` on every primitive surfaces it in IntelliSense and documents intent. We do **not** add runtime validation, dev-only warnings, or required-name enforcement — too noisy, too invasive for a debug aid.

### C3 — Composite primitives without own root `[recommendation: forward to inner]`

`AlertItem`, `AlertsBar`, `WithMenu` compose other primitives. They accept `name` and forward to the underlying primitive's `name`. If a composite needs its own debug name distinct from its inner, it should grow its own root with `data-type` first (out of scope here).

### C4 — Sub-items (ListItem, TreeItem, MenuRow, Radio) `[recommendation: accept name, usage rare]`

Most rows are identified by their label/value. `name` is still typed and emitted — useful when one specific row needs to be located in inspector (e.g. a specific menu separator). No call-site is required to set it.

### C5 — Existing `data-*` pass-through `[recommendation: keep working]`

`<Panel data-name="x">` (raw pass-through) already works via `HTMLAttributes`. After adding `name`, both `<Panel name="x">` and `<Panel data-name="x">` produce the same DOM. The typed prop is the **recommended** form; the raw pass-through stays as a backstop and doesn't need migration.

### C6 — Adoption is opportunistic, not bulk `[recommendation: no app-side changes in this task]`

US-521 only ships the UIKit prop + docs. Existing call sites don't get retrofitted; per-screen migrations (US-515 onward) add `name="…"` where it helps. No "name every Panel in the codebase" sweep — that would be massive churn for no immediate value.

### C7 — Story files `[recommendation: zero changes]`

UIKit story files generate property editors from prop types. Adding `name?: string` to each prop interface makes it appear in the story's prop editor automatically — no story file edits required.

### C8 — Bundle size `[recommendation: negligible]`

Per primitive: one prop in the destructure, one `data-name={name}` JSX attribute. Across ~30 primitives that's ~60 trivial lines. Zero runtime overhead when `name` is undefined (React drops the attribute).

## Acceptance criteria

- [ ] Every UIKit primitive in `src/renderer/uikit/` accepts `name?: string`.
- [ ] Every UIKit primitive emits `data-name={name}` on the **same** element that carries `data-type`.
- [ ] Composite primitives (AlertItem, AlertsBar, WithMenu) forward `name` to their underlying primitive.
- [ ] `src/renderer/uikit/CLAUDE.md` Rule 1 documents `name` / `data-name`.
- [ ] `src/renderer/uikit/CLAUDE.md` component file template includes `name` in the example.
- [ ] `src/renderer/uikit/CLAUDE.md` Naming-conventions table includes `name` row.
- [ ] No existing call site needs to change to compile (`name` is optional everywhere).
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no new errors.
- [ ] Manual smoke: pick one screen, add `name="foo"` to a Panel, confirm `<div data-type="panel" data-name="foo">` in DevTools.

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at EPIC-025 close per the epic's deferred review model.

## Test surface (manual smoke)

- Open the Storybook editor → Panel story → set `name` in the prop editor → inspector shows `data-name="…"`.
- Same for IconButton, Input, and one composite (e.g. AlertItem).
- Remove `name` (clear the field) → inspector loses the `data-name` attribute (not `data-name=""`).
- A screen that has not been migrated to use `name` yet renders identically — zero visual regression.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/uikit/Panel/Panel.tsx` | + `name?: string` prop, emit `data-name` |
| `src/renderer/uikit/Button/Button.tsx` | same |
| `src/renderer/uikit/IconButton/IconButton.tsx` | same |
| `src/renderer/uikit/Input/Input.tsx` | same |
| `src/renderer/uikit/Textarea/Textarea.tsx` | same |
| `src/renderer/uikit/Spacer/Spacer.tsx` | same (both render paths) |
| `src/renderer/uikit/Divider/Divider.tsx` | same |
| `src/renderer/uikit/Checkbox/Checkbox.tsx` | same |
| `src/renderer/uikit/Label/Label.tsx` | same |
| `src/renderer/uikit/Spinner/Spinner.tsx` | same |
| `src/renderer/uikit/Dot/Dot.tsx` | same |
| `src/renderer/uikit/Text/Text.tsx` | same |
| `src/renderer/uikit/Slider/Slider.tsx` | same |
| `src/renderer/uikit/Splitter/Splitter.tsx` | same |
| `src/renderer/uikit/Tag/Tag.tsx` | same |
| `src/renderer/uikit/TagsInput/TagsInput.tsx` | same |
| `src/renderer/uikit/Tooltip/Tooltip.tsx` | same |
| `src/renderer/uikit/Popover/Popover.tsx` | same (on main popover root only) |
| `src/renderer/uikit/Dialog/Dialog.tsx` | same |
| `src/renderer/uikit/Dialog/DialogContent.tsx` | same |
| `src/renderer/uikit/Notification/Notification.tsx` | same |
| `src/renderer/uikit/Notification/AlertItem.tsx` | forward `name` → Notification |
| `src/renderer/uikit/Notification/AlertsBar.tsx` | forward `name` → wrapping Panel |
| `src/renderer/uikit/Progress/ProgressOverlay.tsx` | same (both render paths) |
| `src/renderer/uikit/Toolbar/Toolbar.tsx` | forward `name` → Panel |
| `src/renderer/uikit/SegmentedControl/SegmentedControl.tsx` | same |
| `src/renderer/uikit/Menu/Menu.tsx` | forward `name` → Popover (root); MenuRow optional |
| `src/renderer/uikit/Menu/WithMenu.tsx` | forward `name` → inner Menu |
| `src/renderer/uikit/Select/Select.tsx` | same |
| `src/renderer/uikit/PathInput/PathInput.tsx` | same |
| `src/renderer/uikit/Breadcrumb/Breadcrumb.tsx` | same |
| `src/renderer/uikit/CollapsiblePanelStack/CollapsiblePanelStack.tsx` | same on stack root; consider per-panel |
| `src/renderer/uikit/RadioGroup/RadioGroup.tsx` | same on group; per-radio optional |
| `src/renderer/uikit/ListBox/ListBox.tsx` | same on all render paths |
| `src/renderer/uikit/ListBox/ListItem.tsx` | same |
| `src/renderer/uikit/ListBox/SectionItem.tsx` | same |
| `src/renderer/uikit/Tree/Tree.tsx` | same on all render paths |
| `src/renderer/uikit/Tree/TreeItem.tsx` | same |
| `src/renderer/uikit/Tree/SectionItem.tsx` | same |
| `src/renderer/uikit/CLAUDE.md` | extend Rule 1 with `name`/`data-name` section + state-attribute table row + naming-conventions table row + update component file template |

## Dependencies

None — purely additive to UIKit primitives. No app code changes; no other UIKit primitive depends on this.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — UIKit primitive infrastructure
- Motivating screen: US-515 will be the first migration to adopt `name` on its Panels / IconButtons opportunistically
- Related primitive-only precursors (same pattern — ship primitive alone, retrofits live in migrations):
  [US-503 Dot](../US-503-uikit-dot/README.md), [US-504 ghost variants](../US-504-uikit-ghost-and-hover-reveal/README.md), [US-516 Breadcrumb](../US-516-uikit-breadcrumb/README.md), [US-517 CollapsiblePanelStack](../US-517-uikit-collapsible-panel-stack/README.md), [US-519 Graph precursors](../US-519-uikit-graph-editor-precursors/README.md), [US-520 Video precursors](../US-520-uikit-video-editor-precursors/README.md)
