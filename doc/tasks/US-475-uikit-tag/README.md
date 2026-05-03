# US-475: UIKit Tag and TagsInput — pill primitive + tag-row composite

**Epic:** EPIC-025 (Phase 4 — form infrastructure)
**Blocks:** US-432 Phase 4 (EditLinkDialog tags row migration)
**Status:** Ready for review

---

## Goal

Ship two UIKit primitives:

1. **`Tag`** — a themed pill that replaces the inline `tag-chip` / `tag-badge` styled spans currently scattered across the renderer.
2. **`TagsInput`** — a composite built on top of `Tag` and `PathInput` that owns the *whole* tag-row UX: rendering current tags, the inline add-tag autocomplete input, and add/remove/dedupe glue. Drop-in target for `EditLinkDialog`'s tags row in US-432 Phase 4.

Scope is the **primitives only** — consumer migration is left to the per-screen migration tasks that already track each consumer (e.g. US-432 Phase 4 covers `EditLinkDialog`). This matches how US-466 (Popover), US-468 (ListBox), and US-474 (PathInput) shipped.

---

## Background

### Naming

The EPIC-025 naming table in `src/renderer/uikit/CLAUDE.md` (§ Naming conventions) maps the legacy `Chip` concept to **`Tag`**. New code must use `Tag`.

### Audited consumers

Five existing pill-shaped surfaces in `src/renderer/editors/` plus one outlier (TodoItem). Each is bespoke today; styles diverge in cosmetic ways but the underlying shape is the same: an inline-flex pill with optional remove (×) and/or click handler.

| File | Lines | Style summary | Removable | Clickable | Selected state |
|------|-------|---------------|-----------|-----------|----------------|
| `editors/link-editor/EditLinkDialog.tsx` | 55–73 (`.tag-chip`), 329–339 (JSX) | bg `background.light`, border `border.default`, `padding 2px 6px 2px 8px`, `fontSize 12`, `radius 3`, X always visible | yes (`.tag-remove` always shown) | no | no |
| `editors/notebook/NoteItemView.tsx` | 175–206 (`.tag`), 431–453 (JSX) | bg `background.dark` → `background.light` on hover, `padding 2px 6px`, `radius 3`, X **revealed on hover** | yes (X opacity 0→1 on row hover) | yes (opens edit) | no |
| `editors/notebook/ExpandedNoteView.tsx` | 100–131 (identical to NoteItemView) | same as NoteItemView | yes | yes | no |
| `editors/link-editor/LinkTooltip.tsx` | 44–63 (`.tag-badge`), 130–138 (JSX) | bg transparent + 1px border `border.default`, `padding 1px 7px`, `fontSize 11`, hover → `border.active`, `.active` class fills `background.selection` | no | yes (toggle) | yes (toggle on/off) |
| `editors/todo/components/TodoItemView.tsx` | 167–183 (`.tag-badge`), 425–440 (JSX) | **no bg, no border** — text + colored dot only, `fontSize 11` | no | yes (opens menu) | no |
| `editors/todo/components/TodoListPanel.tsx` | 95–108 (`.tag-dot`, `.color-swatch`) | sidebar list rows with action icons | n/a | n/a | n/a |

**Patterns that fit `Tag`:** EditLinkDialog (filled + removable), NoteItemView/ExpandedNoteView (filled + removable + clickable), LinkTooltip (outlined + toggleable). All three are pill-shaped variations of the same idea.

**Patterns that do NOT fit `Tag` (this task):**
- `TodoItemView.tag-badge` — borderless text + colored dot triggering a popup menu. Different semantic (menu trigger), different visual shape (no pill). Leave bespoke for now; revisit only if a future case shows convergence.
- `TodoListPanel` — sidebar list management UI; not a tag pill at all.

### Token alignment notes

