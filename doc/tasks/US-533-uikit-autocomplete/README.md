# US-533: UIKit `Autocomplete` primitive — free-text input with suggestions dropdown

## Status

**Implemented — awaiting user testing + epic-close review.** Part of
[EPIC-025](../../epics/EPIC-025.md) Phase 4 UIKit primitive infrastructure.

`tsc` baseline unchanged (20 pre-existing errors in automation/commands,
video/VideoPlayerEditor, scripting/worker, ui/tabs/PageTab); zero new lint
warnings or errors. Storybook entry registered under the "Lists" section
with knobs for items mode (string list / icon items / pre-filtered),
filterMode, openOnFocus, onSubmit, header + headerAction, emptyMessage,
and size / disabled / readOnly / width.

Primitive only — no retrofits in this task. Per
[memory feedback `feedback_uikit_primitive_with_retrofit.md`]: ship new UIKit
primitives alone so per-screen user testing stays scoped to one screen at a
time. Adoption tasks:

- **Unblocks [US-501](../US-501-rest-client-migration/README.md)** —
  KeyValueEditor header-name field replaces `ComboSelect freeText` with
  `Autocomplete`.
- Future per-screen task (not blocking): migrate `editors/browser/` URL bar
  + `UrlSuggestionsDropdown` from its hand-rolled `Input + Popover + ListBox`
  composition (`BrowserUrlBarModel.ts`, 262 lines) to `Autocomplete`. The
  Browser stays on its current composition until then.

## Goal

Add a new UIKit primitive `Autocomplete` — a string-valued input bound to a
popover dropdown of suggestions. The typed value is the canonical value;
items are non-binding suggestions that auto-complete when picked.

The shape sits between two existing primitives:

| Primitive | Value type | Items meaning | Typing arbitrary text |
|---|---|---|---|
| `Input` | `string` | n/a | accepted, no dropdown |
| **`Autocomplete` (new)** | `string` | suggestions (filter or fixed) | **accepted; dropdown lists matches** |
| `Select<T>` | `T \| null` | the source of truth | rejected (cleared on close) |

After this task, screens that today combine `Input` + `Popover` + `ListBox`
by hand (Browser URL bar in `BrowserUrlBarModel`) and screens that today abuse
the legacy `ComboSelect freeText` flag (KeyValueEditor in US-501) have a
single primitive to adopt.

## Background

### Pattern audit — existing free-text-combobox call sites

**1. Browser URL bar (`editors/browser/`)** — extracted shape:
- View (`BrowserEditorView.tsx:522-540`) — UIKit `Input` wrapped in
  `<Panel data-url-bar="">` so the suggestions popover can anchor via
  `closest('[data-url-bar]')`.
- View (`BrowserEditorView.tsx:703-711`) — `UrlSuggestionsDropdown` renders a
  `Popover + Panel(header) + ListBox` anchored to the URL bar Panel.
- View companion (`UrlSuggestionsDropdown.tsx`, 78 lines) — composes
  Popover/Panel/ListBox with a "Search History" / "Navigation History"
  header label and an optional "Clear" button.
- Logic (`BrowserUrlBarModel.ts`, 262 lines) — manual orchestration: 
  `suggestionsOpen` flag, `hoveredIndex` navigation, ArrowDown/Up/Enter/Escape
  in `handleUrlKeyDown`, focus opens / blur closes, suggestion filtering
  (search history vs nav history), `handleSuggestionSelect` commits the
  value and triggers `model.navigate(value)`, `Enter` without a highlighted
  item also navigates.

**2. KeyValueEditor header-name field (`editors/rest-client/KeyValueEditor.tsx`)**:
- Today uses legacy `ComboSelect freeText` with `selectFrom={COMMON_HEADERS}`.
- Free-text string-valued input with autocomplete suggestions (no submit
  action; `Tab` moves to the next field as a soft commit).

**3. Legacy `components/data-grid/AVGrid/DefaultEditFormater.tsx`** — also a
`ComboSelect freeText` consumer. Out of scope here; a future cleanup task can
adopt `Autocomplete` if desired.

### Why a new primitive (not a `Select` extension)

