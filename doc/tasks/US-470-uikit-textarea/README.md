# US-470: UIKit Textarea — multi-line text input primitive

**Epic:** [EPIC-025 — Unified Component Library and Storybook Editor](../../epics/EPIC-025.md)
**Phase:** 4 (form infrastructure — blocks US-432 Phase 4)
**Status:** Planned

## Goal

Add a UIKit `Textarea` primitive that replaces `src/renderer/components/basic/TextAreaField.tsx` for new code. The new primitive uses a `contentEditable` `<div>` (not a native `<textarea>`) so the control auto-grows / shrinks to its content, supports a clean `singleLine` mode, and keeps richer paste/clipboard handling — features a fixed-size native `<textarea>` cannot do without layout hacks.

This task is implementation-only. Existing `TextAreaField` call-sites (browser-OpenUrlDialog, EditLinkDialog, plus 17 other consumers across notebook, todo, rest-client, mcp-inspector, popmenu, etc.) keep importing from `components/basic/TextAreaField` until each owning screen's Phase 4 task picks them up. US-432 (Dialog migration) Phase 4 is the first consumer of the new primitive — its `OpenUrlDialog` and `EditLinkDialog` migrations start only after US-470 lands.

## Background

### Why contentEditable, not native `<textarea>`

Native `<textarea>` requires an explicit `rows`/`cols` (or fixed CSS `height`) to size itself. Auto-growing to content needs JS resize hacks (measure scrollHeight, write back to style on every input). Worse, the element imposes its own line-height and padding model that diverges from the rest of the form-control aesthetic.

A `contentEditable="plaintext-only"` `<div>` solves all of these:
- Sizes naturally to content via normal block-flow layout.
- Min/max height is a one-liner (`min-height` / `max-height` + `overflow-y: auto`).
- `singleLine` is a one-line key / paste handler that strips `\n` from pasted text and suppresses Enter.
- Placeholder is a one-line CSS pseudo (`:empty::before { content: attr(data-placeholder) }`).
- Visual chrome matches the rest of UIKit (tokens for padding, border, radius).

The legacy `TextAreaField` already proves the pattern works — the new primitive is essentially the same component re-shelled to UIKit conventions (data-attribute state, no exposed `style` / `className`, token-driven sizing).

### Existing `TextAreaField` consumers (informational — NOT migrated by this task)

| File | Mode | Migrates in |
|------|------|-------------|
| `src/renderer/ui/dialogs/OpenUrlDialog.tsx` | multiline + minHeight 80 / maxHeight 300 | **US-432 Phase 4** |
| `src/renderer/editors/link-editor/EditLinkDialog.tsx` (Title row) | `singleLine` + autoFocus | **US-432 Phase 4** |
| `src/renderer/editors/notebook/NoteItemView.tsx` | multiline (note body) | future Phase 4 task |
| `src/renderer/editors/notebook/ExpandedNoteView.tsx` | multiline | future Phase 4 task |
| `src/renderer/editors/notebook/NotebookViewModel.ts` | multiline | future Phase 4 task |
| `src/renderer/editors/notebook/notebookTypes.ts` | (type ref) | future |
| `src/renderer/editors/todo/TodoEditor.tsx` | multiline | future Phase 4 task |
| `src/renderer/editors/todo/components/TodoItemView.tsx` | `singleLine` | future Phase 4 task |
| `src/renderer/editors/rest-client/RestClientEditor.tsx` | multiline (URL & body) | future Phase 4 task |
| `src/renderer/editors/rest-client/RequestBuilder.tsx` | mixed | future Phase 4 task |
| `src/renderer/editors/rest-client/KeyValueEditor.tsx` | `singleLine` rows | future Phase 4 task |
| `src/renderer/editors/mcp-inspector/ResourcesPanel.tsx` | multiline | future Phase 4 task |
| `src/renderer/editors/mcp-inspector/ToolArgForm.tsx` | mixed | future Phase 4 task |
| `src/renderer/editors/mcp-inspector/PromptsPanel.tsx` | multiline | future Phase 4 task |
| `src/renderer/editors/settings/SettingsPage.tsx` | multiline | future Phase 4 task |
| `src/renderer/editors/video/VideoPlayerEditor.tsx` | (subtitle text) | future Phase 4 task |
| `src/renderer/ui/dialogs/poppers/showPopupMenu.tsx` | `singleLine` (menu rename) | future Phase 4 task |

The legacy `TextAreaField` file stays in place until every consumer has migrated; final removal is a future cleanup task (mirrors the Phase-5 cleanup pattern from US-432).

### EPIC-025 rules in scope

