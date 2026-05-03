# US-474: UIKit PathInput — hierarchical-path text field with autocomplete

**Epic:** EPIC-025 (Phase 4 — form infrastructure)
**Blocks:** US-432 Phase 4 (EditLinkDialog category + tag-add inputs)
**Status:** Planned

---

## Goal

Build the UIKit `PathInput` primitive: a single-line text input with a popover suggestion list driven by a flat array of separator-delimited paths (e.g. `"work/projects/persephone"`). Suggestions show one segment at a time — folder rows append the separator and keep the input in edit mode; leaf rows commit and close. Used by `EditLinkDialog` for the **Category** field (separator `/`) and the **Tag-add** field (separator `:`, `maxDepth=1`).

Built by composing `Input` + `Popover` + `ListBox` — no new low-level abstractions. Same composition shape as `Select`, but the data model is tree-shaped paths, not a flat item list, and the trigger is committed on `Enter` / `Tab` / blur rather than only via the dropdown.

---

## Background

### What PathInput replaces

The legacy implementation is `src/renderer/components/basic/PathInput.tsx` (455 lines). It uses the legacy `Popper` overlay, a hand-rolled inline `<input>` with custom focus/blur dance, and a `TComponentModel` for state. The only consumer in the app is `src/renderer/editors/link-editor/EditLinkDialog.tsx` — both for the Category field (line 303) and the Tag-add field (line 338, used as a single-segment autocomplete with `separator=":"`, `maxDepth=1`).

| Legacy | UIKit |
|--------|-------|
| `<input className="path-input-field">` | `Input` (US-440) |
| `Popper` | `Popover` (US-466) |
| inline `<div className="suggestion-item">` rows | `ListBox` (US-468) with custom `renderItem` |
| `clsx`, `styled.*` for app code | tokens + `data-*` attributes |

### Suggestion semantics (preserved verbatim from legacy)

The suggestion algorithm is bespoke — copy it verbatim from `PathInput.tsx:317-382` (`getSuggestions`) into a pure helper. Behavior:

1. Find the last `separator` in the current `value`. Everything up to (and including) that separator is the **prefix** (already-typed levels). Everything after is the **current segment** (what the user is typing now at this level).
2. From `paths`, keep only those that:
   - Start with the `prefix` (case-insensitive), AND
   - Whose remainder (post-prefix) starts with the `currentSegment` (case-insensitive).
3. For each kept path, look at its remainder:
   - If it contains another separator → emit a **folder** suggestion: `path = prefix + remainder.slice(0, nextSepIndex)`, `label = remainder.slice(0, nextSepIndex)`, `isFolder = true`. Folder suggestions are deduped by `path`.
   - Else → emit a **leaf** suggestion: `path = full input path`, `label = remainder`, `isFolder = false`.
4. Sort folders first, then alphabetically by `label`.
5. Each suggestion also carries `matchPrefix = prefix` so the row UI can render the muted prefix + bold current segment.

### `maxDepth` rule (preserved verbatim from legacy)

When `maxDepth` is set:
- Count the segments in the current value: `segmentCount = value.split(separator).length`.
- If `value` ends with a separator, the next level hasn't started — `effectiveDepth = segmentCount - 1`. Otherwise `effectiveDepth = segmentCount`.
- If `effectiveDepth > maxDepth` → return empty suggestions (popover closes implicitly because `open && suggestions.length > 0` is false).

For the tag-add field: `separator=":"`, `maxDepth=1`. A tag like `"hobby:photography"` has `effectiveDepth=2 > 1` so the popover hides — preventing further drill-down beyond a single colon-delimited segment.

### Folder vs leaf selection (preserved verbatim from legacy)

- **Folder selected** (click, Enter on highlight, or Tab on highlight): append `separator` to the path, call `onChange(folderPath + separator)`, refocus the input, **do not** call `onBlur`. The input stays in edit mode at the next level.
- **Leaf selected** (same triggers, on a non-folder row): call `onChange(leafPath)`, close popover, **call `onBlur(leafPath)`**. The input commits.

### Commit semantics (preserved verbatim from legacy)