`Select<T>` is item-driven: value is `T | null`, the typed text is a
transient filter query that is cleared on close, and arbitrary text never
becomes the value. Bolting `freeText` onto `Select` either fights its model
(branchy `if (freeText)` everywhere) or yields a misleadingly-named API
("Select" but it isn't selecting).

A dedicated `Autocomplete` is the W3C WAI-ARIA `combobox` pattern with the
"list" autocomplete behaviour — the value is the editable text, items
non-bindingly help the user complete it.

### Naming

User-chosen: **`Autocomplete`**. (Alternatives considered: `Combobox` — the
W3C term — and `SuggestInput`. Material UI uses `Autocomplete` for this
exact pattern, so consumer-facing familiarity wins.)

## Implementation plan

### File layout

```
src/renderer/uikit/Autocomplete/
    Autocomplete.tsx
    AutocompleteModel.ts
    Autocomplete.story.tsx
    index.ts
```

Plus barrel export from `src/renderer/uikit/index.ts`.

### Public API

```ts
// AutocompleteModel.ts — public types

export interface AutocompleteProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className" | "onChange" | "onSubmit"> {
    /** Optional debug label emitted as `data-name` on the root element. */
    name?: string;

    /** Current text value. The component is fully controlled. */
    value: string;
    /** Fires on every keystroke and on suggestion commit. */
    onChange: (value: string) => void;

    /** Suggestion sources. Accepts a flat string list (sugar) or IListBoxItem[] for
     *  richer rendering (icons, labels). */
    items: string[] | IListBoxItem[];

    /** Filter mode for typeahead against `items`. Default: "contains".
     *  When suggestions are pre-filtered upstream (e.g. Browser URL bar's
     *  search-history filter), set to "off". */
    filterMode?: "contains" | "startsWith" | "off";
    /** Custom filter — overrides `filterMode` when set. */
    filter?: (item: IListBoxItem, query: string) => boolean;

    /** Open the dropdown automatically when the input receives focus. Default: false.
     *  KeyValueEditor: false (open on first keystroke). Browser URL bar: true. */
    openOnFocus?: boolean;
    /** Fires when the user presses Enter with no highlighted suggestion. Use for
     *  "submit"-style flows (Browser URL bar → navigate). Receives the current value. */
    onSubmit?: (value: string) => void;
    /** Fires when the user presses Escape. Receives the value at the moment Escape was
     *  pressed (useful for "revert to original" patterns like the Browser URL bar). */
    onEscape?: (value: string) => void;

    /** Optional header row above the suggestions list. Used by the Browser URL bar for
     *  "Search History" / "Navigation History" labels. */
    header?: React.ReactNode;
    /** Optional action rendered at the trailing edge of the header row. Used by the
     *  Browser URL bar for a "Clear" button. */
    headerAction?: React.ReactNode;
    /** Empty-state node when there are zero matching suggestions. When omitted, the
     *  popover closes instead of rendering an empty list. */
    emptyMessage?: React.ReactNode;

    /** Inner Input passthroughs */
    placeholder?: string;
    disabled?: boolean;
    readOnly?: boolean;
    size?: "sm" | "md";
    autoFocus?: boolean;
    startSlot?: React.ReactNode;
    endSlot?: React.ReactNode;
    width?: number | string;
    minWidth?: number | string;
    maxWidth?: number | string;

    /** Maximum visible rows in the dropdown before it scrolls. Default: 10. */
    maxVisibleItems?: number;
    /** Row height inside the inner ListBox. Default: 24. */
    rowHeight?: number;

    "aria-label"?: string;
    "aria-labelledby"?: string;
}
```

### State shape (model-view per Rule 8)

```ts
export interface AutocompleteState {
    open: boolean;
    activeIndex: number | null;
}
export const defaultAutocompleteState: AutocompleteState = {
    open: false,
    activeIndex: null,
};

export class AutocompleteModel
    extends TComponentModel<AutocompleteState, AutocompleteProps> { /* ... */ }
```

### Behaviour spec

**Opening:**
- `openOnFocus=true` → focus opens the popover; `tryOpen()` guarded by
  `disabled` / `readOnly`.
- `openOnFocus=false` → first keystroke that changes `value` opens the popover.
- Click on input opens (matches `Select` UX).
- Chevron / end-slot click does **not** open by default — `Autocomplete` has
  no chevron; if the caller passes `endSlot` they own its behaviour.

**Filtering:**
- `filterMode="contains"` (default): case-insensitive substring match against
  the item label.
- `filterMode="startsWith"`: case-insensitive prefix match.
- `filterMode="off"`: pass items through unchanged (caller pre-filters —
  Browser URL bar's search-history mode does this).
- `filter` prop overrides `filterMode` entirely when set.
- When `items` is `string[]`, sugar-wrap into `IListBoxItem[]` with
  `{ value: s, label: s }` (model-internal, never exposed in `onChange`).

**Keyboard:**

| Key | When popover closed | When popover open |
|---|---|---|
| ArrowDown / PageDown | open popover, activeIndex=0 | move activeIndex down (PageDown by 9) |
| ArrowUp / PageUp | open popover, activeIndex=last | move activeIndex up (PageUp by 9) |
| Home / End | n/a | jump to first / last |
| Enter | call `onSubmit(value)` if provided; otherwise no-op | if `activeIndex` valid → commit suggestion (`onChange(label)`, close popover); else `onSubmit(value)` if provided, close popover |
| Escape | call `onEscape(value)` if provided | close popover; call `onEscape(value)` if provided |
| Tab | default (move focus) — does NOT commit a highlighted suggestion (Browser URL bar precedent) | same — popover closes via blur |

**Mouse:**
- Click suggestion → commit (`onChange(label)`, close popover, focus stays
  on input).
- Click outside popover and input → close popover (Popover's standard
  outside-click handling).

**Active index initialization:**
- `activeIndex = null` when popover opens — no row pre-highlighted. This
  matches the Browser URL bar behaviour (`hoveredIndex = -1` on focus).
  Differs from `Select`, which highlights the row matching the current value.
  Rationale: `Autocomplete` treats the typed text as the source of truth;
  pre-highlighting a row would suggest pressing Enter commits it, even
  though the user didn't choose it.
- `onActiveChange` (from ListBox hover) updates `activeIndex` so mouse hover
  highlights without committing.

### View composition

```tsx
// Autocomplete.tsx (sketch)
export const Autocomplete = forwardRef<HTMLInputElement, AutocompleteProps>(
    function Autocomplete(props, ref) {
        const model = useComponentModel(props, AutocompleteModel, defaultAutocompleteState);
        const { open, activeIndex } = model.state.use(s => ({ open: s.open, activeIndex: s.activeIndex }));
        const filteredItems = model.filtered.value;

        const {
            name, value, placeholder, disabled, readOnly, size = "md",
            autoFocus, startSlot, endSlot,
            width, minWidth, maxWidth,
            header, headerAction, emptyMessage,
            "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy,
            /* captured (not forwarded), handled via model.props */
            ...rest
        } = props;

        return (
            <Root
                ref={model.setRootRef}
                data-type="autocomplete"
                data-name={name}
                data-state={open ? "open" : "closed"}
                data-disabled={disabled || undefined}
                data-readonly={readOnly || undefined}
                {...rest}
            >
                <Input
                    ref={mergedInputRef(ref, model.setInputRef)}
                    size={size}
                    value={value}
                    onChange={model.onInputChange}
                    placeholder={placeholder}
                    disabled={disabled}
                    readOnly={readOnly}
                    autoFocus={autoFocus}
                    onFocus={model.onInputFocus}
                    onBlur={model.onInputBlur}
                    onClick={model.onInputClick}
                    onKeyDown={model.onInputKeyDown}
                    startSlot={startSlot}
                    endSlot={endSlot}
                    width={width}
                    minWidth={minWidth}
                    maxWidth={maxWidth}
                    aria-haspopup="listbox"
                    aria-expanded={open}
                    aria-autocomplete="list"
                    aria-controls={model.listboxId}
                    aria-label={ariaLabel}
                    aria-labelledby={ariaLabelledBy}
                />
                <Popover
                    open={open && (filteredItems.length > 0 || emptyMessage != null)}
                    onClose={model.onPopoverClose}
                    elementRef={model.rootRef}
                    placement="bottom-start"
                    offset={[0, 2]}
                    matchAnchorWidth
                    outsideClickIgnoreSelector={`[data-type="autocomplete"][data-id="${model.autocompleteId}"]`}
                >
                    {header && (
                        <Panel direction="row" align="center" paddingY="sm" paddingX="md">
                            {header}
                            <Spacer />
                            {headerAction}
                        </Panel>
                    )}
                    <ListBox
                        id={model.listboxId}
                        items={filteredItems}
                        activeIndex={activeIndex}
                        onActiveChange={model.onActiveIndexChange}
                        onChange={model.onListChange}
                        rowHeight={model.rowHeight}
                        growToHeight={model.maxVisibleItems * model.rowHeight}
                        emptyMessage={emptyMessage}
                        keyboardNav={false}
                    />
                </Popover>
            </Root>
        );
    },
);
```

The Root is a `styled.div` (matches the wrapper of other UIKit primitives —
`width: 100%`, flex layout so the inner Input fills the row).

### Storybook

`Autocomplete.story.tsx` — knobs:
- Items mode: simple `string[]` vs `IListBoxItem[]` with icons.
- `filterMode`: "contains" / "startsWith" / "off" (and "off" with a pre-filtered demo).
- `openOnFocus`: toggle.
- `onSubmit`: toggle (shows a status log when Enter fires without a highlighted item).
- Header / headerAction: toggle (renders a "Search History" label + Clear button).
- Empty message: toggle.
- Size: sm / md.
- Width / minWidth / maxWidth: numeric.
- Disabled / readOnly: toggles.

Register the story in `editors/storybook/storyRegistry.ts`.

### Public exports

`src/renderer/uikit/Autocomplete/index.ts`:
```ts
export { Autocomplete } from "./Autocomplete";
export type { AutocompleteProps } from "./Autocomplete";
```

`src/renderer/uikit/index.ts` — add under "Bootstrap components":
```ts
export { Autocomplete } from "./Autocomplete";
export type { AutocompleteProps } from "./Autocomplete";
```

## Concerns / Open questions

### Q1 — Should `Autocomplete` virtualize its dropdown? — Resolved

`ListBox` already virtualizes via `RenderGrid`. `Autocomplete` reuses
`ListBox` as-is, so virtualization is inherited. No work needed here.

### Q2 — `aria-autocomplete="list"` vs `"both"` — Resolved

`list` matches the actual behaviour (suggestions are listed; the input
content is **not** automatically extended to match the highlighted suggestion).
The Browser URL bar today exhibits `list` behaviour. Use `list`.

### Q3 — `onChange` semantics during commit — Resolved

When the user picks a suggestion, the component fires `onChange(label)` to
commit the new value. The view's `value` prop then flips to that label on
the next render. The popover closes synchronously inside `commitSelection`.
No separate `onCommit` callback — `onChange` is sufficient because the
component is fully controlled.

### Q4 — `outsideClickIgnoreSelector` and the Popover

Same pattern as `Select`: the Popover's outside-click handler must ignore
clicks inside the `Autocomplete`'s own root (otherwise focusing the input
would immediately close the popover). Use a unique `data-id` per
Autocomplete instance, derived from `useId()`.

### Q5 — Should `Autocomplete` extend `Select` internally? — Resolved

No. The contract is fundamentally different (value type, commit semantics,
filter semantics, no chevron). Sharing the implementation is brittle and
hides the API difference from consumers. Keep them as two parallel
primitives that both compose `Input + Popover + ListBox`.

### Q6 — Should items support icons? — Resolved

Yes — via `IListBoxItem[]` form. KeyValueEditor passes `string[]` and uses no
icons; the Browser URL bar today renders icons via custom row renderers and
will need a similar opt-in. The sugar form auto-wraps strings; the rich form
is the standard `IListBoxItem` (label + value + icon + disabled).

## Acceptance criteria

- [ ] `npm run lint` clean.
- [ ] `npx tsc -p tsconfig.json --noEmit` reports no new errors.
- [ ] Storybook renders the `Autocomplete` story with all knobs functional:
  - [ ] String-list mode + IListBoxItem-list mode both render.
  - [ ] Typing filters per `filterMode` ("contains" default, "startsWith" prefix-only, "off" pass-through).
  - [ ] `openOnFocus` toggles focus-vs-keystroke open trigger.
  - [ ] Arrow keys navigate; Enter commits highlighted suggestion; Enter without highlight calls `onSubmit`.
  - [ ] Escape closes popover and calls `onEscape`.
  - [ ] Click on a suggestion commits.
  - [ ] Header + headerAction render in the dropdown when provided.
  - [ ] Empty-message renders when no suggestion matches and `emptyMessage` is set; otherwise popover closes.
  - [ ] Disabled / readOnly states render correctly.
- [ ] Existing UIKit consumers untouched — no Storybook regressions.

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at
EPIC-025 close per the epic's deferred review model.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/uikit/Autocomplete/Autocomplete.tsx` | New — View. Composes `Input + Popover + ListBox` per the model. |
| `src/renderer/uikit/Autocomplete/AutocompleteModel.ts` | New — `TComponentModel` subclass with filtering, keyboard handlers, open/close, active-index. |
| `src/renderer/uikit/Autocomplete/Autocomplete.story.tsx` | New — Storybook story with the knob set above. |
| `src/renderer/uikit/Autocomplete/index.ts` | New — barrel export. |
| `src/renderer/uikit/index.ts` | Add `Autocomplete` / `AutocompleteProps` exports. |
| `src/renderer/editors/storybook/storyRegistry.ts` | Register the new story. |

## Files NOT Changed

- `src/renderer/editors/browser/` — Browser URL bar retrofit is deferred to a separate per-screen task.
- `src/renderer/editors/rest-client/KeyValueEditor.tsx` — KV-editor adoption happens in US-501.
- `src/renderer/components/form/ComboSelect.tsx` — legacy; removed by US-532 after all consumers migrate.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — UIKit primitive infrastructure
- Unblocks: [US-501: RestClient editor — UIKit migration](../US-501-rest-client-migration/README.md)
- Pattern reference (primitive shape): `src/renderer/uikit/Select/Select.tsx` + `SelectModel.ts`
- Pattern reference (consumer composition today): `src/renderer/editors/browser/UrlSuggestionsDropdown.tsx` + `BrowserUrlBarModel.ts`
- Memory: `feedback_uikit_primitive_with_retrofit.md` — primitives ship alone; per-screen retrofits live in adoption tasks.