- **Rule 1 — Data attributes:** `data-type="textarea"`, `data-disabled`, `data-readonly`, `data-single-line` (when applicable), `data-size`. No `clsx`/`className`-based state.
- **Rule 2 — Controlled component:** `value` is owned by the caller; the component never holds the primary value in `useState`. (The DOM's `innerText` is synchronized to `value` via `useEffect`, mirroring `TextAreaField`'s pattern — this is a render mechanism, not local state.)
- **Rule 7 — No `style` / `className` from app code:** the prop type explicitly omits both. Sizing concerns (`minHeight`, `maxHeight`) are first-class props.

### Reference patterns

- `src/renderer/components/basic/TextAreaField.tsx` — the contentEditable div pattern, paste handler (manual caret insertion via `Selection.getRangeAt(0).insertNode`), `singleLine` enter/paste filtering, placeholder via `:empty::before`, `innerTextToString` trailing-newline normalization, `forwardRef` with imperative handle.
- `src/renderer/uikit/Input/Input.tsx` — UIKit form-control conventions: `data-size` selectors, token-driven padding/font, `data-disabled` styling, `forwardRef`, naming.

## API

### Types

```ts
export interface TextareaProps {
    /** Current text value. */
    value: string;
    /** Change handler — receives the string value directly, not the event. */
    onChange?: (value: string) => void;
    /** Empty-state placeholder text. */
    placeholder?: string;
    /** Disabled — non-editable, dimmed, no caret on click. */
    disabled?: boolean;
    /** Read-only — shows content, suppresses editing, NOT dimmed. */
    readOnly?: boolean;
    /** Single-line mode — Enter is suppressed; newlines in pasted text are stripped. Default: false. */
    singleLine?: boolean;
    /** Minimum height in px (the control reserves at least this much vertical space). */
    minHeight?: number;
    /** Maximum height in px before vertical scrolling kicks in. */
    maxHeight?: number;
    /** Size variant — controls font size and inner padding. Default: "md". */
    size?: "sm" | "md";
    /** Auto-focus on mount. Default: false. */
    autoFocus?: boolean;
    "aria-label"?: string;
    "aria-labelledby"?: string;
}

/** Imperative handle exposed via `ref`. */
export interface TextareaRef {
    /** Focus the inner editable div. */
    focus: () => void;
    /** Clear text and fire `onChange("")`. */
    clear: () => void;
    /** Read the current text from the DOM (post-`innerTextToString`). */
    getText: () => string;
}
```

`TextareaProps` does **not** extend `HTMLAttributes<HTMLDivElement>`. UIKit Rule 7 — only the listed props are accepted. (`style`, `className`, arbitrary `data-*`, etc. are not passed through.)

### Behavior

- **Value sync:** on each render, if `innerTextToString(div.innerText) !== value`, write `value` into `div.innerText`. Without this, the caret would jump to the start every keystroke.
- **`singleLine`:**
  - `onKeyDown`: if `e.key === "Enter"`, `e.preventDefault()`.
  - `onPaste`: replace `\n` in the pasted text with `""` before manual insertion.
- **Paste handling:** call `e.preventDefault()` and insert the cleaned plain-text manually at the caret (mirrors `TextAreaField` — preserves caret position vs. the default browser behavior which moves caret in unpredictable ways for `contentEditable`).
- **Placeholder:** rendered via `:empty::before { content: attr(data-placeholder) }`; the placeholder text is set on the root via `data-placeholder={placeholder}` (only when `placeholder` is provided).
- **Disabled vs. readOnly:**
  - `disabled`: `contentEditable={false}`, `data-disabled` set, opacity dimmed, `pointerEvents: none`.
  - `readOnly`: `contentEditable={false}`, `data-readonly` set, no dimming. Caret-less but visually identical to a normal textarea.
  - If both are set, `disabled` wins.
- **Sizing:** `minHeight` and `maxHeight` are written to the root via inline `style` (px). When `maxHeight` is set, `overflow-y: auto`. When unset, the control auto-grows.
- **Newline trimming:** `innerTextToString` strips a single trailing `\n` and converts a sole `"\n"` to `""` (matches `TextAreaField`).
- **`autoFocus`:** when true, calls `.focus()` on the inner div in a `useEffect` on mount (one frame delayed via `setTimeout(..., 0)` to survive parent layout shifts).

### File layout

```
uikit/Textarea/
  Textarea.tsx           ← component (contentEditable div + paste/key/effect handlers)
  Textarea.story.tsx     ← Storybook entry
  index.ts               ← export { Textarea }; export type { TextareaProps, TextareaRef }
```

## Implementation plan

### Step 1 — Create the folder + files

