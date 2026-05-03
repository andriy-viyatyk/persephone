# US-472: UIKit Select — searchable single-value combobox

**Epic:** EPIC-025 (Phase 4 — form infrastructure)
**Blocked on:** US-471 (UIKit Input — start/end slots)
**Status:** Planned

---

## Goal

Build the UIKit `Select` primitive: a searchable single-value picker with type-to-filter, keyboard navigation, and a chevron toggle. Built by composing existing UIKit primitives (`Input` with end-slot chevron, `Popover`, `ListBox`) — no new low-level abstractions, no `ComboTemplate`. The trigger is a real `<Input>` (not a label), so the user can type to filter the list immediately on open. A future `MultiSelect` may motivate extracting a shared `useCombobox` hook or `ComboTemplate` component; that is explicitly **not** in this task.

A separate "label + popover + listbox" composition (no typing) is **not** Select — that's a different component (working name: `LabeledMenu` or just `<Popover>` + `<ListBox>` directly at the call site). Out of scope here.

---

## Background

### What Select replaces

The legacy combobox is `src/renderer/components/form/ComboSelect.tsx`. It uses `ComboTemplate` (which uses legacy `TextField` with `endButtons`), `List` (legacy virtualized list), and `Popper` (legacy floating). UIKit `Select` consumes the new equivalents directly:

| Legacy | UIKit |
|--------|-------|
| `ComboTemplate` | (none — Select wires Input + Popover itself) |
| `TextField` + `endButtons` | `Input` + `endSlot` (US-471) |
| `Popper` | `Popover` (US-466) |
| `List` | `ListBox` (US-468) |

### Why a real `<Input>` for the trigger (not a `<div>` label)

The user requirement is that Select must support typing-to-filter. That requires a real text input. Using a label-like `<div>` would force keystroke interception logic to be reimplemented; a real `<input>` gets us caret position, selection, paste, and IME composition for free. Trade-off: the displayed text is a string label, so when the user has selected an item the input shows the item's `label` — but that label may differ from the underlying `value` (e.g. `value: "us-east-1"`, `label: "US East (N. Virginia)"`). The internal state distinguishes "selected item" (the source of truth) from "input text" (a derived display string when closed; a search query when open).

### EPIC-025 rules in scope

- **Rule 1 (data attributes):** root `data-type="select"`; `data-disabled`, `data-readonly`, `data-state="open"|"closed"`.
- **Rule 2 (controlled):** caller owns `value`. Internal transient state allowed: `open`, `searchText`, `activeIndex`.
- **Rule 3 (trait-based items):** `items: T[] | Traited<T[]>`. Resolve once at the top with `LIST_ITEM_KEY` (already exported from ListBox). No `getLabel`/`getValue`/`getIcon` accessors.
- **Rule 7 (no Emotion outside UIKit):** API forbids `style` and `className` via `Omit<...>`.
- **Naming table:** `ComboSelect` → `Select`. Boolean props are adjectives (`disabled`, not `isDisabled`). Use `value`, `onChange`, `items`, `placeholder`, `disabled`, `open`, `onOpenChange`.

### Reference patterns

- **Input + slot:** US-471 delivers `endSlot`. Select's chevron is `<IconButton icon={<ChevronDownIcon />} size="sm" onClick={toggle} />` in the end slot.
- **Popover anchored to input:** `Popover` already supports `matchAnchorWidth` (US-466) — exactly what we need so the dropdown's width tracks the input's width as the user resizes.
- **ListBox with keyboardNav=false:** Select handles its own ArrowUp/Down/Enter on the input, then drives `activeIndex` and `onChange` on the ListBox. We deliberately do **not** move focus into the ListBox; focus stays on the input so the user can keep typing.
- **HighlightedTextProvider:** the legacy ComboSelect wraps the list in `HighlightedTextProvider` so list items can highlight the current search term. UIKit's `ListBox` accepts `searchText` directly as a prop on the default `ListItem` — pass the current query through.

