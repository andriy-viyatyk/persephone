# US-469: UIKit RadioGroup — selection primitive

**Epic:** [EPIC-025 — Unified Component Library and Storybook Editor](../../epics/EPIC-025.md)
**Phase:** 4 (form infrastructure — blocks US-432 Phase 2)
**Status:** Planned

## Goal

Add a UIKit `RadioGroup` primitive that renders a single-select group of radio options with proper ARIA semantics (`role="radiogroup"` + `role="radio"`) and roving-tabindex keyboard navigation. The component is the natural counterpart to `SegmentedControl` for cases where the visual affordance must read as a list of radio options rather than a joined toggle bar.

This task is implementation-only. Existing radio-style call-sites (`InputDialog`, `CsvOptions`, `RadioboxesDialogView`) migrate during their owning screen's Phase 4 task — not here. US-432 (Dialog migration) is the first consumer and its Phase 2 starts only after US-469 lands.

## Background

### Why a separate primitive (and not `SegmentedControl`)

`SegmentedControl` (`src/renderer/uikit/SegmentedControl/`) renders joined buttons — `variant="primary"` for the selected segment, `variant="link"` for the rest, with `marginLeft: -1` to overlap borders into a single connected pill bar. ARIA-wise it already declares `role="radiogroup"` + `role="radio"`, but visually it is a toggle bar, not a radio list. Putting a check icon inside still reads as "selected pill segment", not "selected option among independent radios". Different affordance.

`RadioGroup` covers the affordance gap: independent items, each with a leading radio icon (filled or empty circle) and a label, laid out horizontally or vertically with optional wrapping.

### Existing radio-style usages in the app

| File | Current shape | Migrates in |
|------|--------------|-------------|
| `src/renderer/ui/dialogs/InputDialog.tsx` (lines 146–162) | Horizontal row of legacy `Button`s with `RadioCheckedIcon`/`RadioUncheckedIcon` and a label | US-432 Phase 2 |
| `src/renderer/editors/grid/components/CsvOptions.tsx` (lines 100–114) | Horizontal row of legacy `Button size="small"` with radio icons (CSV delimiter selection) | Future Phase 4 task for the Grid editor |
| `src/renderer/editors/log-view/items/RadioboxesDialogView.tsx` (lines 80–92) | Vertical or wrap-row of legacy single-item `<Radio>` from `components/basic/Radio.tsx` | Future Phase 4 task for the LogView editor |

The legacy `components/basic/Radio.tsx` is a **single-item** primitive (one labeled radio, no group); the new UIKit primitive replaces it with a **group** API (no single-item export needed — single-radio cases use a 1-item group, which is rare in practice).

### EPIC-025 rules in scope

- **Rule 1 — Data attributes:** `data-type="radio-group"`, `data-orientation`, `data-disabled` on the root; `data-type="radio"`, `data-checked`, `data-disabled` on each item.
- **Rule 3 — Trait-based data binding:** items prop accepts `IRadio[] | Traited<unknown[]>`. A `RADIO_KEY = new TraitKey<TraitType<IRadio>>("radio-group-item")` is registered in the component file.
- **Rule 4 — Roving tabindex:** single Tab stop per group; arrow keys move focus AND selection (per ARIA radio-group spec); Tab / Shift+Tab exits the group.

### Reference patterns

`SegmentedControl.tsx` is the closest existing UIKit implementation to mirror. Its roving-tabindex code (`focusButton`, `moveFocus`, `handleKey`) and trait pattern (`isTraited` + `resolveTraited`) translate one-to-one. The visual shell is different (joined pill bar vs. independent radio rows) but the keyboard behavior and trait integration carry over.

## API

### Types

```ts
export interface IRadio {
    /** Stable identifier — what `value` / `onChange` refer to. */
    value: string;
    /** Display label. Falls back to `value` when omitted. */
    label?: React.ReactNode;
    /** Icon rendered between the radio circle and the label. Optional. */
    icon?: React.ReactNode;
    /** Disables this option without affecting siblings. */
    disabled?: boolean;
}

/** Trait key for non-IRadio item arrays — register accessors against this. */
export const RADIO_KEY = new TraitKey<TraitType<IRadio>>("radio-group-item");

export interface RadioGroupProps {
    items: IRadio[] | Traited<unknown[]>;
    value: string;
    onChange: (value: string) => void;
    /** Layout direction. Default: "vertical". */
    orientation?: "horizontal" | "vertical";
    /** Allow wrapping when `orientation="horizontal"`. Default: false. */
    wrap?: boolean;
    /** Gap between items. Default: "sm". */
    gap?: "xs" | "sm" | "md" | "lg" | "xl";
    /** Disables the entire group. Per-item disabling is on `IRadio.disabled`. */
    disabled?: boolean;
    "aria-label"?: string;
    "aria-labelledby"?: string;
}
```

