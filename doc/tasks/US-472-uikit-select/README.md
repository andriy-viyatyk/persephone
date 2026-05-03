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

### Why `value` is the full item (and may be Traited), not the primitive key

ListBox originally exposed `value: string | number` (the primitive key). Select would then have to derive the selected item via `items.find(i => i.value === value)` to read the label for the trigger. That coupling fails the moment `items` are loaded asynchronously: when Select mounts with a known `value` but its `items` array is still empty (network in flight, or items deferred until first open), the trigger has nothing to render — the lookup misses.

We resolve this at the source: `ListBox.value` and `Select.value` carry the full item, accepting either a plain `T` or a `Traited<T>`. The trigger reads `value.label` (or trait-resolves it) directly, so selection display is fully independent of whether `items` has loaded yet.

- **Plain `T` form** — used when `T = IListBoxItem` (the default). `value.label`, `value.value`, `value.icon` are read directly. No accessor needed.
- **`Traited<T>` form** — used when callers keep a domain source type (e.g. `LinkData`) and bundle a `TraitSet` that maps it to `IListBoxItem`. The `value` carries its own traits, so Select can call `value.traits.get(LIST_ITEM_KEY)` to retrieve the accessor and resolve `value.target` to `IListBoxItem` shape — without ever consulting `items`. Callers reuse the same `TraitSet` they built for `items: Traited<T[]>`; wrapping a single selection is one `traited(entity, TRAITS)` call.

Internally:
- **For the list checkmark** — ListBox compares by key: `resolveSingle(value).value === item.value`. When `value`'s key matches no row in `items`, no checkmark renders (correct — that row may load later or may never).
- **For the Select trigger label** — Select reads `resolveSingle(value).label` directly from the prop. No `items` dependency.
- **For `onChange`** — emits the source `T` (`sources[idx]` from ListBox). Callers can re-wrap with `traited(item, TRAITS)` to round-trip back into `value`.

This treats items as first-class entities throughout the API: callers pass items, store items, get items back. The primitive key is an internal equality concern, not part of the contract. Async items + Traited value work naturally together — the trigger never waits on `items` to render.

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
type ItemsLike<T> = T[] | Traited<T[]>;
type ItemsSource<T> =
    | ItemsLike<T>
    | Promise<ItemsLike<T>>
    | (() => ItemsLike<T> | Promise<ItemsLike<T>>);

export interface SelectProps<T = IListBoxItem>
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className" | "onChange"> {
    /**
     * Item source — accepts:
     *   • `T[]` / `Traited<T[]>` — sync, ready immediately.
     *   • `Promise<...>` — eager async; Select awaits on mount.
     *   • `() => T[] | Promise<...>` — lazy; called once on first open. Recommended for items that build from data (e.g. `entities.map(...)`) or fetch from disk/network — the function is not invoked until the user actually opens the popover.
     * Result is cached after first resolution. Changing the `items` reference invalidates the cache.
     */
    items: ItemsSource<T>;
    /**
     * Currently-selected item. `null` when nothing is selected.
     * Independent of `items` — Select renders the trigger label without waiting on items to load.
     *   • Plain `T` — used when `T = IListBoxItem` (item carries `.label` directly).
     *   • `Traited<T>` — used with custom `T`; Select reads the trait accessor from `value.traits`.
     */
    value?: T | Traited<T> | null;
    /** Fires when the user picks an item from the list. Emits the source `T` — caller can re-wrap with `traited()` to round-trip into `value`. */
    onChange?: (item: T) => void;
    /** Optional callback invoked when an async items loader rejects. */
    onItemsLoadError?: (error: unknown) => void;
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

### Step 1 — Update ListBox value semantics (prerequisite)

Before Select can be built, ListBox must change its `value` / `onChange` shape so the contract operates on full items, not primitive keys. This change happens first because Select consumes ListBox directly and would otherwise be forced to re-introduce the old primitive-key model internally.

**File:** `src/renderer/uikit/ListBox/ListBox.tsx`

**API change:**