Create `src/renderer/uikit/Textarea/` with:
- `Textarea.tsx`
- `Textarea.story.tsx`
- `index.ts`

### Step 2 — Implement `Textarea.tsx`

Skeleton (mirror `Input.tsx` for prelude + token usage; mirror `TextAreaField.tsx` for the contentEditable behavior):

```tsx
import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { fontSize, height, radius, spacing } from "../tokens";

// --- Types ---

export interface TextareaProps {
    value: string;
    onChange?: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    readOnly?: boolean;
    singleLine?: boolean;
    minHeight?: number;
    maxHeight?: number;
    size?: "sm" | "md";
    autoFocus?: boolean;
    "aria-label"?: string;
    "aria-labelledby"?: string;
}

export interface TextareaRef {
    focus: () => void;
    clear: () => void;
    getText: () => string;
}

// --- Helpers ---

function innerTextToString(text: string): string {
    if (text === "\n") return "";
    if (text.endsWith("\n")) return text.slice(0, -1);
    return text;
}

// --- Styled ---

const Root = styled.div(
    {
        padding: `${spacing.sm}px ${spacing.md}px`,
        backgroundColor: color.background.dark,
        color: color.text.dark,
        border: `1px solid ${color.border.light}`,
        borderRadius: radius.md,
        outline: "none",
        boxSizing: "border-box",
        whiteSpace: "pre-wrap",
        overflowY: "auto",

        '&[data-size="sm"]': { fontSize: fontSize.sm },
        '&[data-size="md"]': { fontSize: fontSize.base },

        // Active focus border — only when editable. Read-only / disabled keep
        // the inactive border so a readonly preview doesn't read as "focused
        // input awaiting typing".
        "&:focus, &:active": {
            borderColor: color.border.active,
        },
        "&[data-readonly]:focus, &[data-readonly]:active": {
            borderColor: color.border.light,
        },

        "&:empty::before": {
            content: "attr(data-placeholder)",
            color: color.text.light,
            pointerEvents: "none",
        },

        "&[data-disabled]": {
            opacity: 0.5,
            pointerEvents: "none",
        },
    },
    { label: "Textarea" },
);

// --- Component ---

export const Textarea = React.forwardRef<TextareaRef, TextareaProps>(
    function Textarea({
        value,
        onChange,
        placeholder,
        disabled,
        readOnly,
        singleLine,
        minHeight,
        maxHeight,
        size = "md",
        autoFocus,
        ...aria
    }, ref) {
        const divRef = React.useRef<HTMLDivElement>(null);
        const editable = !disabled && !readOnly;

        React.useEffect(() => {
            const el = divRef.current;
            if (el && innerTextToString(el.innerText) !== value) {
                el.innerText = value ?? "";
            }
        }, [value]);

        React.useEffect(() => {
            if (autoFocus) {
                const id = setTimeout(() => divRef.current?.focus(), 0);
                return () => clearTimeout(id);
            }
        }, [autoFocus]);

        React.useImperativeHandle(ref, () => ({
            focus: () => divRef.current?.focus(),
            clear: () => {
                if (divRef.current) {
                    divRef.current.innerText = "";
                    onChange?.("");
                }
            },
            getText: () => innerTextToString(divRef.current?.innerText ?? ""),
        }));

        const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
            let text = e.currentTarget.innerText;
            if (singleLine && text.includes("\n")) {
                text = text.replace(/\n/g, "");
                e.currentTarget.innerText = text;
            } else {
                text = innerTextToString(text);
            }
            onChange?.(text);
        };

        const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
            e.preventDefault();
            let text = e.clipboardData.getData("text/plain");
            if (singleLine) text = text.replace(/\n/g, "");

            const sel = window.getSelection();
            if (!sel?.rangeCount) return;
            sel.deleteFromDocument();
            const node = document.createTextNode(text);
            sel.getRangeAt(0).insertNode(node);
            const range = document.createRange();
            range.setStartAfter(node);
            range.setEndAfter(node);
            sel.removeAllRanges();
            sel.addRange(range);

            onChange?.(innerTextToString(divRef.current?.innerText ?? ""));
        };

        const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
            if (singleLine && e.key === "Enter") e.preventDefault();
        };

        const style: React.CSSProperties = {};
        if (minHeight !== undefined) style.minHeight = minHeight;
        if (maxHeight !== undefined) style.maxHeight = maxHeight;

        return (
            <Root
                ref={divRef}
                role="textbox"
                aria-multiline={!singleLine}
                aria-label={aria["aria-label"]}
                aria-labelledby={aria["aria-labelledby"]}
                contentEditable={editable ? "plaintext-only" : false}
                spellCheck={false}
                data-type="textarea"
                data-size={size}
                data-disabled={disabled || undefined}
                data-readonly={readOnly || undefined}
                data-single-line={singleLine || undefined}
                data-placeholder={placeholder}
                onInput={editable ? handleInput : undefined}
                onPaste={editable ? handlePaste : undefined}
                onKeyDown={editable ? handleKeyDown : undefined}
                tabIndex={editable ? 0 : -1}
                style={style}
            />
        );
    },
);
```