`RadioGroupProps` does **not** extend `HTMLAttributes` for `style` / `className` — UIKit Rule 7 — only the listed props are accepted.

### Behavior

**Visual (per item):**
- Row: `RadioCheckedIcon` (when selected) or `RadioUncheckedIcon` (when not), then `icon` (if any), then `label`.
- Icon color: `color.text.light` at rest, `color.text.default` on hover/focus. Selected item icon is `color.text.default` regardless.
- Disabled: opacity 0.5, `cursor: default`, no hover color change. The whole group disabled prop dims the group with `opacity: 0.6`.
- Use `<button>` element for each item (semantic, focusable). Buttons have no border, no background (transparent), padding from `spacing.sm`/`spacing.md`, gap `spacing.sm`, font size `fontSize.base`.
- Root is `<div>` with `role="radiogroup"`, layout via inline flex (mirror `SegmentedControl`'s use of `Panel` is unnecessary — direct `styled.div` is simpler since the layout is one-dimensional).

**Roving tabindex (Rule 4, per ARIA radio-group spec):**
- The selected item has `tabIndex={0}`; others `tabIndex={-1}`. When no item matches `value`, the first non-disabled item is tab-reachable so the group remains keyboard-entry-able.
- `ArrowDown` / `ArrowRight` → move focus to the next non-disabled item, wrap at end, fire `onChange(nextItem.value)`.
- `ArrowUp` / `ArrowLeft` → previous non-disabled item, wrap at start, `onChange`.
- `Home` → first non-disabled item, `onChange`.
- `End` → last non-disabled item, `onChange`.
- `Space` / `Enter` → select the currently focused item (redundant with arrow-key behavior but expected per spec; users may Tab in and press Space).
- Tab / Shift+Tab exits the group (default browser behavior since only one item has `tabIndex={0}`).

**ARIA:**
- Root: `role="radiogroup"`, `aria-disabled` if `disabled`, `aria-orientation` (`"horizontal"` | `"vertical"`).
- Each item: `role="radio"`, `aria-checked={selected}`, `aria-disabled` if item disabled, plain text label as accessible name.

### Data attributes

| Element | Attribute | Values |
|---------|-----------|--------|
| Root | `data-type` | `"radio-group"` |
| Root | `data-orientation` | `"horizontal"` / `"vertical"` |
| Root | `data-disabled` | present / absent |
| Root | `data-roving-host` | `""` (always — for Toolbar nested-roving detection) |
| Item | `data-type` | `"radio"` |
| Item | `data-checked` | `"true"` / `"false"` |
| Item | `data-disabled` | present / absent |

## Implementation Plan

### Files

```
src/renderer/uikit/RadioGroup/
  RadioGroup.tsx          ← component + RADIO_KEY + IRadio + RadioGroupProps
  RadioGroup.story.tsx    ← Storybook entry
  index.ts                ← re-exports
```

### Steps

1. **Create `src/renderer/uikit/RadioGroup/RadioGroup.tsx`**:
   - Imports: `React`, `styled` from `@emotion/styled`, `color` from `../../theme/color`, `RadioCheckedIcon` + `RadioUncheckedIcon` from `../../theme/icons`, `spacing` + `gap` + `fontSize` from `../tokens`, `isTraited` + `resolveTraited` + `TraitKey` + `Traited` + `TraitType` from `../../core/traits/traits`.
   - Define `IRadio` interface, `RADIO_KEY = new TraitKey<TraitType<IRadio>>("radio-group-item")`, `RadioGroupProps`.
   - `Root = styled.div(...)`: `display: inline-flex`; `'&[data-orientation="horizontal"]': { flexDirection: "row" }`; `'&[data-orientation="vertical"]': { flexDirection: "column" }`; `"&[data-disabled]": { opacity: 0.6 }`. Wrap and gap are applied via inline `style` from props (same approach as `Panel`).
   - `Item = styled.button(...)`: `display: inline-flex`; `align-items: center`; `gap: spacing.sm`; transparent border + background; `cursor: pointer`; `padding: 0`; `outline: none`; `color: color.text.default`; `font-size: fontSize.base`; `text-align: left`. Inside: an `& .radio-icon` selector with `flexShrink: 0`, `width: height.iconMd`, `height: height.iconMd`, `color: color.text.light`. `"&:hover .radio-icon, &:focus-visible .radio-icon": { color: color.text.default }`. `'&[data-checked="true"] .radio-icon': { color: color.text.default }`. `"&[data-disabled]": { cursor: "default", opacity: 0.5 }; "&[data-disabled]:hover .radio-icon": { color: color.text.light }`.
   - In the function body: resolve items via `isTraited(items) ? resolveTraited(items, RADIO_KEY) : items`. Compute `selectedIdx` and `fallbackIdx` (mirror `SegmentedControl`). Implement `focusItem`, `moveFocus`, `handleKey` from the SegmentedControl pattern, but adapt the DOM lookup since RadioGroup root will be the `<div>` directly (not via a Panel wrapper, so `rootRef.current?.children[i]` works the same way).
   - Render: root `<Root role="radiogroup" data-type="radio-group" data-orientation={orientation} data-disabled={disabled || undefined} data-roving-host="" aria-disabled={disabled || undefined} aria-orientation={orientation} ref={rootRef} style={{ gap: gapTokens[gap], flexWrap: orientation === "horizontal" && wrap ? "wrap" : undefined }} aria-label aria-labelledby>`. Map `segments` to `<Item role="radio" aria-checked={selected} data-type="radio" data-checked={selected ? "true" : "false"} data-disabled={itemDisabled || undefined} disabled={itemDisabled} tabIndex={i === fallbackIdx ? 0 : -1} onClick={() => onChange(item.value)} onKeyDown={(e) => handleKey(e, i)}>`. Inside the button: `{selected ? <RadioCheckedIcon className="radio-icon" /> : <RadioUncheckedIcon className="radio-icon" />}` + `{item.icon}` + `{item.label ?? item.value}`.

2. **Create `src/renderer/uikit/RadioGroup/index.ts`**:
   ```ts
   export { RadioGroup, RADIO_KEY } from "./RadioGroup";
   export type { RadioGroupProps, IRadio } from "./RadioGroup";
   ```

3. **Create `src/renderer/uikit/RadioGroup/RadioGroup.story.tsx`** following the pattern of `SegmentedControl.story.tsx`. Story controls:
   - `orientation`: `"horizontal" | "vertical"`
   - `wrap`: boolean
   - `gap`: enum (xs/sm/md/lg/xl)
   - `disabled`: boolean (group-level)
   - `count`: number — generate that many items
   - `withIcons`: boolean — give each item a non-radio icon
   - `disableSecond`: boolean — mark item index 1 as `disabled` to verify focus/selection skip
   - Demo body: `<Panel direction="column" gap="md">` with the RadioGroup and a `<Text>` showing the current value.

4. **Update `src/renderer/uikit/index.ts`** — add the exports:
   ```ts
   export { RadioGroup, RADIO_KEY } from "./RadioGroup";
   export type { RadioGroupProps, IRadio } from "./RadioGroup";
   ```

5. **Type-check + Storybook smoke test**:
   - All control variants render as expected.
   - Keyboard: Tab into the group → first/selected item focused. Arrow keys move focus and update selection. Disabled items are skipped. Tab out exits the group.
   - Click selects without losing the keyboard model (the clicked item becomes the tab-reachable one).
   - Mouse hover changes the radio icon color from `text.light` to `text.default`.

### Pattern fidelity to `SegmentedControl`

Where `SegmentedControl.tsx` and `RadioGroup.tsx` overlap, mirror code structure for readability. Specifically:
- `focusItem(i)` / `moveFocus(currentIdx, dir)` / `handleKey(e, i)` — same shape.
- `selectedIdx` / `fallbackIdx` calculation — same.
- `isTraited` + `resolveTraited` invocation — same.
- `data-roving-host=""` on root — same.

Where they differ:
- No border-overlap math (`marginLeft: -1`) — radios are independent items.
- No `Button` reuse — RadioGroup uses a private `styled.button` for each item because the visual is icon-on-left + label, not the standard button look.
- Layout via flex with optional `wrap` vs. SegmentedControl's `inline-flex` row.
- Size variants — RadioGroup does not need `size?: "sm" | "md"` initially (one default size); add later if a consumer requires it.

## Concerns / Open questions

1. **Single-item radio (`<Radio>`) — keep an export?** No. UIKit prefers groups. Single-radio call-sites are rare and a 1-item `RadioGroup` works. The legacy `components/basic/Radio.tsx` stays in place during the migration; it is dropped in EPIC-025 Phase 7 like the rest of `components/`.
2. **`size` variant** — deferred. None of the three identified consumers need a small variant immediately (`InputDialog` and `CsvOptions` use small button rows currently, but the new RadioGroup default size matches `fontSize.base` which reads as the standard form control size). Add `size` if a consumer requires it during their migration.
3. **Vertical-orientation arrow keys** — per ARIA spec, vertical radio groups respond to ArrowUp/ArrowDown; horizontal to ArrowLeft/ArrowRight. The implementation accepts both pairs in either orientation (mirroring `SegmentedControl`) — simpler and not harmful; the spec doesn't forbid responding to both.
4. **Selection on focus vs. on Space/Enter** — per ARIA radio-group spec, arrow keys move focus AND select. Implementation follows this. Some apps separate focus from selection (selection only on Space) but that breaks the spec and surprises screen-reader users.
5. **Is there a future for icons-only radios (no label)?** Yes — `IRadio.label` is optional, falling back to `value`. For an icons-only look, the consumer omits `label` and provides `icon`; the result is a focusable button with a radio circle and an icon. Storybook will include this variant.
6. **Naming overlap with SegmentedControl** — both render `role="radiogroup"`. Distinct names (`RadioGroup` for true radio rows, `SegmentedControl` for joined toggle bars) come from the EPIC-025 Phase 4 / Phase 0 naming research and match how the user thinks about the affordance.

## Acceptance Criteria

- [ ] `src/renderer/uikit/RadioGroup/` exists with `RadioGroup.tsx`, `RadioGroup.story.tsx`, `index.ts`
- [ ] `RadioGroup` and `IRadio` and `RADIO_KEY` exported from `src/renderer/uikit/index.ts`
- [ ] `RADIO_KEY = new TraitKey<TraitType<IRadio>>("radio-group-item")` registered inside the component file
- [ ] Roving tabindex working: only one item is in the tab sequence; arrow keys move focus and selection; disabled items are skipped
- [ ] ARIA: root has `role="radiogroup"`; each item has `role="radio"` + `aria-checked`
- [ ] Visual: filled/empty radio icon switches per selection; hover changes icon color; disabled state dims and disables hover
- [ ] Storybook story renders all variants (orientation, wrap, gap, disabled group, disabled item, with icons, vary count)
- [ ] No `style` / `className` accepted on `<RadioGroup>` (TypeScript error if attempted)
- [ ] `npm run lint` and `tsc` pass

## Files Changed

### Created

| Path | Purpose |
|------|---------|
| `src/renderer/uikit/RadioGroup/RadioGroup.tsx` | Component + types + trait key |
| `src/renderer/uikit/RadioGroup/RadioGroup.story.tsx` | Storybook entry |
| `src/renderer/uikit/RadioGroup/index.ts` | Re-exports |

### Modified

| Path | Change |
|------|--------|
| `src/renderer/uikit/index.ts` | Add `RadioGroup`, `RADIO_KEY`, `RadioGroupProps`, `IRadio` exports |

### Files NOT changed

- `src/renderer/components/basic/Radio.tsx` — legacy single-item radio. Stays in place; consumers migrate during their own screen tasks; the file is removed when EPIC-025 Phase 7 drops `src/renderer/components/`.
- `src/renderer/ui/dialogs/InputDialog.tsx` — migrates in **US-432 Phase 2** (new dialog primitive task).
- `src/renderer/editors/grid/components/CsvOptions.tsx` — migrates in a future Phase 4 task for the Grid editor.
- `src/renderer/editors/log-view/items/RadioboxesDialogView.tsx` — migrates in a future Phase 4 task for the LogView editor.
- `src/renderer/uikit/SegmentedControl/` — unaffected; its semantics overlap (`role="radiogroup"`) but the visual affordance is distinct.
- `src/renderer/theme/icons.tsx` — `RadioCheckedIcon` and `RadioUncheckedIcon` already exist and are reused as-is.