```ts
// BEFORE
export interface ListBoxProps<T = IListBoxItem>
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className" | "onChange"> {
    items: T[] | Traited<unknown[]>;
    value?: IListBoxItem["value"] | null;
    onChange?: (value: IListBoxItem["value"], item: IListBoxItem) => void;
    ...
}

// AFTER
export interface ListBoxProps<T = IListBoxItem>
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className" | "onChange"> {
    items: T[] | Traited<unknown[]>;
    /**
     * Currently-selected item. `null` when nothing is selected. May reference an item not present in `items` — the checkmark simply will not render in that case.
     *   • Plain `T` — used when `T = IListBoxItem`. Reads `.label` / `.value` / `.icon` directly.
     *   • `Traited<T>` — used with custom `T`. Reads accessor from `value.traits.get(LIST_ITEM_KEY)`.
     */
    value?: T | Traited<T> | null;
    /** Fires when the user selects an item. Emits the source `T` (matches the shape passed via `items`). */
    onChange?: (item: T) => void;
    ...
}
```

**Internal changes inside `ListBoxInner`:**

1. Resolve `items` to `{ resolved, sources }` exactly as today. No need to extract the items-trait-accessor for `value` — `value` carries its own traits when traited.

```ts
const { resolved, sources } = useMemo(() => {
    if (isTraited<unknown[]>(items)) {
        const r = resolveTraited<IListBoxItem>(items, LIST_ITEM_KEY);
        return { resolved: r, sources: items.target as T[] };
    }
    const arr = items as T[];
    return { resolved: arr as unknown as IListBoxItem[], sources: arr };
}, [items]);
```

2. Add a `resolveSingleValue(v: T | Traited<T>): IListBoxItem` helper. The helper inspects `v` directly — if `Traited`, runs the accessor from `v.traits` over `v.target`; otherwise casts as `IListBoxItem`. Decoupled from `items` resolution.

```ts
function runAccessor<R>(source: unknown, accessor: TraitType<R>): R {
    return Object.fromEntries(
        (Object.keys(accessor) as (keyof TraitType<R>)[]).map((k) => [k, accessor[k](source)]),
    ) as R;
}

const resolveSingleValue = useCallback(
    (v: T | Traited<T>): IListBoxItem => {
        if (isTraited<T>(v)) {
            const acc = v.traits.get(LIST_ITEM_KEY);
            if (acc) return runAccessor<IListBoxItem>(v.target, acc);
            return v.target as unknown as IListBoxItem;
        }
        return v as unknown as IListBoxItem;
    },
    [],
);
```

3. Derive the selected key once per render: `const selectedKey = value != null ? resolveSingleValue(value).value : null;`. Use `selectedKey` (not `value`) wherever the old code did `item.value === value`. Inside `renderCell`:

```ts
// BEFORE
const selected = item.value === value;
// AFTER
const selected = selectedKey != null && item.value === selectedKey;
```

4. Update `onItemClick` and the `Enter`-key branch to emit the **source** item, not the resolved one:

```ts
// BEFORE
onChange?.(item.value, item);
// AFTER
onChange?.(sources[idx]);
```

(`sources[idx]` is the source `T` — same identity the caller passed in.)

5. Update the `useEffect` dependency that triggers `gridRef.current?.update({ all: true })` so it re-renders when `selectedKey` changes (currently it uses `value`):

```ts
useEffect(() => {
    gridRef.current?.update({ all: true });
}, [resolved, selectedKey, activeIndex, searchText, renderItem, rowHeight]);
```

**Migration of existing consumers:**

Two consumer sites must be updated together so the typecheck stays clean:

a) `src/renderer/uikit/ListBox/ListBox.story.tsx` — change the demo's local state and handler:

```tsx
// BEFORE
const [value, setValue] = useState<IListBoxItem["value"] | null>(null);
...
<ListBox
    items={visible}
    value={value}
    onChange={(v) => setValue(v)}
    ...
/>

// AFTER
const [value, setValue] = useState<IListBoxItem | null>(null);
...
<ListBox
    items={visible}
    value={value}
    onChange={(item) => setValue(item)}
    ...
/>
```

b) `src/renderer/editors/browser/UrlSuggestionsDropdown.tsx` — `onChange` now receives the full item:

```tsx
// BEFORE
<ListBox
    ...
    onChange={(value) => onSelect(value as string)}
/>

// AFTER
<ListBox
    ...
    onChange={(item) => onSelect(item.value as string)}
/>
```

(Note: `UrlSuggestionsDropdown` uses `T = IListBoxItem`, so `item.value` is the original suggestion string.)

**No changes needed:**