`onBlur(finalValue?: string)` is the **commit** event. It fires exactly once per edit session, with one of:
- The **picked leaf path** (string) — the user selected a leaf from the list.
- The **typed value** (string) — the user pressed `Enter` with no highlight, and the value is non-empty and does not end in `separator`.
- The **current value** (string) — the input lost focus naturally (blur).
- `undefined` — the user pressed `Escape` while the popover was closed (cancel from edit mode); or pressed `Enter` on an empty/separator-trailing value with no highlight (no commit).

The legacy uses two flags (`selectionMade`, `escapeCancelled`) to suppress double-blur calls when a selection or escape already invoked `onBlur`. UIKit preserves this guard via the same flag pattern (instance refs inside the component).

`Escape` while open: closes the popover but stays in the input. `Escape` while closed: blurs the input and calls `onBlur(undefined)`.

### EditLinkDialog usage (the migration target)

For reference — `EditLinkDialog.tsx:303-348`:

```tsx
{/* Category */}
<PathInput
    className="form-field"
    value={state.category}
    onChange={model.setCategory}
    onBlur={model.setCategoryFromBlur}
    paths={state.categories}
    separator="/"
    placeholder="Category path..."
/>

{/* Tags (the row also renders existing tag chips before this input) */}
<PathInput
    className="tag-add-input"
    value={state.newTag}
    onChange={model.setNewTag}
    onBlur={model.addTagFromBlur}
    paths={state.availableTags}
    separator=":"
    maxDepth={1}
    placeholder="Type + Enter to add"
/>
```

The model handlers (lines 200-236):
- `setCategoryFromBlur(finalValue?)` — writes `finalValue` to state when defined, else no-op.
- `addTagFromBlur(finalValue?)` — when `finalValue=undefined`, clears `newTag`; else trims, strips trailing `:`, pushes to `tags` if not present, clears `newTag`.

UIKit `PathInput` must keep the same `onBlur(finalValue?)` contract so these handlers continue to work as-is during US-432 Phase 4 migration (the migration is just the import path swap + dropping the `className`).

### EPIC-025 rules in scope

- **Rule 1 (data attributes):** root `data-type="path-input"`; `data-disabled`, `data-readonly`, `data-state="open"|"closed"`.
- **Rule 2 (controlled):** caller owns `value`. Internal transient state allowed: `open`, `activeIndex`.
- **Rule 7 (no Emotion outside UIKit):** `Omit<..., "style" | "className">`.
- **Naming:** boolean adjectives (`disabled`, `readOnly`), `value`/`onChange`/`onBlur` consistent with `Input`.

### What `searchText` highlighting does NOT do here

Unlike `Select`, suggestions in `PathInput` don't need `<mark>`-style token highlighting. The visual is two-tone instead: the **matchPrefix** part (already-typed levels, e.g. `"work/projects/"`) renders in a muted color, and the **label** (current segment + separator marker for folders) renders in the default text color. This is implemented by a custom `renderItem` passed to `ListBox` that constructs each row from the `matchPrefix` + `label` + (separator if folder) parts.

---

## API

```ts
export interface PathInputProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className" | "onChange"> {
    /** Current path value. */
    value: string;
    /** Live-update handler — fires on every keystroke and on folder selection. */
    onChange: (value: string) => void;
    /** Available paths used to derive suggestions. */
    paths: string[];
    /** Path separator. Default: "/". */
    separator?: string;
    /** Placeholder shown when value is empty. */
    placeholder?: string;
    /**
     * Commit handler — fires once per edit session when the input commits or cancels.
     *   • leaf-selection: `finalValue = leaf path`
     *   • Enter on typed value: `finalValue = value`
     *   • blur: `finalValue = current value`
     *   • Escape (popover already closed) or Enter on empty/separator-trailing value: `finalValue = undefined`
     * Folder selection does NOT fire onBlur — the input keeps editing.
     */
    onBlur?: (finalValue?: string) => void;
    /** Auto-focus on mount with caret at end. Default: false. */
    autoFocus?: boolean;
    /**
     * Maximum number of separator-delimited segments. When the input has more
     * segments than this, suggestions are hidden. Used for shallow autocomplete
     * (e.g. `separator=":"`, `maxDepth=1` for single-segment tag namespaces).
     */
    maxDepth?: number;
    /** Disabled state — input cannot be focused, popover never opens. */
    disabled?: boolean;
    /** Read-only state — input is focusable, but typing/popover are blocked. */
    readOnly?: boolean;
    /** Control size. Default: "md". */
    size?: "sm" | "md";
    /** Forwarded to the underlying input. */
    "aria-label"?: string;
    "aria-labelledby"?: string;
}
```

