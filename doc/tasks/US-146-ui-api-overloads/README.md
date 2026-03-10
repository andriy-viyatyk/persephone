# US-146: Standardize ui API — two-overload pattern

**Epic:** EPIC-004
**Status:** Planned
**Depends on:** US-145 (flat LogEntry)

## Goal

Align all `ui.dialog.*` methods (and future `ui.show.*` methods) to follow a consistent two-overload pattern:

1. **Full form** — single object parameter with all supported fields
2. **Simple form** — positional args where first param is a non-object (string, array), rest optional

This does NOT apply to:
- Logging methods (`ui.log`, `ui.info`, etc.) — already simple single-param + builder
- `styledText()` builder — fluent API, different pattern by nature

## Current State (inconsistent)

| Method | Current signature | Issues |
|--------|------------------|--------|
| `confirm(message, buttons?)` | Two positional args | No full object form |
| `buttons(buttons[], title?)` | Two positional args | No full object form |
| `textInput(title?, options?)` | Mixed — title + options bag | Title split from options; inconsistent |

## Target State

### Standard pattern

```typescript
// Full form — single object with all params
dialog.method({ ...allParams })

// Simple form — first arg is non-object, rest optional
dialog.method(primaryValue, ...optionalPositionalArgs)
```

**Disambiguation rule:** If first argument is a plain non-array object with method-specific keys, it's the full form. Otherwise it's the simple form.

### Proposed signatures

**confirm:**
```typescript
// Simple form (unchanged — backward compatible)
confirm(message: IStyledText, buttons?: string[]): Promise<IDialogResult>;
// Full form (new)
confirm(options: { message: IStyledText; buttons?: string[] }): Promise<IDialogResult>;
```

Disambiguation: `message` is `StyledText` (string or array of segments). A plain object with a `message` key is the full form.

**buttons:**
```typescript
// Simple form (unchanged)
buttons(buttons: string[], title?: IStyledText): Promise<IDialogResult>;
// Full form (new)
buttons(options: { buttons: string[]; title?: IStyledText }): Promise<IDialogResult>;
```

Disambiguation: first arg is an array → simple form. Plain object with `buttons` key → full form.

**textInput:**
```typescript
// Simple form (keep existing for backward compat)
textInput(title?: IStyledText, options?: { placeholder?: string; defaultValue?: string; buttons?: string[] }): Promise<IDialogResult>;
// Full form (new)
textInput(options: { title?: IStyledText; placeholder?: string; defaultValue?: string; buttons?: string[] }): Promise<IDialogResult>;
```

Disambiguation: first arg is string/StyledText/undefined → simple form. Plain object with relevant keys → full form. Since `textInput()` can be called with no args, we check if first arg is a non-StyledText object.

### Future `ui.show.*` methods (Phase 3)

When implementing output methods, follow the same pattern from the start:
```typescript
// Full form
show.progress({ label, value, max? })
show.grid({ columns, rows, title? })
show.text({ text, language?, title? })

// Simple form
show.progress(label, value, max?)
show.grid(columns, rows, title?)
show.text(text, language?, title?)
```

## Implementation Plan

### Step 1: Update `UiFacade.ts`

**File:** `src/renderer/scripting/api-wrapper/UiFacade.ts`

For each dialog method, add overload detection:

```typescript
confirm: (messageOrOptions: StyledText | { message: StyledText; buttons?: string[] }, buttons?: string[]): Promise<DialogResult> => {
    if (typeof messageOrOptions === "object" && !Array.isArray(messageOrOptions) && "message" in messageOrOptions) {
        // Full form: confirm({ message, buttons? })
        return this.vm.addDialogEntry("input.confirm", messageOrOptions);
    }
    // Simple form: confirm(message, buttons?)
    return this.vm.addDialogEntry("input.confirm", { message: messageOrOptions, buttons });
},

buttons: (buttonsOrOptions: string[] | { buttons: string[]; title?: StyledText }, title?: StyledText): Promise<DialogResult> => {
    if (!Array.isArray(buttonsOrOptions)) {
        // Full form: buttons({ buttons, title? })
        return this.vm.addDialogEntry("input.buttons", buttonsOrOptions);
    }
    // Simple form: buttons(buttons[], title?)
    return this.vm.addDialogEntry("input.buttons", { buttons: buttonsOrOptions, title });
},

textInput: (titleOrOptions?: StyledText | { title?: StyledText; placeholder?: string; defaultValue?: string; buttons?: string[] }, options?: { placeholder?: string; defaultValue?: string; buttons?: string[] }): Promise<DialogResult> => {
    if (typeof titleOrOptions === "object" && !Array.isArray(titleOrOptions) && !("text" in titleOrOptions)) {
        // Full form: textInput({ title?, placeholder?, defaultValue?, buttons? })
        return this.vm.addDialogEntry("input.text", titleOrOptions);
    }
    // Simple form: textInput(title?, options?)
    return this.vm.addDialogEntry("input.text", { title: titleOrOptions as StyledText | undefined, ...options });
},
```