- `src/renderer/uikit/ListBox/ListItem.tsx` — does not consume `value` / `onChange`.
- `src/renderer/uikit/ListBox/index.ts` — re-exports unchanged.
- `IListBoxItem` interface — stays as-is. Its `.value` is the equality key, distinct from the prop `.value` which is the full item.

### Step 2 — Create `src/renderer/uikit/Select/Select.tsx`

State (internal, transient — Rule 2 allows this):
- `open: boolean`
- `searchText: string` — current query while popover is open; reset to `""` when closed
- `activeIndex: number | null` — highlighted row in the ListBox

Derived:
- `loadedItems` — produced by `useSelectItems(items, open)` (Step 4). Either the resolved sync array, the awaited result, or `[]` while loading / before first open.
- `selectedResolved` — `value != null ? resolveSingleValue(value) : null`. Reads label/key/icon from `value` itself (plain T or via `value.traits` when Traited). **No dependency on `loadedItems`** — the trigger renders correctly even before items load.
- `displayText` — when popover is **closed**: `typeof selectedResolved?.label === "string" ? selectedResolved.label : ""`. When **open**: `searchText` (the user's live query).
- `filteredItems` — `loadedItems` filtered by `searchText` and `filterMode` / `filter`.

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
        <ListBox<T>
            id={listboxId}
            items={filteredItems}
            value={value ?? null}
            activeIndex={activeIndex}
            onActiveChange={setActiveIndex}
            onChange={onListChange}
            searchText={searchText}
            rowHeight={rowHeight}
            growToHeight={maxVisibleItems * rowHeight}
            loading={itemsLoading}
            emptyMessage={emptyMessage ?? "no results"}
        />
    </Popover>
</>
```

A unique `selectId` is generated with `useId()` and attached as `data-id` on the Input wrapper, so `outsideClickIgnoreSelector` lets clicks on the input itself (and its chevron) pass through without closing the popover. (Without this, the click that toggles the chevron would race against the popover's `mousedown` outside-close listener.)

### Step 3 — Trait resolution for `value`

`value` carries its own resolution context (plain T or `Traited<T>`), so Select needs only the same `resolveSingleValue` helper introduced in ListBox Step 1. Items resolution happens inside ListBox after Select feeds it the loaded array.

```ts
import { LIST_ITEM_KEY, IListBoxItem, ListBox } from "../ListBox";
import { isTraited, TraitType } from "../../core/traits/traits";

function runAccessor<R>(source: unknown, accessor: TraitType<R>): R {
    return Object.fromEntries(
        (Object.keys(accessor) as (keyof TraitType<R>)[]).map((k) => [k, accessor[k](source)]),
    ) as R;
}

const resolveSingleValue = useCallback(
    (v: T | Traited<T>): IListBoxItem => {
        if (isTraited<T>(v)) {
            const acc = v.traits.get(LIST_ITEM_KEY);
            if (acc) return runAccessor<IListBoxItem>(v.target, acc);
            return v.target as unknown as IListBoxItem;
        }
        return v as unknown as IListBoxItem;
    },
    [],
);

const selectedResolved = value != null ? resolveSingleValue(value) : null;
```

`runAccessor` is a tiny local utility; if a third consumer appears (Tree, MultiSelect), promote it to `src/renderer/core/traits/traits.ts` as `resolveTraitedItem`. Out of scope for this task.

For filtering Select needs the resolved item array — that comes from `useSelectItems` (Step 4), which produces `loadedItems: IListBoxItem[]` already trait-resolved. Select itself does no items resolution; it composes `useSelectItems` for loading + ListBox for rendering.

### Step 4 — Async items loading (`useSelectItems`)

Port the legacy `useSelectOptions` pattern (`src/renderer/components/form/utils.ts:64`) into UIKit. New file:

**File:** `src/renderer/uikit/Select/useSelectItems.ts`

```ts
import { useEffect, useState } from "react";
import { isTraited, resolveTraited, Traited } from "../../core/traits/traits";
import { IListBoxItem, LIST_ITEM_KEY } from "../ListBox";

type ItemsLike<T> = T[] | Traited<T[]>;
export type ItemsSource<T> =
    | ItemsLike<T>
    | Promise<ItemsLike<T>>
    | (() => ItemsLike<T> | Promise<ItemsLike<T>>);

export interface SelectItemsResult {
    /** Trait-resolved IListBoxItem array. `[]` while loading or before first open. */
    items: IListBoxItem[];
    /** True while a Promise is in flight. */
    loading: boolean;
    /** Last load error (if any). Cleared on next successful load. */
    error: unknown;
}

function toResolved<T>(input: ItemsLike<T>): IListBoxItem[] {
    if (isTraited<unknown[]>(input)) return resolveTraited<IListBoxItem>(input, LIST_ITEM_KEY);
    return input as unknown as IListBoxItem[];
}

export function useSelectItems<T>(
    source: ItemsSource<T>,
    open: boolean,
    onError?: (e: unknown) => void,
): SelectItemsResult {
    const [items, setItems] = useState<IListBoxItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<unknown>(null);

    // Reset cache whenever the source reference changes.
    useEffect(() => {
        setLoaded(false);
        setItems([]);
        setError(null);
    }, [source]);

    useEffect(() => {
        // Sync arrays / Traited: resolve immediately, regardless of `open`.
        if (Array.isArray(source) || isTraited<unknown[]>(source)) {
            setItems(toResolved<T>(source as ItemsLike<T>));
            setLoaded(true);
            return;
        }

        // Function / Promise paths: wait for first open, then run once.
        if (!open || loaded) return;

        let live = true;
        setLoading(true);
        setError(null);

        const invoked: ItemsLike<T> | Promise<ItemsLike<T>> =
            typeof source === "function"
                ? (source as () => ItemsLike<T> | Promise<ItemsLike<T>>)()
                : (source as Promise<ItemsLike<T>>);

        Promise.resolve(invoked)
            .then((res) => {
                if (!live) return;
                setItems(toResolved<T>(res));
                setLoaded(true);
                setLoading(false);
            })
            .catch((e) => {
                if (!live) return;
                setError(e);
                setLoading(false);
                onError?.(e);
            });

        return () => {
            live = false;
        };
    }, [source, open, loaded, onError]);

    return { items, loading, error };
}
```

**Wiring inside Select:**

```ts
const { items: loadedItems, loading: itemsLoading } = useSelectItems<T>(
    items,
    open,
    onItemsLoadError,
);

const filteredItems = useMemo(() => {
    if (!open || filterMode === "off") return loadedItems;
    const match = filter ?? ((it: IListBoxItem) => defaultMatch(it, searchText, filterMode));
    return loadedItems.filter(match);
}, [loadedItems, open, searchText, filterMode, filter]);
```

`itemsLoading` is forwarded to `<ListBox loading={...}>` (ListBox already renders a spinner row in that state — see `ListBox.tsx:300`).

**Behavior summary:**

| Source form | When work happens | Cached |
|-------------|-------------------|--------|
| `T[]` / `Traited<T[]>` | Sync, on mount / when reference changes | n/a — always fresh |
| `Promise<...>` | Awaited on first open | Yes, until reference changes |
| `() => T[]` | Called on first open | Yes, until reference changes |
| `() => Promise<...>` | Called on first open, awaited | Yes, until reference changes |

Function/Promise sources are deferred — the user's `entities.map(e => ({ value: e.id, label: e.title }))` is not executed until the popover actually opens. Reference-change invalidation lets callers force a reload by giving a new `items` reference (e.g. `useMemo` keyed on a refresh counter).

### Step 5 — Filtering helper (`defaultMatch`)

The `filteredItems` wiring lives in Step 4 (alongside `useSelectItems`). The shared matcher:

```ts
function defaultMatch(item: IListBoxItem, q: string, mode: "contains" | "startsWith" | "off"): boolean {
    if (mode === "off" || q === "") return true;
    const label = typeof item.label === "string" ? item.label.toLowerCase() : "";
    const query = q.toLowerCase();
    return mode === "startsWith" ? label.startsWith(query) : label.includes(query);
}
```

When `item.label` is a non-string ReactNode, default-match returns `true` (no filtering). Callers with non-string labels can pass a custom `filter`.

### Step 6 — Open / close behavior

- **Open triggers:** focus on input, click on input, click on chevron, ArrowDown/ArrowUp/PageDown/PageUp/Enter on the input when closed, typing any printable character.
- **Close triggers:** `Escape` key, outside click (handled by Popover via `onClose`), selecting an item from the list, blur (after a short delay so chevron clicks don't race).
- **Reset on close:** `searchText = ""`, `activeIndex = null`.

### Step 7 — Keyboard handling on the input

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

### Step 8 — Selecting an item

```ts
const onListChange = (item: T) => {
    onChange?.(item);
    setOpen(false);
    setSearchText("");
    inputRef.current?.focus();      // keep focus on the trigger so Tab order continues
};
```

### Step 9 — Storybook entry

`Select.story.tsx` with controls:

- `value` (string) — selected value
- `placeholder` (string)
- `disabled` (boolean)
- `readOnly` (boolean)
- `size` (enum sm/md)
- `filterMode` (enum contains/startsWith/off)
- `itemCount` (number 0..1000) — generates synthetic items so the user can test virtualization
- `withIcons` (boolean) — when true, items include a leading icon
- `itemsMode` (enum `array` / `lazy-fn` / `lazy-promise`) — exercises the async paths in `useSelectItems`. `lazy-promise` wraps the synthetic items in a `setTimeout(500)` to make the loading spinner observable.

Demo wrapper holds `useState<IListBoxItem | null>` for the selected item and writes `value?.label` and `value?.value` below the Select via `<Text>`. The async demo also tests "value set + items not yet loaded" — the trigger shows the right label before the loader resolves.

### Step 10 — Index plumbing

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
| `src/renderer/uikit/ListBox/ListBox.tsx` | Update — `value: T \| Traited<T> \| null`, `onChange: (item: T) => void`, internal `selectedKey` via `resolveSingleValue` (handles plain T and Traited) |
| `src/renderer/uikit/ListBox/ListBox.story.tsx` | Update — demo state holds `IListBoxItem \| null` instead of primitive |
| `src/renderer/editors/browser/UrlSuggestionsDropdown.tsx` | Update — `onChange` reads `item.value` instead of receiving the primitive directly |
| `src/renderer/uikit/Select/Select.tsx` | New — main component |
| `src/renderer/uikit/Select/useSelectItems.ts` | New — async loader hook (port of legacy `useSelectOptions`) |
| `src/renderer/uikit/Select/Select.story.tsx` | New — storybook entry, includes `itemsMode` async demo |
| `src/renderer/uikit/Select/index.ts` | New — barrel |
| `src/renderer/uikit/index.ts` | Add Select export |
| `src/renderer/editors/storybook/storyRegistry.ts` | Register `selectStory` |

---

## Concerns / Open questions

### 1. Generic typing on `Select<T>`

Following ListBox's pattern: `Select<T = IListBoxItem>` with the same `forwardRef` cast. Confirmed — same shape that ListBox already uses (`src/renderer/uikit/ListBox/ListBox.tsx:349`).

### 2. Chevron `tabIndex={-1}`

The chevron's IconButton has `tabIndex={-1}` so Tab from the input proceeds to the next form field, not into the chevron. The chevron is reachable via mouse and via the input's keyboard handlers — it does not need its own tab stop. Same convention as legacy ComboTemplate.

### 3. When `value`'s key matches no row in `items`

Resolved by design: `value` is fully self-describing (plain `T = IListBoxItem` carries `.label` directly; `Traited<T>` carries its own accessor in `value.traits`). The trigger derives the label from `value` alone — no `items` lookup. The list checkmark simply does not appear when no row has the matching `.value` key. This is the intended behavior for async loading and for orphaned values: Select mounts with a known selection, `items` is still empty (loader not invoked yet, or in flight, or the matching row has been removed), and the user sees the right label immediately.

### 4. Selecting an item whose `label` is a non-string ReactNode

`displayText` falls back to `String(value)` when `selectedItem.label` is not a string. This is rare — most callers use string labels — but the fallback prevents `[object Object]` from rendering in the input.

### 5. `readOnly` vs `disabled`

- `disabled`: input cannot be focused, popover never opens, chevron is dimmed (Input passes `data-disabled` and the IconButton receives `disabled`).
- `readOnly`: input is focusable so the user can copy the selected text, but typing does nothing, popover never opens, chevron is dimmed but visible.

### 6. Async items loading — in scope

`items` accepts four forms (see Step 4 / `useSelectItems`): sync array, sync `Traited`, bare `Promise`, function returning either, and function returning a Promise. Sync forms are resolved immediately; async forms are deferred until the first `open` (`Array.isArray` or `isTraited` short-circuits the gate). The loader runs once and the result is cached; changing the `items` reference invalidates the cache.

This pattern is ported from legacy `useSelectOptions` (`src/renderer/components/form/utils.ts:64`) — the same shape callers already use today via `ComboSelect.selectFrom`. Building it in from the start (a) preserves parity with the legacy combobox so consumer migrations are mechanical, (b) keeps the expensive `entities.map(...)` out of the render path until the popover actually opens, and (c) makes the async path testable from day one rather than retrofitted later.

Errors surface via the optional `onItemsLoadError` callback. Select itself does not render an inline error state in v1; the caller can react to the callback to show a toast or fallback UI. A built-in error row is a follow-up if usage shows it's needed.

### 7. Free-text mode

Out of scope. Free-text combos (where the user can submit arbitrary text not in the list) are a different UX shape (autocomplete). A follow-up task — name TBD, working name `Autocomplete` — can deliver that. Free-text legacy consumers stay on `ComboSelect` until then.

### 8. Should we extract `useCombobox` / `ComboTemplate` now?

**No.** Decision recorded: with one consumer, abstraction is premature. When a second combobox-shaped consumer arrives (likely `MultiSelect` for tag fields), a follow-up task can extract the shared trigger/popover/keyboard glue. Building `Select` directly first lets us see exactly which parts generalize.

### 9. Outside-click race with chevron toggle

Tested mental model: when the popover is `open` and the user clicks the chevron, the Popover's `mousedown` outside-click handler fires first; without `outsideClickIgnoreSelector`, that closes the popover, then the chevron's `click` reopens it — a flicker. Fix: pass `outsideClickIgnoreSelector` matching the Select's input wrapper (using a unique `data-id={selectId}`) so clicks on the input itself or chevron pass through. Verified pattern works for nested Tooltips inside Popovers (commit `2ea8244`).

---

## Acceptance criteria

**ListBox redesign (Step 1):**
- [ ] `ListBoxProps.value` accepts `T | Traited<T> | null`; `onChange` emits the source `T`.
- [ ] Selecting a row in `ListBox.story.tsx` updates the demo state with the full `IListBoxItem`.
- [ ] `UrlSuggestionsDropdown.tsx` still works end-to-end (selection in the URL bar still navigates).
- [ ] Setting `value` to an item not present in `items` does not throw and does not render a checkmark.
- [ ] Setting `value` to a `Traited<T>` whose `traits.get(LIST_ITEM_KEY)` returns an accessor renders the checkmark on the matching row by key equality.

**Select (Steps 2–10):**
- [ ] `<Select items={...} value={v} onChange={setV} />` renders, opens on focus/click/keyboard, and selects items by mouse and by Enter.
- [ ] Typing in the input filters the visible items (default: `contains`, case-insensitive).
- [ ] ArrowUp/Down move the active row; Enter selects the active row.
- [ ] Escape closes the popover; outside click closes the popover; chevron click toggles the popover.
- [ ] Selecting an item closes the popover, clears the search, returns focus to the input, fires `onChange(item)` with the full source item.
- [ ] Popover width matches input width (`matchAnchorWidth`).
- [ ] When closed, the input shows the selected item's label (or placeholder if none) — **including when `items` has not been loaded yet** (label comes from `value` directly).
- [ ] When open, the input shows the user's live query.
- [ ] `disabled` blocks all interaction; `readOnly` allows focus but blocks editing and opening.
- [ ] Storybook entry covers itemCount=0 (empty), itemCount=5 (small), itemCount=1000 (virtualized), and `filterMode` switching.

**Async items (Step 4 / `useSelectItems`):**
- [ ] `items: T[]` and `items: Traited<T[]>` resolve synchronously on mount.
- [ ] `items: () => T[]` is **not** invoked until first open; called exactly once thereafter; result cached.
- [ ] `items: () => Promise<T[]>` defers, awaits on first open, sets `loading=true` while pending, displays the ListBox spinner row, settles to the loaded items.
- [ ] `items: Promise<T[]>` awaits eagerly; loading spinner shown while pending if user opens before resolution.
- [ ] Changing the `items` reference invalidates the cache and reloads on next open.
- [ ] A rejected loader Promise calls `onItemsLoadError` and leaves the list empty (no crash, no infinite loading).
- [ ] With `value` set + async `items`, the trigger label renders correctly **before** the loader is invoked.

**Build:**
- [ ] `npx tsc --noEmit` clean for the changed files.
- [ ] `npm run lint` clean for the changed files.