---

## Implementation plan

### Step 1 — Create `src/renderer/uikit/PathInput/suggestions.ts`

Pure helper, no React. Port from legacy `getSuggestions` (`PathInput.tsx:317`).

```ts
export interface PathSuggestion {
    /** Full path that selecting this row would commit (or the folder path before the trailing separator). */
    path: string;
    /** Display label — the next segment (e.g. `"persephone"` for `path = "work/projects/persephone"`). */
    label: string;
    /** When true, selecting appends the separator and keeps the input in edit mode. */
    isFolder: boolean;
    /** Already-typed prefix (e.g. `"work/projects/"`) — rendered muted before the label. */
    matchPrefix: string;
}

export function getPathSuggestions(
    input: string,
    paths: string[],
    separator: string,
): PathSuggestion[] {
    const lastSepIndex = input.lastIndexOf(separator);
    const currentPrefix = lastSepIndex >= 0 ? input.slice(0, lastSepIndex + 1) : "";
    const currentSegment = lastSepIndex >= 0 ? input.slice(lastSepIndex + 1) : input;
    const currentSegmentLower = currentSegment.toLowerCase();
    const map = new Map<string, PathSuggestion>();

    for (const path of paths) {
        const pathLower = path.toLowerCase();
        if (currentPrefix && !pathLower.startsWith(currentPrefix.toLowerCase())) continue;
        const remaining = path.slice(currentPrefix.length);
        if (currentSegmentLower && !remaining.toLowerCase().startsWith(currentSegmentLower)) continue;

        const nextSepIndex = remaining.indexOf(separator);
        if (nextSepIndex >= 0) {
            const folderPath = currentPrefix + remaining.slice(0, nextSepIndex);
            if (!map.has(folderPath)) {
                map.set(folderPath, {
                    path: folderPath,
                    label: remaining.slice(0, nextSepIndex),
                    isFolder: true,
                    matchPrefix: currentPrefix,
                });
            }
        } else if (!map.has(path)) {
            map.set(path, {
                path,
                label: remaining,
                isFolder: false,
                matchPrefix: currentPrefix,
            });
        }
    }

    return Array.from(map.values()).sort((a, b) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        return a.label.localeCompare(b.label);
    });
}

/** Returns true when `value`'s effective depth exceeds `maxDepth`. */
export function exceedsMaxDepth(value: string, separator: string, maxDepth: number | undefined): boolean {
    if (maxDepth === undefined || !value) return false;
    const segmentCount = value.split(separator).length;
    const effectiveDepth = value.endsWith(separator) ? segmentCount - 1 : segmentCount;
    return effectiveDepth > maxDepth;
}
```

### Step 2 — Create `src/renderer/uikit/PathInput/PathInput.tsx`

Skeleton:

```tsx
import React, {
    forwardRef, useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { spacing } from "../tokens";
import { Input } from "../Input";
import { Popover } from "../Popover";
import { ListBox, IListBoxItem } from "../ListBox";
import { getPathSuggestions, exceedsMaxDepth, PathSuggestion } from "./suggestions";

export interface PathInputProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className" | "onChange"> {
    /* …see API section… */
}

const Root = styled.div(
    {
        display: "flex",
        width: "100%",
        minWidth: 0,
        "&[data-disabled]": { opacity: 0.5, pointerEvents: "none" },
    },
    { label: "PathInput" },
);

const SuggestionRow = styled.div(
    {
        display: "flex",
        alignItems: "center",
        gap: 0,
        height: "100%",
        paddingLeft: spacing.md,
        paddingRight: spacing.md,
        cursor: "pointer",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        color: color.text.default,
        "& [data-part='prefix']": { color: color.text.light },
        "& [data-part='separator']": { color: color.text.light },
        "&[data-active]": {
            backgroundColor: color.background.selection,
            "& [data-part='prefix'], & [data-part='separator']": {
                color: color.text.strong,
            },
        },
    },
    { label: "PathInputSuggestionRow" },
);

export const PathInput = forwardRef<HTMLInputElement, PathInputProps>(function PathInput(
    {
        value, onChange, paths, separator = "/", placeholder, onBlur, autoFocus,
        maxDepth, disabled, readOnly, size = "md",
        "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy, ...rest
    },
    ref,
) {
    /* …see Steps 3-7… */
});
```