Key deviations from `TextAreaField`:
- No `...divProps` / `HTMLAttributes` extension (Rule 7).
- `disabled` handled in addition to `readOnly` (`TextAreaField` only had `readonly`).
- `data-type="textarea"`, `data-size`, `data-disabled`, `data-readonly`, `data-single-line` instead of class-based state.
- **Visual parity with `Input`:** background `color.background.dark`, text `color.text.dark`, border `color.border.light`, focus border `color.border.active`, radius `radius.md`. Drops the legacy `background.default` content-area look.
- **Read-only suppresses the active focus border:** `[data-readonly]:focus` keeps the inactive `color.border.light`, so a readonly preview doesn't visually masquerade as a focused, typeable input.
- Imperative ref returns `{ focus, clear, getText }` — `reset()` and `div` from `TextAreaField` are dropped (no current consumer in the US-432 scope uses them; can be added back when a future consumer needs them).

### Step 3 — Implement `Textarea.story.tsx`

Storybook entry with controls:

| Prop | Type | Default |
|------|------|---------|
| `initialValue` | string | `""` |
| `placeholder` | string | `"Type something..."` |
| `singleLine` | boolean | `false` |
| `disabled` | boolean | `false` |
| `readOnly` | boolean | `false` |
| `minHeight` | number (0–200) | `0` (unset → undefined) |
| `maxHeight` | number (0–500) | `0` (unset → undefined) |
| `size` | enum `"sm" \| "md"` | `"md"` |
| `autoFocus` | boolean | `false` |

Demo body (`<Panel direction="column" gap="md">`):
- A `Textarea` controlled by local state.
- A `Text` line below showing the current value (so the storybook user can see `onChange` firing).
- Map `minHeight`/`maxHeight` of `0` → `undefined` before passing to the component.

Register as `id: "textarea"`, `section: "Bootstrap"` in `src/renderer/editors/storybook/storyRegistry.ts`.

### Step 4 — `index.ts`

```ts
export { Textarea } from "./Textarea";
export type { TextareaProps, TextareaRef } from "./Textarea";
```

### Step 4b — Mirror the read-only rule into existing `Input.tsx`

The read-only "no active focus border" rule is a cross-component convention. Apply it to the existing `Input` so the two text-input primitives behave identically.

In `src/renderer/uikit/Input/Input.tsx`, inside the `Root = styled.input(...)` block, add a selector right after the existing `&:focus, &:active` rule:

```ts
"&:focus, &:active": {
    borderColor: color.border.active,
},
"&[readonly]:focus, &[readonly]:active": {
    borderColor: color.border.light,
},
```

