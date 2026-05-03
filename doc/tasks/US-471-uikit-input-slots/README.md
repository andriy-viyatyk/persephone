# US-471: UIKit Input — start/end slots

**Epic:** EPIC-025 (Phase 4 — form infrastructure)
**Blocks:** US-472 (UIKit Select)
**Status:** Planned

---

## Goal

Add `startSlot` and `endSlot` props to UIKit `Input` so callers can render content (icons, IconButton, Spinner, short text) inside the input chrome. This unblocks Select (US-472) which needs an end-slot chevron, and covers other near-term needs (search inputs with a magnifier glyph, clearable inputs with an "×" button, password show/hide toggles, prefix/suffix labels for units).

---

## Background

### Why slots, not a wrapper component

Two designs were considered:

1. **Slots on Input** — `startSlot` / `endSlot` props (this task).
2. **Wrapper component** — a new `InputGroup` that composes Input + affix elements.

Slots are the lightweight standard pattern (MUI `startAdornment`/`endAdornment`, Mantine `leftSection`/`rightSection`, Chakra v3 `<InputGroup>`-like). They keep border, background, and focus ring owned by Input, and the slot just renders inside that chrome with the input's padding adjusted to leave room. A wrapper component is heavier and only earns its keep when the affix is structurally separate from the input (e.g. a full Button glued to the side with its own border and a divider). We have no such consumer today; if one appears later, an `InputGroup` can be added without conflicting with slots.

### Legacy reference (do NOT migrate to UIKit naming)

`src/renderer/components/basic/Input.tsx` and `TextField.tsx` use the legacy `addornmentStart` / `addornmentEnd` props (note the misspelling) plus explicit `*Width` props. The legacy implementation uses `position: absolute` overlays and computes input padding from a caller-provided pixel width. This task takes a different approach: **flex layout, no caller-provided widths**. Slot width is whatever the slot content measures.

The new approach:
- Input root becomes a flex row container that owns the border, background, and focus ring.
- Inner `<input>` is a flex child with `flex: 1`, no border of its own.
- Slots are flex children rendered before / after the inner `<input>`.
- Focus ring uses `&:focus-within` on the wrapper (not `&:focus` on a bare `<input>`).

### EPIC-025 rules in scope

- **Rule 1 (data attributes):** keep `data-type="input"`, `data-size`, `data-disabled`, `data-readonly` on the wrapper. Slot wrappers get `data-part="start-slot"` / `data-part="end-slot"`.
- **Rule 7 (no Emotion outside UIKit):** consumers pass plain UIKit nodes (`<IconButton icon={...} />`, `<Spinner size={16} />`) into slots — never `styled.div`.
- **Naming table:** the table forbids `iconLeft`/`startIcon`/`leftAdornment` for *single-icon* props. Slots are not single-icon props (they accept any ReactNode), so `startSlot`/`endSlot` is the clearest name for the surface.

### Reference patterns to mirror

- Tooltip integration in IconButton (`src/renderer/uikit/IconButton/IconButton.tsx`) — IconButton already self-handles its own click/keyboard, so dropping one into a slot Just Works.
- Popover sizing via `&:focus-within` is the same pattern Tooltip uses for its anchor wrapper.

---

## API

```ts
export interface InputProps
    extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "size"> {
    onChange?: (value: string) => void;
    size?: "sm" | "md";
    /** Content rendered inside the input chrome, before the text. */
    startSlot?: React.ReactNode;
    /** Content rendered inside the input chrome, after the text. */
    endSlot?: React.ReactNode;
}
```

The forwarded `ref` continues to point to the inner `HTMLInputElement` so callers can `inputRef.current?.focus()` exactly as today.

---

## Implementation plan

### Step 1 — Restructure Input.tsx as a flex wrapper

Convert `Input` from a bare `styled.input` to:

```tsx
const Wrapper = styled.div({...});      // border, background, radius, focus-within ring, data-* size/disabled/readonly
const Field   = styled.input({...});    // borderless, transparent bg, flex: 1, padding handled here
const Slot    = styled.div({...});      // display: flex, alignItems: center, flexShrink: 0
```

The wrapper carries `data-type="input"`, `data-size`, `data-disabled`, `data-readonly`. The field carries `readOnly`, `disabled`, value/onChange.

Padding rules:
- Wrapper has no padding.
- Field has `padding: ${spacing.sm}px ${spacing.md}px` when no slot is on that side.
- When `startSlot` is present, field gets `paddingLeft: 0` and the slot wrapper itself contributes `paddingLeft: ${spacing.sm}px paddingRight: ${spacing.xs}px`.
- Symmetric rule for `endSlot`.

### Step 2 — Move focus styling from `:focus`/`:active` to `:focus-within`

```ts
"&:focus-within": { borderColor: color.border.active },
"&[data-readonly]:focus-within": { borderColor: color.border.light },
```

(US-470 added a `&[readonly]:focus, &[readonly]:active` rule on the bare `<input>`. Replace with `&[data-readonly]:focus-within` on the wrapper.)