### Step 3 — Suggestions, derived state, and `IListBoxItem` shaping

```tsx
const suggestions = useMemo<PathSuggestion[]>(() => {
    if (exceedsMaxDepth(value, separator, maxDepth)) return [];
    return getPathSuggestions(value, paths, separator);
}, [value, paths, separator, maxDepth]);

const items = useMemo<IListBoxItem[]>(() =>
    suggestions.map((s) => ({
        value: s.path,
        label: (
            <SuggestionRow data-active={undefined}>
                {s.matchPrefix && <span data-part="prefix">{s.matchPrefix}</span>}
                <span data-part="segment">{s.label}</span>
                {s.isFolder && <span data-part="separator">{separator}</span>}
            </SuggestionRow>
        ),
    })),
    [suggestions, separator],
);
```

The `IListBoxItem` `label` is a ReactNode here (not a string) — `ListBox` renders it as-is. Each row's active state is driven via `data-active={active || undefined}` inside a custom `renderItem`:

```tsx
const renderItem = useCallback(
    ({ item, active, id }: ListItemRenderContext<IListBoxItem>) => (
        <div role="option" id={id} data-active={active || undefined} style={{ height: "100%" }}>
            {item.label}
        </div>
    ),
    [],
);
```

…actually use the simpler approach: skip `renderItem` and instead set `data-active` on the row inside the `label` ReactNode by deriving it from `activeIndex`. Cleaner: pass `searchText=""` (no highlight), use the default `<ListItem>` which already wires `data-active`, and put the matchPrefix/segment/separator markup directly into `item.label`. Default `<ListItem>` styles tag the row with `data-active` automatically; we don't need a custom renderer.

Final shape: `items` carries `IListBoxItem` rows with the React-node labels (matchPrefix span + segment span + folder separator span). Default `ListItem` handles row chrome (active highlight, padding); the inner spans handle the muted-prefix coloring. This matches how `Select` consumes `ListBox` today.

### Step 4 — Open / close behavior + active index

Internal state:
- `open: boolean`
- `activeIndex: number | null` — `null` when nothing highlighted

Open/close:
- **Open triggers:** `onFocus` on the input, typing (the `onChange` handler sets `open=true`), `ArrowDown`/`ArrowUp` while closed.
- **Close triggers:** outside click (`Popover.onClose`), `Escape` while open, leaf selection.
- **Reset on close:** `activeIndex = null`.
- The popover only renders when `open && items.length > 0`, otherwise the input acts as a plain text field.

```tsx
const [open, setOpen] = useState(false);
const [activeIndex, setActiveIndex] = useState<number | null>(null);

useEffect(() => {
    // Reset highlight when suggestions change.
    setActiveIndex(null);
}, [suggestions]);
```

### Step 5 — Selection commit

```tsx
const selectionMadeRef = useRef(false);
const escapeCancelledRef = useRef(false);
const inputRef = useRef<HTMLInputElement | null>(null);

const setInputRef = useCallback((el: HTMLInputElement | null) => {
    inputRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
}, [ref]);

const selectSuggestion = useCallback((s: PathSuggestion) => {
    if (s.isFolder) {
        onChange(s.path + separator);
        inputRef.current?.focus();
        // Stay open, popover will recompute suggestions for the new level
    } else {
        selectionMadeRef.current = true;
        onChange(s.path);
        setOpen(false);
        onBlur?.(s.path);
    }
}, [onChange, onBlur, separator]);
```

### Step 6 — Keyboard handling on the input

Port `handleKeyDown` from `PathInput.tsx:204`:

```
Closed popover:
  ArrowDown / ArrowUp → setOpen(true), preventDefault
  Escape              → escapeCancelledRef = true; input.blur(); onBlur(undefined)

Open popover:
  ArrowDown → activeIndex++ (wrap to 0 from -1, wrap to 0 at end)
  ArrowUp   → activeIndex-- (wrap to last from -1/0)
  Enter     → if activeIndex valid → selectSuggestion(suggestions[activeIndex])
              else if value !== "" && !value.endsWith(separator) →
                  selectionMadeRef = true; setOpen(false); onBlur(value)
              else (empty or separator-trailing) → no-op
  Tab       → if activeIndex valid → selectSuggestion(...) (preventDefault)
              else → fall through (Tab moves focus naturally → triggers blur)
  Escape    → setOpen(false), preventDefault
```

Mouse hover: `onMouseEnter` on each `<ListBox>` row sets `activeIndex` (driven via `onActiveChange`).

### Step 7 — Blur with selection-suppression dance

```tsx
const handleBlur = useCallback(() => {
    // 150ms grace so suggestion-row mouse clicks register first.
    setTimeout(() => {
        if (selectionMadeRef.current || escapeCancelledRef.current) {
            selectionMadeRef.current = false;
            escapeCancelledRef.current = false;
            return;
        }
        if (!inputRef.current?.contains(document.activeElement)) {
            setOpen(false);
            onBlur?.(value);
        }
    }, 150);
}, [onBlur, value]);
```

The 150ms timeout matches legacy. With UIKit `Popover` rendered in a portal, mouse-down on a suggestion does steal focus from the input — the timeout gives `onClick` a chance to fire `selectSuggestion` (which sets `selectionMadeRef.current = true`) before this blur fallback runs.

### Step 8 — Render: Input + Popover + ListBox

```tsx
<Root
    data-type="path-input"
    data-state={open ? "open" : "closed"}
    data-disabled={disabled || undefined}
    data-readonly={readOnly || undefined}
    {...rest}
>
    <Input
        ref={setInputRef}
        size={size}
        value={value}
        onChange={(v) => {
            onChange(v);
            if (!disabled && !readOnly && !open) setOpen(true);
        }}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        autoFocus={autoFocus}
        onFocus={() => { if (!disabled && !readOnly) setOpen(true); }}
        onBlur={handleBlur}
        onKeyDown={onInputKeyDown}
        autoComplete="off"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-haspopup="listbox"
        aria-expanded={open && items.length > 0}
    />
    <Popover
        open={open && items.length > 0}
        onClose={() => setOpen(false)}
        elementRef={inputRef.current}
        placement="bottom-start"
        offset={[0, 2]}
        matchAnchorWidth
    >
        <ListBox
            items={items}
            activeIndex={activeIndex}
            onActiveChange={setActiveIndex}
            onChange={(item) => {
                const s = suggestions.find((x) => x.path === item.value);
                if (s) selectSuggestion(s);
            }}
            rowHeight={24}
            growToHeight={240}
        />
    </Popover>
</Root>
```

The popover's `outsideClickIgnoreSelector` is **not** needed: `Popover` already ignores clicks on the floating element itself, and `Input`'s `onBlur` handles input-side defocus. (Compare to `Select`, which needed it because the chevron click would race with outside-close — `PathInput` has no chevron, so the only ways to close are Escape, outside click, or commit.)

### Step 9 — `autoFocus` behavior

Forward `autoFocus` to the underlying `<input>` via `Input`'s native pass-through. After mount, if `autoFocus` is set, the browser already focuses the input; we additionally place the caret at the end of the value:

```tsx
useEffect(() => {
    if (autoFocus && inputRef.current) {
        const len = inputRef.current.value.length;
        inputRef.current.setSelectionRange(len, len);
    }
}, [autoFocus]);
```

This matches the legacy `autoFocusIfNeeded` behavior (`PathInput.tsx:170`). The native `autoFocus` attribute fires on mount; the explicit `setSelectionRange` runs after that and positions the caret.

### Step 10 — Storybook entry

`src/renderer/uikit/PathInput/PathInput.story.tsx`. Controls:

- `separator` — enum `"/"`, `":"`, `"."` (default `"/"`)
- `maxDepth` — number (default `0` = unlimited)
- `placeholder` — string
- `disabled` — boolean
- `readOnly` — boolean
- `size` — enum `"sm"`, `"md"`
- `pathSet` — enum `"deep"` (multi-level filesystem-like), `"flat"` (no separators), `"tags"` (`hobby:photography`, `hobby:music`, `work:project1`, …)