### Step 2: Update type definitions (`.d.ts`)

**Files:**
- `src/renderer/api/types/ui-log.d.ts`
- `assets/editor-types/ui-log.d.ts`

Add full-form overloads to `IUiDialog`:

```typescript
export interface IUiDialog {
    /**
     * Show a confirmation dialog with a message and optional custom buttons.
     * Default buttons: ["No", "Yes"].
     *
     * @example
     * // Simple form
     * const result = await ui.dialog.confirm("Delete all items?");
     * const result = await ui.dialog.confirm("Save?", ["Save", "Discard", "Cancel"]);
     *
     * @example
     * // Full form
     * const result = await ui.dialog.confirm({ message: "Delete all items?", buttons: ["Yes", "No"] });
     */
    confirm(message: IStyledText, buttons?: string[]): Promise<IDialogResult>;
    confirm(options: { message: IStyledText; buttons?: string[] }): Promise<IDialogResult>;

    /**
     * Show a dialog with custom buttons.
     *
     * @example
     * // Simple form
     * const result = await ui.dialog.buttons(["Option A", "Option B", "Cancel"], "Choose");
     *
     * @example
     * // Full form
     * const result = await ui.dialog.buttons({ buttons: ["A", "B"], title: "Choose" });
     */
    buttons(buttons: string[], title?: IStyledText): Promise<IDialogResult>;
    buttons(options: { buttons: string[]; title?: IStyledText }): Promise<IDialogResult>;

    /**
     * Show a text input dialog. Returns the entered text in `result.text`.
     *
     * @example
     * // Simple form
     * const result = await ui.dialog.textInput("Enter name", { placeholder: "Name..." });
     *
     * @example
     * // Full form
     * const result = await ui.dialog.textInput({
     *     title: "Enter name",
     *     placeholder: "Name...",
     *     defaultValue: "World",
     *     buttons: ["!OK", "Cancel"],
     * });
     */
    textInput(title?: IStyledText, options?: {
        placeholder?: string;
        defaultValue?: string;
        buttons?: string[];
    }): Promise<IDialogResult>;
    textInput(options: {
        title?: IStyledText;
        placeholder?: string;
        defaultValue?: string;
        buttons?: string[];
    }): Promise<IDialogResult>;
}
```

### Step 3: Update MCP scripting resource examples

**File:** `assets/mcp-res-scripting.md`

Update `app.ui` / `ui.dialog` examples to show both forms.

### Step 4: No MCP `ui_push` changes needed

MCP always uses the full flat entry format. The overloads are script-only conveniences.

## Concerns / Open Questions

### 1. Backward compatibility (critical)

The simple form signatures must remain unchanged. All existing scripts continue to work. The full form is purely additive.

### 2. StyledText disambiguation for `confirm`

`StyledText` = `string | StyledSegment[]`. A `StyledSegment[]` is an array of objects. The full form is a plain object with a `message` key. Disambiguation: check for `"message" in arg` on non-array objects. This is safe because `StyledSegment` objects have `text` and `styles` keys, never `message`.

### 3. `textInput` disambiguation edge case

`textInput()` with no args is valid (shows empty input with OK button). `textInput({})` could be either "full form with defaults" or "simple form with empty object as title". We disambiguate by checking for known keys (`title`, `placeholder`, `defaultValue`, `buttons`) — if any exist, it's the full form. An empty object `{}` is treated as full form (all defaults), which produces the same result.

## Acceptance Criteria

- [ ] `confirm` supports full form `{ message, buttons? }` and simple form `(message, buttons?)`
- [ ] `buttons` supports full form `{ buttons, title? }` and simple form `(buttons, title?)`
- [ ] `textInput` supports full form `{ title?, placeholder?, defaultValue?, buttons? }` and old simple form
- [ ] All existing scripts continue to work (no breaking changes)
- [ ] Type definitions updated with both overloads in both `.d.ts` files
- [ ] Future `ui.show.*` methods documented to follow the same pattern