### Step 3 — Preserve number-input spinner styling

The current Input has `&[type='number']` rules for `::-webkit-inner-spin-button`. Move those rules onto the inner `Field` styled selector (`Field` is the actual `<input>`). Keep the `paddingRight: spacing.xs` on the field when `type='number'` — but only when no `endSlot` is set (the slot already provides right-side breathing room).

### Step 4 — Forward ref to inner `<input>`

The component remains `React.forwardRef<HTMLInputElement, InputProps>` and the ref attaches to the inner `Field`. Existing callers that focus, blur, or read selection from the ref keep working unchanged.

### Step 5 — Update Input.story.ts

Add three slot demos:
- `withChevron`: end slot = `<IconButton icon={<ChevronDownIcon />} size="sm" />`.
- `searchInput`: start slot = `<SearchIcon />`, end slot = `<IconButton icon={<CloseIcon />} size="sm" />` (renders only when value is non-empty).
- `unitSuffix`: end slot = `<Text muted>kg</Text>`.

Story controls: existing controls plus an `enum` `slotPreset` switching between `none`, `chevron`, `search`, `unit`.

### Step 6 — Verify no consumer regression

Current UIKit Input consumers (search the repo for `<Input ` and `from "../../uikit"` Input imports). None pass `startSlot`/`endSlot` today, so the change is purely additive. Run `npx tsc --noEmit` and `npm run lint` for a clean diff.

---

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/uikit/Input/Input.tsx` | Restructure as flex wrapper; add `startSlot` / `endSlot` props |
| `src/renderer/uikit/Input/Input.story.ts` | Add slot demo controls |
| `src/renderer/uikit/Input/index.ts` | (no change — `InputProps` already re-exported) |

---

## Concerns / Open questions

### 1. Naming: `startSlot` / `endSlot` vs `prefix` / `suffix` vs `leftSection` / `rightSection`

**Resolved:** `startSlot` / `endSlot`. `prefix`/`suffix` reads as text-only; `leftSection`/`rightSection` is locale-coupled (RTL would invert visually but not the prop name). `start`/`end` is locale-neutral and matches React aria-property conventions (`start`/`end` align with logical-direction CSS).

### 2. Slot click → input focus?

**Resolved: no auto-focus.** Slots are pure containers. If the slot is decorative (a non-interactive icon), the user can still click on the actual input area to focus. If the slot is interactive (IconButton), the button handles its own click and keeps focus where it belongs. Auto-focusing the input from a slot click would interfere with chevron-toggle behavior in Select.

### 3. `data-readonly` on wrapper vs native `readonly` on input

**Resolved: both.** The native `readOnly` attribute stays on the inner `<input>` (semantics, accessibility). The wrapper also carries `data-readonly` so the `:focus-within` border-suppression rule can target the wrapper. The two stay in sync because both are derived from the same `readOnly` prop.

### 4. Should slots constrain their content's size?

**Resolved: no constraint, just flex centering.** The slot wrapper is `display: flex; align-items: center; flex-shrink: 0;` — content sizes itself. IconButton at `size="sm"` (24px) fits naturally inside Input at `size="md"` (26px) with the existing `spacing.xs` gap. If a caller passes oversized content, the input grows — that's the caller's choice.

### 5. Disabled state propagation

**Resolved: caller's responsibility.** When Input is `disabled`, the wrapper gets `data-disabled` and the inner `<input>` gets the native `disabled` attribute. Slot content (e.g. an IconButton) is **not** auto-disabled — the caller must pass `disabled` to the IconButton themselves if that's the desired UX. Auto-propagation would create surprises when the slot is meant to remain interactive (e.g. a "show password" toggle on a `disabled={false}` Input that the caller wants disabled separately).

### 6. RTL future-proofing

Not in scope. The app does not currently support RTL. `startSlot`/`endSlot` will work correctly under `dir="rtl"` if the wrapper uses logical CSS properties; that's a future optimization.

---

## Acceptance criteria

- [ ] `Input` renders without slots exactly as today (no visual diff in existing screens).
- [ ] `<Input startSlot={...} />` reserves space at the start; the inner `<input>` text does not overlap the slot content.
- [ ] `<Input endSlot={...} />` reserves space at the end; same rule.
- [ ] Both slots together work (`startSlot` and `endSlot` present simultaneously).
- [ ] Clicking inside the slot does not steal focus from the input.
- [ ] Clicking on an IconButton inside a slot fires the IconButton's `onClick` handler.
- [ ] Focus ring (border-active blue) appears when the input or any focusable slot child is focused.
- [ ] `readOnly` Input does not show the focus ring — even when an IconButton inside the slot is focused (the wrapper's `&[data-readonly]:focus-within` suppresses it).
- [ ] Storybook entry shows all four presets (`none`, `chevron`, `search`, `unit`).
- [ ] `npx tsc --noEmit` clean for the changed files.
- [ ] `npm run lint` clean for the changed files.