Demo wrapper holds `useState<string>("")` for the value and a `useState<string>("")` for "last commit (onBlur)" so the user can see the commit semantics in action.

### Step 11 — Index plumbing

- `src/renderer/uikit/PathInput/index.ts`:
  ```ts
  export { PathInput } from "./PathInput";
  export type { PathInputProps } from "./PathInput";
  export { getPathSuggestions, exceedsMaxDepth } from "./suggestions";
  export type { PathSuggestion } from "./suggestions";
  ```
- `src/renderer/uikit/index.ts` — append:
  ```ts
  export { PathInput } from "./PathInput";
  export type { PathInputProps } from "./PathInput";
  ```
- `src/renderer/editors/storybook/storyRegistry.ts` — import `pathInputStory` from `../../uikit/PathInput/PathInput.story` and append to `ALL_STORIES`.

---

## Concerns / Open questions

### 1. Do we need virtualization?

ListBox virtualizes via `RenderGrid`. Path counts in real Persephone usage are small (categories: ~dozens; tags: ~dozens to low hundreds). Virtualization adds no perceivable cost and aligns with `Select`'s composition pattern, so we use it. No special handling needed.

### 2. `ListBox` `value` semantics — do we pass `null`?

Yes. PathInput is a text input, not a single-value picker; nothing is "selected" in the dropdown — the dropdown is purely a suggestion list. Pass `value={null}` to `ListBox` so no checkmark renders.

### 3. Handling the case where `paths` includes an entry equal to a folder prefix