---

## API

```ts
export interface SelectProps<T = IListBoxItem>
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className" | "onChange"> {
    items: T[] | Traited<T[]>;
    /** Currently-selected value. `null` when nothing is selected. */
    value?: IListBoxItem["value"] | null;
    /** Fires when the user picks an item from the list. */
    onChange?: (value: IListBoxItem["value"], item: IListBoxItem) => void;
    /** Placeholder shown when no item is selected. */
    placeholder?: string;
    /** Disabled state — input cannot be focused, popover cannot open. */
    disabled?: boolean;
    /** Read-only state — popover does not open, input is not editable, no chevron interaction. */
    readOnly?: boolean;
    /** Control size. Default: "md". */
    size?: "sm" | "md";
    /** Filter mode for typeahead. Default: "contains". */
    filterMode?: "contains" | "startsWith" | "off";
    /** Custom filter — overrides `filterMode` when set. */
    filter?: (item: IListBoxItem, query: string) => boolean;
    /** Renders inside the popover when filtered list is empty. Default: "no results". */
    emptyMessage?: React.ReactNode;
    /** Maximum number of visible rows in the popover before scrolling. Default: 10. */
    maxVisibleItems?: number;
    /** Pixel height of each row. Forwarded to the inner ListBox. Default: 24. */
    rowHeight?: number;
    "aria-label"?: string;
    "aria-labelledby"?: string;
}
```

`Select` does **not** ship `freeText` mode in this task. Free-text consumers stay on legacy `ComboSelect` until a follow-up (or a dedicated `Combobox` / `Autocomplete` task) decides on the right shape.

`Select` does **not** ship `selectFrom` async-loader functionality in this task. All consumers in scope can pass synchronous `items`. Async loading is a follow-up.

---

## Implementation plan

### Step 1 — Create `src/renderer/uikit/Select/Select.tsx`

State (internal, transient — Rule 2 allows this):
- `open: boolean`
- `searchText: string` — current query while popover is open; reset to `""` when closed
- `activeIndex: number | null` — highlighted row in the ListBox