The `[readonly]` selector matches the native HTML attribute that React writes when `readOnly={true}` is passed through to the underlying `<input>` (already supported via `Input`'s `Omit<…InputHTMLAttributes…>` pass-through). No new prop is needed on `Input`.

### Step 5 — Re-export from `uikit/index.ts`

Add between `Spinner` and the Overlay block:

```ts
export { Textarea } from "./Textarea";
export type { TextareaProps, TextareaRef } from "./Textarea";
```

### Step 6 — Register the story

Edit `src/renderer/editors/storybook/storyRegistry.ts`:
- Add `import { textareaStory } from "../../uikit/Textarea/Textarea.story";` to the Bootstrap import block.
- Append `textareaStory` to the Bootstrap row of `ALL_STORIES` (after `radioGroupStory, spinnerStory`).

### Step 7 — Type-check + Storybook smoke test

- `tsc --noEmit` clean for new files.
- Storybook smoke test:
  - Type into the textarea — value updates live.
  - Toggle `singleLine` — Enter is suppressed; pasting multi-line text strips newlines.
  - Toggle `disabled` — caret disappears; opacity drops; can't type.
  - Toggle `readOnly` — caret disappears; opacity stays full; can't type.
  - `minHeight=80` reserves space when empty; `maxHeight=200` causes scroll when content exceeds it.
  - `autoFocus=true` focuses on first render.
  - Placeholder visible only when value is empty.

## Concerns / Open questions

1. **Drop `reset()` and `div` from the ref API?** — Resolved: yes. `TextAreaField`'s `reset()` (write `value` back into the div) is unused in the two US-432 Phase 4 consumers; `div` direct access in `OpenUrlDialog` is replaced by the new `focus()` method. Add them back only if a future consumer needs them.
2. **Background color — `color.background.default` (TextAreaField) vs. `color.background.dark` (UIKit Input)?** — Resolved: `color.background.dark`. The Textarea must read as a sibling of `Input` so a form mixing both does not visually fracture; the legacy TextAreaField look is dropped. (Earlier draft proposed `background.default` — overruled.)
2a. **Read-only focus border** — Resolved: `[data-readonly]:focus` (Textarea) and `[readonly]:focus` (Input) both keep the inactive `color.border.light` border. A readonly preview should not look like a focused input awaiting typing. The same rule applies to the existing `Input` and is bundled into this task (Step 4b).
3. **Auto-grow behavior** — `contentEditable` divs grow naturally with content. With `maxHeight` set, the div scrolls inside. Without `minHeight` and `maxHeight`, the div is exactly its content's height. No JS resize is needed, unlike a native `<textarea>`.
4. **Why `forwardRef` returns `TextareaRef` (imperative handle), not the raw `<div>`?** — Forwarding the raw `<div>` would let consumers reach into `.innerText` etc. and bypass the controlled-value contract (Rule 2). The imperative handle exposes only the safe operations (`focus`, `clear`, `getText`).
5. **`tabIndex` when not editable** — Set to `-1` so disabled / readOnly textareas don't appear in the keyboard tab sequence. (`TextAreaField` left `tabIndex` as `0` even when readonly, which let users tab to a non-interactive control — improvement here.)
6. **Pasting structured content (rich HTML)** — `contentEditable="plaintext-only"` forbids it at the browser level, and the paste handler still calls `getData("text/plain")` for cross-browser safety. Should hold across Chromium-based Electron with no extra work.
7. **Spell check** — Hard-coded `spellCheck={false}` to match `TextAreaField`. Persephone is a developer tool — paths, code, URLs are common content; spellcheck noise is unwanted. If a future consumer needs spellcheck, add a `spellCheck` prop then.

## Acceptance Criteria

- [ ] `src/renderer/uikit/Textarea/` exists with `Textarea.tsx`, `Textarea.story.tsx`, `index.ts`
- [ ] `Textarea` is exported from `src/renderer/uikit/index.ts`
- [ ] `textareaStory` is registered in `src/renderer/editors/storybook/storyRegistry.ts`
- [ ] All Rule 1 data attributes present: `data-type="textarea"`, `data-size`, `data-disabled`, `data-readonly`, `data-single-line`, `data-placeholder`
- [ ] `TextareaProps` does NOT accept `style` or `className` (TypeScript-enforced)
- [ ] Storybook smoke test passes for: typing, `singleLine` Enter suppression + paste-strip, `disabled`, `readOnly`, `minHeight`/`maxHeight`, `autoFocus`, placeholder visibility
- [ ] Read-only `Textarea` keeps the inactive border on focus (no blue active border)
- [ ] Read-only `Input` keeps the inactive border on focus (verified in the Input story by toggling `readOnly` and tabbing into the field)
- [ ] `npm run lint` and `tsc` pass
- [ ] No existing `TextAreaField` consumer is touched (legacy stays in place)

## Files Changed (summary)

### Created

| Path | Purpose |
|------|---------|
| `src/renderer/uikit/Textarea/Textarea.tsx` | Component implementation |
| `src/renderer/uikit/Textarea/Textarea.story.tsx` | Storybook entry |
| `src/renderer/uikit/Textarea/index.ts` | Folder re-exports |

### Modified

| Path | Change |
|------|--------|
| `src/renderer/uikit/index.ts` | Add `Textarea` + `TextareaProps` + `TextareaRef` exports |
| `src/renderer/uikit/Input/Input.tsx` | Add `[readonly]:focus, [readonly]:active` rule that pins the border to `color.border.light` — mirror of the Textarea read-only rule |
| `src/renderer/editors/storybook/storyRegistry.ts` | Import + register `textareaStory` |
| `doc/active-work.md` | Add US-470 entry under EPIC-025 |

### Files NOT changed

- `src/renderer/components/basic/TextAreaField.tsx` — legacy primitive; stays until every consumer has migrated.
- All 19 current `TextAreaField` consumers (notebook, todo, rest-client, mcp-inspector, etc.) — each migrates as part of its own Phase 4 task.
- `doc/tasks/US-432-dialog-component/README.md` — already references the future Textarea primitive; no further edit needed once US-470 lands.