Example: `paths = ["work", "work/projects", "work/projects/persephone"]`, user types nothing. `getPathSuggestions` produces:
- `"work"` (leaf), `"work"` (folder, deduped to leaf-or-folder by `path` key — folder wins since it's added first if encountered first).

Actually, looking at the legacy: a path is classified by whether the **remainder past the prefix** contains another separator. With `currentPrefix=""` and `path="work"`, remainder is `"work"` with no separator → leaf. With `path="work/projects"`, remainder is `"work/projects"` with separator at index 4 → folder `"work"`. The second `set("work", folder)` runs **after** the first `set("work", leaf)` and overwrites it, but the legacy uses `if (!suggestions.has(path))` → first wins → leaf.

So under the legacy rules, `"work"` from the first path wins as a leaf, and the user can't drill into `"work/projects"` from this row. **Resolution:** preserve legacy behavior verbatim. If a downstream consumer reports the issue we can revisit; not in scope for US-474.

### 4. Single source of truth for `data-active` on suggestion rows

`ListBox`'s default `<ListItem>` already sets `data-active` on the row chrome. The matchPrefix/segment muted-color rule is defined inside the `SuggestionRow` styled — but if we put the spans inside `IListBoxItem.label`, they live inside the default `<ListItem>` and have no opportunity to react to the row's active state.

**Resolution:** use a custom `renderItem` for `ListBox` that wraps the label content in a row whose `data-active` mirrors the active state. The custom renderer does not replace the default — it's only used in `PathInput`. The `SuggestionRow` styled lives inside `PathInput.tsx` and selects via `&[data-active]`.

```tsx
const renderItem = useCallback(
    (ctx: ListItemRenderContext<IListBoxItem>) => (
        <SuggestionRow
            id={ctx.id}
            data-active={ctx.active || undefined}
            data-selected={ctx.selected || undefined}
            onMouseDown={(e) => e.preventDefault() /* keep input focus */}
            onClick={() => {
                const s = suggestions[ctx.index];
                if (s) selectSuggestion(s);
            }}
            onMouseEnter={() => setActiveIndex(ctx.index)}
        >
            {ctx.item.label}
        </SuggestionRow>
    ),
    [suggestions, selectSuggestion],
);
```

Note `onMouseDown.preventDefault()` so clicking a row does **not** blur the input — without this, the 150ms blur-grace dance would have to do all the heavy lifting. With it, the click handler runs while focus stays on the input, and `selectionMadeRef.current = true` is set synchronously before any blur could fire.

### 5. Tag-add field with empty `value`

When `value=""` and the user opens the popover (focus), suggestions show all top-level paths up to the next separator. For tags with `separator=":"` and `paths=["hobby:music", "hobby:photography", "work:p1"]`, the top-level suggestions become folders `"hobby"` and `"work"` — exactly what we want (the user picks a namespace, then types the leaf, then Enters to add).

For an unprefixed tag like `"react"` with no colon, the user types it whole and presses Enter → `onBlur("react")` fires → `addTagFromBlur("react")` runs → tag added. No popover interaction needed. Verified the legacy supports this; new implementation must preserve it.

### 6. `Popover` close-on-outside-click vs leaf commit race

When the user clicks a leaf row:
1. `mousedown` on the row — `onMouseDown.preventDefault()` keeps input focus, also stops the `Popover`'s outside-click from firing (the click target is inside the popover, not outside).
2. `click` on the row — `selectSuggestion` runs synchronously.

Outside-click only fires for clicks landing outside the popover. Confirmed safe.

### 7. Migration of the legacy consumer

`EditLinkDialog` migration is the responsibility of US-432 Phase 4. UIKit `PathInput` ships with its own story; the actual consumer migration (drop `className`, change import path) happens later. Keep legacy `src/renderer/components/basic/PathInput.tsx` untouched in this task.

---

## Acceptance criteria

- [ ] `<PathInput value={v} onChange={setV} paths={p} separator="/" />` renders as an `Input` with a popover suggestion list driven by `paths`.
- [ ] Folder rows show muted prefix + segment + muted separator marker; leaf rows show muted prefix + segment.
- [ ] Selecting a folder appends `separator` to value, keeps focus on input, **does not** call `onBlur`.
- [ ] Selecting a leaf sets value to the leaf path, closes popover, calls `onBlur(leafPath)`.
- [ ] `Enter` on a typed value (no highlight, value non-empty, not separator-trailing) commits via `onBlur(value)`.
- [ ] `Enter` on empty / separator-trailing value with no highlight: no-op.
- [ ] `Tab` on a highlighted folder commits the folder (append separator); `Tab` with no highlight: native blur → `onBlur(value)`.
- [ ] `Escape` while open closes popover. `Escape` while closed blurs input → `onBlur(undefined)`.
- [ ] `ArrowDown` / `ArrowUp` opens popover (when closed) or moves `activeIndex` (when open).
- [ ] Mouse hover sets `activeIndex` to the hovered row.
- [ ] `maxDepth=N`, value with `>N` segments → popover does not render even if `paths` would generate suggestions.
- [ ] `disabled` blocks all interaction; `readOnly` allows focus and selection but blocks typing/popover.
- [ ] `autoFocus=true` mounts focused with caret at end of `value`.
- [ ] No `style=` / `className=` accepted by TypeScript on `<PathInput>`.
- [ ] Storybook entry covers: deep paths (`/`), single-level tags (`:`, `maxDepth=1`), empty paths, disabled, readOnly, both sizes.
- [ ] `npx tsc --noEmit` clean for changed files; `npm run lint` clean.

---

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/uikit/PathInput/PathInput.tsx` | New — main component (Input + Popover + ListBox composition) |
| `src/renderer/uikit/PathInput/suggestions.ts` | New — `getPathSuggestions`, `exceedsMaxDepth` pure helpers |
| `src/renderer/uikit/PathInput/PathInput.story.tsx` | New — Storybook entry with separator/maxDepth/disabled/readOnly/size controls |
| `src/renderer/uikit/PathInput/index.ts` | New — barrel export |
| `src/renderer/uikit/index.ts` | Update — append `PathInput` exports |
| `src/renderer/editors/storybook/storyRegistry.ts` | Update — register `pathInputStory` |

### Files NOT changed

- `src/renderer/components/basic/PathInput.tsx` — legacy implementation stays until US-432 Phase 4 migrates `EditLinkDialog` to the UIKit version.
- `src/renderer/editors/link-editor/EditLinkDialog.tsx` — migration is part of US-432 Phase 4, not US-474.
- `src/renderer/uikit/Input/Input.tsx` — existing surface is sufficient.
- `src/renderer/uikit/Popover/Popover.tsx` — `matchAnchorWidth` already does what we need.
- `src/renderer/uikit/ListBox/ListBox.tsx` — `renderItem` is the documented extension point; no API change needed.