Derived:
- `selectedItem` — `items.find(i => i.value === value)` (after trait resolution).
- `displayText` — when popover is **closed**: `selectedItem?.label as string ?? ""`. When **open**: `searchText` (the user's live query).
- `filteredItems` — items filtered by `searchText` and `filterMode` / `filter`.

Element layout:

```tsx
<>
    <Input
        ref={inputRef}
        size={size}
        value={displayText}
        onChange={onInputChange}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        onFocus={onInputFocus}
        onKeyDown={onInputKeyDown}
        onClick={onInputClick}
        endSlot={
            <IconButton
                icon={open ? <ChevronUpIcon /> : <ChevronDownIcon />}
                size="sm"
                onClick={onChevronClick}
                tabIndex={-1}
                disabled={disabled || readOnly}
            />
        }
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
    />
    <Popover
        open={open}
        onClose={() => setOpen(false)}
        elementRef={inputRef.current}
        matchAnchorWidth
        outsideClickIgnoreSelector={`[data-type="select"][data-id="${selectId}"]`}
    >
        <ListBox
            id={listboxId}
            items={filteredItems}
            value={value ?? null}
            activeIndex={activeIndex}
            onActiveChange={setActiveIndex}
            onChange={onListChange}
            searchText={searchText}
            rowHeight={rowHeight}
            growToHeight={maxVisibleItems * rowHeight}
            emptyMessage={emptyMessage ?? "no results"}
        />
    </Popover>
</>
```

A unique `selectId` is generated with `useId()` and attached as `data-id` on the Input wrapper, so `outsideClickIgnoreSelector` lets clicks on the input itself (and its chevron) pass through without closing the popover. (Without this, the click that toggles the chevron would race against the popover's `mousedown` outside-close listener.)

### Step 2 — Trait resolution

Reuse `LIST_ITEM_KEY` exported by ListBox:

```ts
import { LIST_ITEM_KEY, IListBoxItem, ListBox } from "../ListBox";
import { isTraited, resolveTraited } from "../../core/traits/traits";

const resolved = useMemo(() => {
    if (isTraited<unknown[]>(items)) return resolveTraited<IListBoxItem>(items, LIST_ITEM_KEY);
    return items as IListBoxItem[];
}, [items]);
```

Pass `items` through to `<ListBox items={items} />` directly — ListBox does its own resolution. Select needs `resolved` only for the local lookup (`find`, `filter`).

### Step 3 — Filtering

```ts
function defaultMatch(item: IListBoxItem, q: string, mode: "contains" | "startsWith" | "off"): boolean {
    if (mode === "off" || q === "") return true;
    const label = typeof item.label === "string" ? item.label.toLowerCase() : "";
    const query = q.toLowerCase();
    return mode === "startsWith" ? label.startsWith(query) : label.includes(query);
}

const filteredItems = useMemo(() => {
    if (!open || filterMode === "off") return resolved;
    const match = filter ?? ((it: IListBoxItem) => defaultMatch(it, searchText, filterMode));
    return resolved.filter(match);
}, [resolved, open, searchText, filterMode, filter]);
```

When `item.label` is a non-string ReactNode, default-match returns `true` (no filtering). Callers with non-string labels can pass a custom `filter`.

### Step 4 — Open / close behavior

- **Open triggers:** focus on input, click on input, click on chevron, ArrowDown/ArrowUp/PageDown/PageUp/Enter on the input when closed, typing any printable character.
- **Close triggers:** `Escape` key, outside click (handled by Popover via `onClose`), selecting an item from the list, blur (after a short delay so chevron clicks don't race).
- **Reset on close:** `searchText = ""`, `activeIndex = null`.

### Step 5 — Keyboard handling on the input

```
ArrowDown  → if closed, open; else activeIndex++
ArrowUp    → if closed, open; else activeIndex-- (clamp at 0)
PageDown   → activeIndex += 9 (clamped)
PageUp     → activeIndex -= 9 (clamped)
Home / End → activeIndex = 0 / last
Enter      → if open and activeIndex valid, select that item; else open
Escape     → if open, close; else propagate (so dialogs can close)
```

Letter keys go through normal input typing, which fires `onChange` → `setSearchText`.

### Step 6 — Selecting an item

```ts
const onListChange = (v, item) => {
    onChange?.(v, item);
    setOpen(false);
    setSearchText("");
    inputRef.current?.focus();      // keep focus on the trigger so Tab order continues
};
```

### Step 7 — Storybook entry

`Select.story.tsx` with controls:

- `value` (string) — selected value
- `placeholder` (string)
- `disabled` (boolean)
- `readOnly` (boolean)
- `size` (enum sm/md)
- `filterMode` (enum contains/startsWith/off)
- `itemCount` (number 0..1000) — generates synthetic items so the user can test virtualization
- `withIcons` (boolean) — when true, items include a leading icon

Demo wrapper holds `useState` for the selected value and writes the current value below the Select via `<Text>`.

### Step 8 — Index plumbing

- `src/renderer/uikit/Select/index.ts` — re-export `Select`, `SelectProps`.
- `src/renderer/uikit/index.ts` — append:
  ```ts
  export { Select } from "./Select";
  export type { SelectProps } from "./Select";
  ```
- `src/renderer/editors/storybook/storyRegistry.ts` — import and add to `ALL_STORIES`.

---

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/uikit/Select/Select.tsx` | New — main component |
| `src/renderer/uikit/Select/Select.story.tsx` | New — storybook entry |
| `src/renderer/uikit/Select/index.ts` | New — barrel |
| `src/renderer/uikit/index.ts` | Add Select export |
| `src/renderer/editors/storybook/storyRegistry.ts` | Register `selectStory` |

---

## Concerns / Open questions

### 1. Generic typing on `Select<T>`

Following ListBox's pattern: `Select<T = IListBoxItem>` with the same `forwardRef` cast. Confirmed — same shape that ListBox already uses (`src/renderer/uikit/ListBox/ListBox.tsx:349`).

### 2. Chevron `tabIndex={-1}`

The chevron's IconButton has `tabIndex={-1}` so Tab from the input proceeds to the next form field, not into the chevron. The chevron is reachable via mouse and via the input's keyboard handlers — it does not need its own tab stop. Same convention as legacy ComboTemplate.

### 3. When `value` matches no item

E.g. caller passes `value="orphan-id"` but no item in `items` has that value. Behavior: `displayText` becomes `""` (placeholder shown). No error. Caller is responsible for keeping `value` in sync with `items`.

### 4. Selecting an item whose `label` is a non-string ReactNode

`displayText` falls back to `String(value)` when `selectedItem.label` is not a string. This is rare — most callers use string labels — but the fallback prevents `[object Object]` from rendering in the input.

### 5. `readOnly` vs `disabled`

- `disabled`: input cannot be focused, popover never opens, chevron is dimmed (Input passes `data-disabled` and the IconButton receives `disabled`).
- `readOnly`: input is focusable so the user can copy the selected text, but typing does nothing, popover never opens, chevron is dimmed but visible.

### 6. Async items / `selectFrom`

Out of scope. If a consumer needs async-loaded options, they can fetch into a state variable in their own model and pass synchronous `items`. A follow-up task can add `selectFrom: () => Promise<T[]>` if multiple consumers genuinely need it.

### 7. Free-text mode

Out of scope. Free-text combos (where the user can submit arbitrary text not in the list) are a different UX shape (autocomplete). A follow-up task — name TBD, working name `Autocomplete` — can deliver that. Free-text legacy consumers stay on `ComboSelect` until then.

### 8. Should we extract `useCombobox` / `ComboTemplate` now?

**No.** Decision recorded: with one consumer, abstraction is premature. When a second combobox-shaped consumer arrives (likely `MultiSelect` for tag fields), a follow-up task can extract the shared trigger/popover/keyboard glue. Building `Select` directly first lets us see exactly which parts generalize.

### 9. Outside-click race with chevron toggle

Tested mental model: when the popover is `open` and the user clicks the chevron, the Popover's `mousedown` outside-click handler fires first; without `outsideClickIgnoreSelector`, that closes the popover, then the chevron's `click` reopens it — a flicker. Fix: pass `outsideClickIgnoreSelector` matching the Select's input wrapper (using a unique `data-id={selectId}`) so clicks on the input itself or chevron pass through. Verified pattern works for nested Tooltips inside Popovers (commit `2ea8244`).

---

## Acceptance criteria

- [ ] `<Select items={...} value={v} onChange={setV} />` renders, opens on focus/click/keyboard, and selects items by mouse and by Enter.
- [ ] Typing in the input filters the visible items (default: `contains`, case-insensitive).
- [ ] ArrowUp/Down move the active row; Enter selects the active row.
- [ ] Escape closes the popover; outside click closes the popover; chevron click toggles the popover.
- [ ] Selecting an item closes the popover, clears the search, returns focus to the input, fires `onChange(value, item)`.
- [ ] Popover width matches input width (`matchAnchorWidth`).
- [ ] When closed, the input shows the selected item's label (or placeholder if none).
- [ ] When open, the input shows the user's live query.
- [ ] `disabled` blocks all interaction; `readOnly` allows focus but blocks editing and opening.
- [ ] Storybook entry covers itemCount=0 (empty), itemCount=5 (small), itemCount=1000 (virtualized), and `filterMode` switching.
- [ ] `npx tsc --noEmit` clean for the changed files.
- [ ] `npm run lint` clean for the changed files.