- `fontSize` token scale is `xs=12, sm=12, md=13, base=14, lg=16, …` (`uikit/tokens.ts`). There is no `11`. The CLAUDE.md comment explicitly states 11px is too small in monospace and should not be used. **`Tag` uses `fontSize.xs (12)` for `size="sm"` and `fontSize.sm (12)` for `size="md"`** — both yield 12 today, but the size variant remains meaningful for padding/height and lets us nudge the scale later without an API break.
- `LinkTooltip` currently uses `color.text.muted`, which **does not exist** in `theme/color.ts`. This is a latent bug in `LinkTooltip` (TypeScript doesn't catch it because `color` is typed as `Record<string, string>` via the var-only definition). Out of scope for this task; flag for the LinkTooltip migration step in US-461 / link-editor cleanup.

### Composite scope — why `TagsInput` is in this task and what it covers

`EditLinkDialog` and `NoteItemView` have nearly identical glue around their tag rows: a `newTag` string state, a `PathInput` configured with `:` separator + `maxDepth=1`, an `addFromBlur` handler that trims/strips trailing separator/dedupes, and a `removeTag` handler. Encapsulating this once is the actual reuse win — `Tag` alone leaves the glue duplicated.

**`TagsInput` targets the EditLinkDialog flavour** — current tags + inline add-tag input. It is the component the dialog migration plugs in.

**Out of scope for `TagsInput` v1:**
- **NoteItemView's click-to-edit-existing-tag** (replaces the chip with an inline `PathInput` for that one tag) and its `flex-direction: row-reverse` overflow clipping. NoteItemView stays bespoke until we see whether those quirks are still wanted post-migration.
- **LinkTooltip's toggle picker** (show *all* available tags, mark selected ones active). Different interaction model — would warp the API. Stays bespoke; revisit only if a second toggle-mode consumer appears.

---

## Implementation plan

All file paths are absolute under the repo root.

### Phase 1 — `Tag` primitive

#### 1. `src/renderer/uikit/Tag/Tag.tsx` — new

#### Props

```tsx
export interface TagProps
    extends Omit<
        React.HTMLAttributes<HTMLSpanElement>,
        "style" | "className" | "onClick"
    > {
    /** Tag label — rendered as the primary content. ReactNode allows highlighting helpers. */
    label: React.ReactNode;
    /** Optional leading element (e.g. a colored dot). Renders before the label. */
    icon?: React.ReactNode;
    /** When provided, renders an X button after the label that calls this on click. */
    onRemove?: () => void;
    /** When provided, the tag becomes clickable (cursor: pointer; fires on tag body click). */
    onClick?: () => void;
    /** Toggle/selected state — visually filled with `background.selection`. Default: false. */
    selected?: boolean;
    /** Disabled state — opacity 0.5, pointer-events none. Default: false. */
    disabled?: boolean;
    /** Visual variant. Default: "filled". */
    variant?: "filled" | "outlined";
    /** Size variant. Default: "md". */
    size?: "sm" | "md";
    /** Remove-button visibility. Default: "always". */
    removeAffordance?: "always" | "hover";
    /** Accessible label for the remove button. Default: "Remove tag". */
    removeAriaLabel?: string;
}
```

`onClick` is in the Omit list because the prop is narrowed from `MouseEventHandler` to `() => void` (consumers don't need the event for tag actions).

#### Data attributes (Rule 1)

Root span gets:
- `data-type="tag"` (always)
- `data-variant={variant}` (always)
- `data-size={size}` (always)
- `data-disabled={disabled || undefined}`
- `data-selected={selected || undefined}`
- `data-clickable={onClick && !disabled ? "" : undefined}`
- `data-removable={onRemove ? "" : undefined}`
- `data-remove-affordance={onRemove ? removeAffordance : undefined}`

#### Styled root

```tsx
const Root = styled.span(
    {
        display: "inline-flex",
        alignItems: "center",
        gap: spacing.xs, // 2
        whiteSpace: "nowrap",
        userSelect: "none",
        borderRadius: radius.sm, // 3
        border: "1px solid transparent",
        color: color.text.default,
        backgroundColor: "transparent",

        // Filled
        '&[data-variant="filled"]': {
            backgroundColor: color.background.light,
            borderColor: color.border.default,
        },

        // Outlined
        '&[data-variant="outlined"]': {
            backgroundColor: "transparent",
            borderColor: color.border.default,
        },

        // Sizes — padding tuned to match the audited consumers
        '&[data-size="sm"]': {
            fontSize: fontSize.xs, // 12
            padding: "1px 7px",
            minHeight: 18,
        },
        '&[data-size="md"]': {
            fontSize: fontSize.sm, // 12
            padding: "2px 6px",
            minHeight: 22,
        },

        // Selected (toggle on)
        "&[data-selected]": {
            backgroundColor: color.background.selection,
            color: color.text.selection,
            borderColor: color.border.active,
        },

        // Clickable
        "&[data-clickable]": {
            cursor: "pointer",
            "&:hover": {
                borderColor: color.border.active,
            },
        },

        // Disabled
        "&[data-disabled]": {
            opacity: 0.5,
            pointerEvents: "none",
        },
    },
    { label: "Tag" },
);

const RemoveButton = styled.button(
    {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: "none",
        padding: 0,
        marginLeft: spacing.xs,    // 2
        marginRight: -spacing.xs / 2, // small visual nudge
        cursor: "pointer",
        color: "inherit",
        opacity: 0.6,
        "& svg": { width: 12, height: 12 },
        "&:hover": { opacity: 1 },
        "&:focus-visible": {
            outline: `1px solid ${color.border.active}`,
            outlineOffset: 1,
        },

        // Hover-only affordance: hidden until parent is hovered/focused
        '[data-remove-affordance="hover"] &': {
            opacity: 0,
        },
        '[data-remove-affordance="hover"]:hover &, [data-remove-affordance="hover"]:focus-within &': {
            opacity: 0.6,
            "&:hover": { opacity: 1 },
        },
    },
    { label: "TagRemoveButton" },
);
```

#### Component

```tsx
export function Tag({
    label,
    icon,
    onRemove,
    onClick,
    selected,
    disabled,
    variant = "filled",
    size = "md",
    removeAffordance = "always",
    removeAriaLabel = "Remove tag",
    ...rest
}: TagProps) {
    const handleRemoveClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation(); // prevent parent's onClick when clicking the X
        if (!disabled) onRemove?.();
    };

    const handleRootClick = () => {
        if (!disabled) onClick?.();
    };

    return (
        <Root
            data-type="tag"
            data-variant={variant}
            data-size={size}
            data-disabled={disabled || undefined}
            data-selected={selected || undefined}
            data-clickable={onClick && !disabled ? "" : undefined}
            data-removable={onRemove ? "" : undefined}
            data-remove-affordance={onRemove ? removeAffordance : undefined}
            onClick={onClick ? handleRootClick : undefined}
            {...rest}
        >
            {icon}
            <span>{label}</span>
            {onRemove && (
                <RemoveButton
                    type="button"
                    aria-label={removeAriaLabel}
                    onClick={handleRemoveClick}
                    disabled={disabled}
                >
                    <CloseIcon />
                </RemoveButton>
            )}
        </Root>
    );
}
```

`CloseIcon` import: `from "../../theme/icons"` (same source the existing tag-chip consumers use).

#### 2. `src/renderer/uikit/Tag/Tag.story.tsx` — new

Storybook entry following the pattern set by `PathInput.story.tsx` and `Tooltip.story.tsx`:

- Section: `"Bootstrap"` (matches PathInput, Textarea — form-adjacent primitives)
- Demo: a Panel showing several tags side-by-side with toggleable controls
- Props panel:
  - `label` (string, default `"react"`)
  - `variant` (enum: `"filled" | "outlined"`, default `"filled"`)
  - `size` (enum: `"sm" | "md"`, default `"md"`)
  - `selected` (boolean, default `false`)
  - `disabled` (boolean, default `false`)
  - `removable` (boolean, default `true`) — wire to whether `onRemove` is passed
  - `clickable` (boolean, default `false`) — wire to whether `onClick` is passed
  - `removeAffordance` (enum: `"always" | "hover"`, default `"always"`)
  - `withIcon` (boolean, default `false`) — when true, render a colored dot via `<span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: color.misc.blue }} />`

Use `useState` for a `lastAction` string the demo updates on click/remove and renders below via `<Text size="xs" color="light">last: {lastAction}</Text>`. This proves both handlers fire and X-click does not bubble to the body click.

#### 3. `src/renderer/uikit/Tag/index.ts` — new

```ts
export { Tag } from "./Tag";
export type { TagProps } from "./Tag";
```

### Phase 2 — `TagsInput` composite

#### 4. `src/renderer/uikit/TagsInput/TagsInput.tsx` — new

#### Props

```tsx
export interface TagsInputProps
    extends Omit<
        React.HTMLAttributes<HTMLDivElement>,
        "style" | "className" | "onChange"
    > {
    /** Current tags (the primary value). */
    value: string[];
    /** Called with the next tags array after add or remove. */
    onChange: (tags: string[]) => void;
    /** Available tags fed to the autocomplete (PathInput `paths`). Default: []. */
    items?: string[];
    /** Path separator for autocomplete + trimmed from typed values. Default: ":". */
    separator?: string;
    /** Max depth for autocomplete suggestions. Default: 1. */
    maxDepth?: number;
    /** Placeholder for the add-tag input. Default: "Type + Enter to add". */
    placeholder?: string;
    /** Tag visual variant. Default: "filled". */
    tagVariant?: "filled" | "outlined";
    /** Size — applied to both rendered tags and the inline input. Default: "md". */
    size?: "sm" | "md";
    /** Disabled state — input and remove buttons inert. Default: false. */
    disabled?: boolean;
    /** Read-only — show tags without remove buttons; hide the add-tag input. Default: false. */
    readOnly?: boolean;
    "aria-label"?: string;
}
```

#### Internal state

`useState<string>("")` for the in-flight `newTag` buffer. This is **transient editor state** (committed to the primary value on Enter/blur) and is therefore allowed under Rule 2 (the primary `value` is the tag *array*, not the buffer).

#### Data attributes

Root gets:
- `data-type="tags-input"` (always)
- `data-disabled={disabled || undefined}`
- `data-readonly={readOnly || undefined}`

#### Styled

```tsx
const Root = styled.div(
    {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: spacing.sm,    // 4
        minHeight: 28,
        minWidth: 0,
        "&[data-disabled]": { opacity: 0.5, pointerEvents: "none" },
    },
    { label: "TagsInput" },
);

// PathInput's root is `width: 100%`; the wrapper gives it controllable flex sizing
// inside the wrap container without violating Rule 7 (no style/className from outside).
const InputSlot = styled.div({
    flex: "1 1 100px",
    minWidth: 100,
});
```

#### Behaviour

- **Render** each item of `value` as `<Tag label={tag} variant={tagVariant} size={size} disabled={disabled} onRemove={readOnly ? undefined : () => handleRemove(tag)} />`. `key={tag}` is safe because `value` is deduped.
- **Render** `<InputSlot><PathInput value={newTag} onChange={setNewTag} onBlur={handleAddBlur} paths={items ?? []} separator={separator} maxDepth={maxDepth} placeholder={placeholder} disabled={disabled} size={size} /></InputSlot>` — but only when `!readOnly`.
- **`handleRemove(tag)`** → `onChange(value.filter((t) => t !== tag))`.
- **`handleAddBlur(finalValue?: string)`** (matches PathInput's commit semantics):
  - `finalValue === undefined` (cancel) → `setNewTag("")`, no `onChange`.
  - Trim. Strip a trailing `separator` if present (matches the existing EditLinkDialog logic that strips trailing `:`).
  - If empty after cleaning → `setNewTag("")`, no `onChange`.
  - If `value.includes(cleaned)` → `setNewTag("")`, no `onChange` (silent dedupe).
  - Otherwise → `onChange([...value, cleaned])`, `setNewTag("")`.

#### Component skeleton

```tsx
export function TagsInput({
    value,
    onChange,
    items,
    separator = ":",
    maxDepth = 1,
    placeholder = "Type + Enter to add",
    tagVariant = "filled",
    size = "md",
    disabled = false,
    readOnly = false,
    "aria-label": ariaLabel,
    ...rest
}: TagsInputProps) {
    const [newTag, setNewTag] = useState("");

    const handleRemove = useCallback(
        (tag: string) => onChange(value.filter((t) => t !== tag)),
        [value, onChange],
    );

    const handleAddBlur = useCallback(
        (finalValue?: string) => {
            if (finalValue === undefined) { setNewTag(""); return; }
            const trimmed = finalValue.trim();
            const cleaned = trimmed.endsWith(separator) ? trimmed.slice(0, -1) : trimmed;
            if (cleaned && !value.includes(cleaned)) {
                onChange([...value, cleaned]);
            }
            setNewTag("");
        },
        [value, onChange, separator],
    );

    return (
        <Root
            data-type="tags-input"
            data-disabled={disabled || undefined}
            data-readonly={readOnly || undefined}
            aria-label={ariaLabel}
            {...rest}
        >
            {value.map((tag) => (
                <Tag
                    key={tag}
                    label={tag}
                    variant={tagVariant}
                    size={size}
                    disabled={disabled}
                    onRemove={readOnly ? undefined : () => handleRemove(tag)}
                />
            ))}
            {!readOnly && (
                <InputSlot>
                    <PathInput
                        value={newTag}
                        onChange={setNewTag}
                        onBlur={handleAddBlur}
                        paths={items ?? []}
                        separator={separator}
                        maxDepth={maxDepth}
                        placeholder={placeholder}
                        disabled={disabled}
                        size={size}
                    />
                </InputSlot>
            )}
        </Root>
    );
}
```

Imports: `Tag` from `"../Tag"`, `PathInput` from `"../PathInput"`, `spacing` from `"../tokens"`. No external libs.

#### 5. `src/renderer/uikit/TagsInput/TagsInput.story.tsx` — new

Mirror `Tag.story.tsx` shape:

- Section: `"Bootstrap"`, id `"tags-input"`, name `"TagsInput"`
- Demo holds local `tags: string[]` state (initial `["work:project1", "react"]`) and renders `value: <json>` below the input via `<Text size="xs" color="light">`.
- Two `items` sets: `flat` (`["react", "typescript", "node", "rust", "go"]`) and `namespaced` (`["hobby:photography", "hobby:music", "work:project1", "work:project2", "home:cooking", "home:diy"]`).
- Controls: `items` (enum: `flat | namespaced`, default `namespaced`), `separator` (enum: `:` `/` `.`, default `:`), `maxDepth` (number 0-5, default 1), `placeholder` (string), `tagVariant` (enum), `size` (enum), `disabled` (bool), `readOnly` (bool).

#### 6. `src/renderer/uikit/TagsInput/index.ts` — new

```ts
export { TagsInput } from "./TagsInput";
export type { TagsInputProps } from "./TagsInput";
```

### Module wiring

#### 7. `src/renderer/uikit/index.ts` — modified

Append after the PathInput exports (line 36–37):

```ts
export { Tag } from "./Tag";
export type { TagProps } from "./Tag";
export { TagsInput } from "./TagsInput";
export type { TagsInputProps } from "./TagsInput";
```

#### 8. `src/renderer/editors/storybook/storyRegistry.ts` — modified

Add imports alongside the other Bootstrap stories (after `pathInputStory` on line 20):

```ts
import { tagStory } from "../../uikit/Tag/Tag.story";
import { tagsInputStory } from "../../uikit/TagsInput/TagsInput.story";
```

Append `tagStory, tagsInputStory` to the `ALL_STORIES` array on the Bootstrap line, immediately after `pathInputStory`.

### Files NOT changed (explicitly out of scope)

- `src/renderer/editors/link-editor/EditLinkDialog.tsx` — migration is US-432 Phase 4
- `src/renderer/editors/notebook/NoteItemView.tsx` — migration is US-461 / notebook cleanup follow-up
- `src/renderer/editors/notebook/ExpandedNoteView.tsx` — same as above
- `src/renderer/editors/link-editor/LinkTooltip.tsx` — migration follows the link-editor cleanup
- `src/renderer/editors/todo/components/TodoItemView.tsx` — does NOT adopt `Tag` (different visual semantic)
- `src/renderer/editors/todo/components/TodoListPanel.tsx` — does NOT adopt `Tag`

---

## Concerns / Open questions

### `Tag`

1. **`removeAffordance` default — `"always"` vs `"hover"`.**
   *Resolution:* default `"always"`. Discoverability wins; NoteItemView's hover-reveal was a density workaround for a tight layout. NoteItemView's eventual migration may opt into `"hover"` if the visual density still looks crowded.

2. **`color.text.muted` referenced in LinkTooltip.**
   Latent bug — that key isn't in `color.ts`. **Out of scope** for US-475; flag during LinkTooltip's eventual migration.

3. **`fontSize 11` in legacy badges.**
   Tag normalizes to `fontSize.xs (12)` for `size="sm"`. Per the token comment in `tokens.ts`, 11px is intentionally not on the scale. LinkTooltip and TodoItemView would shift visually from 11→12 at migration — acceptable and aligned with token policy.

4. **`onClick` narrowed to `() => void`.**
   The HTML `MouseEventHandler` shape isn't useful for tag interactions and clutters the API. If any future consumer needs the event, we add an opt-in escape hatch then.

### `TagsInput`

5. **API shape — `onChange(string[])` vs `onAdd`/`onRemove`.**
   *Resolution:* single `onChange(string[])`. Consumers store the next array as the source of truth; no need to derive deltas. Matches the user's proposed shape and keeps the API minimal. Add separate hooks later only if a real consumer needs per-op side effects.

6. **`items` shape — `string[]` vs `Traited<string[]>`.**
   *Resolution:* `string[]` for v1. Tags are scalar strings; the trait pattern (Rule 3) is for object items needing label/value resolvers. Re-evaluate if a script-driven UI ever needs to pass adapted item types.

7. **NoteItemView's click-to-edit-existing-tag and row-reverse overflow.**
   *Resolution:* not in v1. The interaction model (mutate an existing tag in place, swap `<Tag>` for `<PathInput>` for that one slot) doesn't fit a clean `value/onChange` API. NoteItemView keeps its bespoke implementation; revisit only if there's still appetite for that UX after the rest of the surface stabilises.

8. **LinkTooltip's toggle picker.**
   *Resolution:* not in v1. It's a different model (show *all* available tags, mark the selected ones). Forcing it into `TagsInput` would warp the API; if a second toggle-mode consumer ever appears, we ship a separate `TagsToggleGroup`.

9. **Duplicate handling — silent or feedback.**
   *Resolution:* silent. If the user types a tag already in `value`, the buffer is cleared with no `onChange` fired and no error/flash. Matches today's `EditLinkDialog` behaviour. If users find it confusing post-migration, we can add a transient highlight on the existing tag later.

10. **Tag size matches the input size.**
    *Resolution:* `TagsInput.size` cascades to both the rendered tags and the `PathInput`. Independent control isn't worth the API surface for v1.

---

## Acceptance criteria

### `Tag`

- `Tag` exports from `src/renderer/uikit/index.ts` (`Tag`, `TagProps`).
- `data-type="tag"` is always present on the root.
- `data-disabled`, `data-selected`, `data-clickable`, `data-removable` toggle correctly based on props (each present-or-absent, never `"false"`).
- Clicking the X fires `onRemove` only — does **not** bubble to `onClick` on the body.
- When `disabled`, neither `onClick` nor `onRemove` fire; `pointer-events: none` is applied.
- `removeAffordance="hover"` hides the X until the tag (or its X) is hovered or keyboard-focused; `"always"` keeps it visible at all times.
- `selected` fills the tag with `color.background.selection` and `color.text.selection` regardless of variant.
- Visual variants: `filled` has bg + border; `outlined` has border only with transparent bg.
- Storybook entry "Tag" appears under section "Bootstrap" with the controls listed in the plan. Toggling the `removable`/`clickable`/`selected`/`disabled` controls in the property editor produces the expected runtime behaviour. The demo's `last action` line updates correctly on click and remove (proving X-click does not bubble).
- TypeScript: `style` and `className` on `<Tag>` produce compile errors (Rule 7).

### `TagsInput`

- `TagsInput` exports from `src/renderer/uikit/index.ts` (`TagsInput`, `TagsInputProps`).
- `data-type="tags-input"` is always present on the root.
- Each tag in `value` renders as a `<Tag>` with a working remove button (when not `readOnly`/`disabled`); the X calls `onChange(value.filter(t => t !== tag))`.
- The internal `<PathInput>` autocompletes from `items`, with `separator` and `maxDepth` forwarded; when not `readOnly`, it is rendered after the last tag and grows to fill remaining row width.
- Typing a tag and committing (Enter or blur) trims, strips a trailing `separator`, and:
  - appends to `value` and fires `onChange` if the cleaned string is non-empty and not already present;
  - clears the buffer with no `onChange` if the cleaned string is empty or already present;
  - clears the buffer with no `onChange` on cancel (PathInput emits `undefined`).
- `readOnly` hides the add-tag input and removes the X buttons from rendered tags.
- `disabled` makes the whole row inert (`pointer-events: none`, opacity 0.5); `disabled` is also forwarded to the inner `<Tag>`s and `<PathInput>`.
- `size` cascades to both rendered tags and the inner `PathInput`.
- Storybook entry "TagsInput" appears under section "Bootstrap" with the controls listed in the plan. Adding a duplicate via the input is silently dropped; removing a tag immediately updates the demo's `value: …` line.
- TypeScript: `style` and `className` on `<TagsInput>` produce compile errors (Rule 7).

### Both

- No new colors or hardcoded hex values introduced.
- `npm run lint` clean.

---

## Files Changed

| File | Change | Notes |
|------|--------|-------|
| `src/renderer/uikit/Tag/Tag.tsx` | new | Component + styled spans + types |
| `src/renderer/uikit/Tag/Tag.story.tsx` | new | Storybook entry, Bootstrap section |
| `src/renderer/uikit/Tag/index.ts` | new | Re-exports |
| `src/renderer/uikit/TagsInput/TagsInput.tsx` | new | Composite over `Tag` + `PathInput` |
| `src/renderer/uikit/TagsInput/TagsInput.story.tsx` | new | Storybook entry, Bootstrap section |
| `src/renderer/uikit/TagsInput/index.ts` | new | Re-exports |
| `src/renderer/uikit/index.ts` | modified | Append `Tag`/`TagProps` and `TagsInput`/`TagsInputProps` exports |
| `src/renderer/editors/storybook/storyRegistry.ts` | modified | Import + register `tagStory` and `tagsInputStory` |
