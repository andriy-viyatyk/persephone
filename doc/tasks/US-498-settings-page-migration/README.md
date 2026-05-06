# US-498: Settings page — UIKit migration

## Status

**Plan ready for implementation.** UIKit `Dot` primitive
([US-503](../US-503-uikit-dot/README.md)) is now in place and used in this
task's swatch/dot mappings (C1, Step 7, Step 10). Step 0 prerequisites (UIKit
`Textarea` spread-rest refactor + UIKit `Input` width props) are part of
this task and run at the start of implementation.

Part of [EPIC-025](../../epics/EPIC-025.md) Phase 4 per-screen migration.

## Goal

Migrate `src/renderer/editors/settings/SettingsPage.tsx` from
`components/basic/`, `components/overlay/`, and Emotion `styled.div` chrome to
UIKit primitives. After this task:

- No imports from `components/basic|form|layout|overlay/` in the settings file.
- No `import styled from "@emotion/styled"` in the settings file (Rule 7 strict
  applies — Settings is in `editors/`, NOT in `ui/`, so the chrome exception
  does not extend here).
- All layout containers use `Panel`; primitives use UIKit components.

## Background

The settings page is a single React component file with:

- `SettingsEditorRoot = styled.div(...)` — a ~530-line CSS-in-JS block defining
  ~40 utility classes (`.settings-card`, `.theme-grid`, `.theme-card`,
  `.profile-row`, `.profile-row-group`, `.profile-color-dot`, `.color-swatch`,
  `.profile-set-default`, `.profile-clear-data`, `.tor-port-input`,
  `.mcp-port-input`, `.mcp-config`, `.link-button`, `.divider`, etc.).
- One imported old primitive: `TextAreaField` from `components/basic/`.
- One imported old primitive: `WithPopupMenu` + `MenuItem` from
  `components/overlay/`.
- Many inline `<input>`, `<button>`, `<select>`, `<input type="checkbox">`,
  `<hr>`, `<h1>` elements styled via the utility classes above.

UIKit components used in this migration (verified):

| Primitive | File | Notes |
|---|---|---|
| `Panel` | `uikit/Panel/Panel.tsx` | direction/gap/padding/border/flex/min/max — no className/style on it |
| `Button` | `uikit/Button/Button.tsx` | variants: default / primary / ghost / danger / link |
| `IconButton` | `uikit/IconButton/IconButton.tsx` | sizes sm/md; supports `title` (tooltip) |
| `Input` | `uikit/Input/Input.tsx` | size sm/md; needs `width`/`minWidth`/`maxWidth` props (Step 0b) |
| `Textarea` | `uikit/Textarea/Textarea.tsx` | `getText()` ref API matches; needs Step 0 refactor (drift from UIKit spread-rest convention) |
| `Select` | `uikit/Select/Select.tsx` | takes `IListBoxItem[]`; emits source `T` |
| `Checkbox` | `uikit/Checkbox/Checkbox.tsx` | label is `children`, not `htmlFor` |
| `Divider` | `uikit/Divider/Divider.tsx` | replaces `<hr>` |
| `Text` | `uikit/Text/Text.tsx` | typography for hints/labels/title |
| `WithMenu` | `uikit/Menu/WithMenu.tsx` | render-prop API matches `WithPopupMenu` |
| `MenuItem` (type) | `uikit/Menu/types.ts` | re-export from `api/types/events` (same canonical type) |
| `Dot` | `uikit/Dot/Dot.tsx` | colored-circle primitive (US-503); `size` named/numeric, `color` semantic/raw, `bordered`, `selected`, optional `onClick` |

## Component coverage check (do we have everything we need?)

**Coverage: yes, with three small gaps that we resolve before implementation
begins.** See concerns below.

| Settings need | UIKit component | Coverage |
|---|---|---|
| Layout flex containers, padding, gap, borders | `Panel` | ✅ full |
| Vertical separator between sections | `Divider` | ✅ full |
| Section title (`<h1>`) and labels (`section-label`, `section-hint`, `theme-section-label`) | `Text` (size/bold/variant=uppercased/color) | ✅ full |
| Single-line text input — search-extensions, profile name, port numbers | `Input` / `Textarea` (singleLine) | ⚠ see C2/C5 |
| Multi-line text — none in this page | — | n/a |
| Native `<select>` for link-open behavior | `Select` | ✅ full |
| `<input type="checkbox">` for MCP toggle, browser-tools toggle | `Checkbox` | ✅ full |
| Buttons with text + optional border | `Button` (variants default/ghost/link) | ⚠ see C3 |
| Tiny × close buttons | `IconButton` with × icon | ✅ full |
| Hover-to-reveal buttons (`.profile-clear-data`, `.profile-remove`) | — | ⚠ see C4 (drop hover-reveal, always show) |
| Color picker dropdown anchored to a swatch | `WithMenu` + `MenuItem` array | ✅ full (already used) |
| Theme-card + theme-preview swatches | — | ⚠ see C1 (Settings-specific bespoke chrome — inline styles on plain HTML, no Emotion) |
| Color swatch palette, profile color dot, MCP status dot, color-picker menu icon | `Dot` (US-503) | ✅ full |

## Concerns — resolved before implementation

### C1 — Custom visual atoms — split between UIKit `Dot` and Settings-specific inline styles

**Concern.** Settings has visual atoms with no direct UIKit equivalent:
theme cards (clickable card with active-state border), theme-preview swatches
(3 colored lines simulating a window), color swatches (round colored circles),
profile color dots, MCP status dot. They split into two categories:
- **General-purpose colored circles** (color-swatch, profile-color-dot, mcp-status-dot, color-picker menu icons) — recur in many places across the codebase.
- **Settings-specific composites** (theme-card, theme-preview) — bespoke chrome with no reuse value.

**Resolution.**
- **Colored circles → use UIKit `Dot`** (US-503, now implemented). The Settings
  dot retrofit happens in this task (this task already runs a full Settings
  smoke pass, so coupling the dot retrofit to it keeps testing well-scoped).
  Mappings:
    - `.profile-color-dot` (12px, default profile + custom profiles) → `<Dot size="md" color={profile.color} bordered />`.
    - `.profile-color-dot.clickable` (inside `WithMenu` trigger) → `<Dot size="md" color={profile.color} bordered onClick={(e) => setOpen(e.currentTarget)} title="Change color" />` — `onClick` makes the dot clickable; `Dot` adds the hover affordance automatically.
    - `.color-swatch` (18px palette) → `<Dot size="lg" color={c.hex} selected={newColor === c.hex} onClick={() => setNewColor(c.hex)} title={c.name} />`. The selection ring is a `box-shadow` — no layout shift between selected and unselected states.
    - `.mcp-status-dot` (8px) → `<Dot size="sm" color={status.running ? "success" : "neutral"} />`.
    - Color-picker `MenuItem.icon` (10px) — used in `getColorMenuItems` — → `<Dot size={10} color={c.hex} />`.
- **Theme cards / theme-preview → inline-styled plain `<div>`s.** Bespoke
  Settings chrome — no reuse value, not worth a UIKit primitive. Rule 7
  forbids `styled.div` in app code but allows inline `style={...}` on plain
  HTML elements. CSS `:hover` is unavailable in inline styles:
    - Theme card active state: `<Panel border borderColor="active" ...>` when active, plain `<Panel border>` otherwise — clear visual cue without `:hover`.
    - Theme-preview swatches stay as plain `<div style={{...}}>` per the existing implementation.

### C2 — UIKit `Input` has no `width` / `minWidth` / `maxWidth` props; tor-port and mcp-port inputs are tiny (56px / 72px)

**Concern.** Current code styles `<input className="tor-port-input">` to
`width: 56` and `<input className="mcp-port-input">` to `width: 72`. UIKit
`Input` has `width: 100%` baked into its `Wrapper` styled component and exposes
no width-axis props. Wrapping every tiny input in `<Panel width={56}>` works
but is noisy — and intrinsic sizing ("this input is 56px wide") is a primitive
concern, not a layout-parent concern.

**Resolution.** Add `width` / `minWidth` / `maxWidth` props to UIKit `Input`,
mirroring how `Panel` already exposes them and how `Textarea` already exposes
`minHeight`/`maxHeight` on the height axis. See Step 0b. After this:

```tsx
<Input
    size="sm"
    width={56}
    value={portValue}
    onChange={setPortValue}
    onBlur={handlePortBlur}
    onKeyDown={handlePortKeyDown}
/>
```

The default behavior (no `width` prop → fills parent at 100%) is preserved, so
no existing call site changes.

**Where the line is.** `width`/`minWidth`/`maxWidth` are intrinsic sizing —
the input "is N pixels wide" — and belong on the primitive. `flex`, `margin`,
positioning relative to siblings stay on the parent `Panel`.

### C3 — Custom button visual styles missing in UIKit

**Concern.** Settings has multiple button styles that don't map cleanly to
UIKit Button variants:

| Class | Visual | Closest UIKit |
|---|---|---|
| `.link-button` | transparent bg, blue text, gray border, padding | `Button variant="link" size="sm"` ✅ exact match |
| `.profile-set-default` | transparent bg, blue text, **no border**, underline on hover | `Button variant="ghost" size="sm"` (no underline) |
| `.profile-add-button` | dark bg, gray text, gray border | `Button variant="default" size="sm"` (default ≈ light bg) |
| `.mcp-copy-button` | transparent bg, light gray text, gray border | `Button variant="default" size="sm"` |
| `.profile-clear-data` | transparent bg, gray text, no border, hover-reveal | `Button variant="ghost" size="sm"` (no hover-reveal) |
| `.profile-remove` (× button) | transparent bg, × char, hover-reveal | `IconButton size="sm" icon={<CloseIcon />}` |
| `.profile-bookmarks-clear` (× button) | transparent bg, × char | `IconButton size="sm" icon={<CloseIcon />}` |

**Resolution.** Accept small visual deltas to avoid extending UIKit for
single-use variants:
- `.link-button` → `<Button variant="link" size="sm">…</Button>` (exact).
- `.profile-set-default`, `.profile-clear-data` → `<Button variant="ghost" size="sm">…</Button>` (lose underline-hover and hover-reveal).
- `.profile-add-button`, `.mcp-copy-button` → `<Button variant="default" size="sm">…</Button>`.
- `.profile-remove`, `.profile-bookmarks-clear` → `<IconButton size="sm" icon={<CloseIcon />} />`. Use the existing close-x icon from `theme/icons` (verify which one — likely `CloseIcon` or similar).

**No UIKit changes** — visual delta is small and acceptable per epic deferred
review model.

### C4 — Hover-reveal opacity (parent-driven `:hover` on `.profile-row-group`)

**Concern.** Today `.profile-clear-data` and `.profile-remove` have
`opacity: 0` and become visible only when the parent `.profile-row-group` is
hovered (CSS `&:hover .profile-clear-data { opacity: 1 }`). This requires CSS
`:hover` on a parent — impossible with inline styles, and Rule 7 forbids
`styled.div` in app code.

**Resolution.** Drop hover-reveal — buttons are always visible. The settings
page is dense already; making clear/remove buttons always visible adds 2-3
buttons per profile row but removes the discoverability problem (most users
don't realize a hover-reveal action exists). Functionally equivalent, slightly
busier. Acceptable.

### C5 — UIKit `Textarea` does not spread DOM attributes; `onBlur`, `onFocus`, `id`, `tabIndex`, `data-*`, `aria-*` etc. are all missing

**Concern.** Current code:
```tsx
<TextAreaField
    ref={extensionsRef}
    className="extensions-field"
    singleLine
    value={extensionsText}
    onBlur={handleExtensionsBlur}
/>
```
`TextAreaField` inherits `onBlur` from `HTMLAttributes<HTMLDivElement>` via
`...divProps`. UIKit `Textarea` enumerates every prop explicitly and does NOT
spread `...rest`, so `onBlur` (and many other standard DOM attributes) are
missing.

**Root cause: Textarea drifted from the UIKit convention.** Every other
primitive in UIKit (Input, Button, IconButton, Panel, Divider, Text, …) extends
`Omit<React.HTMLAttributes<...>, "<owned props>">` and spreads `{...rest}` onto
the root element so any standard DOM attribute (event handlers, `id`, `name`,
`tabIndex`, `aria-*`, `data-*`) bypasses the component automatically. Textarea
was authored without this pattern — that's the bug.

**Resolution.** Refactor `Textarea` to match the rest of UIKit (one focused
refactor, no per-prop churn going forward). See Step 0 below.

### C5b — Style/className escape hatch must stay closed

**Concern.** When extending `HTMLAttributes<HTMLDivElement>`, the inherited
type lets the caller pass `style` and `className`. Rule 7 forbids that on UIKit
components.

**Resolution.** Include `"style" | "className"` in the `Omit` list (matches
how `Panel`, `Select`, `ListBox`, `Tree` already enforce Rule 7). The TS error
the caller gets if they try to pass `style`/`className` is the rule's enforcement
mechanism.

### C6 — Native `<select>` to UIKit `Select` migration

**Concern.** `<select>`/`<option>` is value-keyed by string; UIKit `Select`
takes `IListBoxItem[]` and emits the resolved item.

**Resolution.** Convert two link-behavior options to a constant array:
```tsx
const LINK_BEHAVIOR_ITEMS: IListBoxItem[] = [
    { value: "default-browser",  label: "Open in default OS browser" },
    { value: "internal-browser", label: "Open in internal Browser tab" },
];

<Select
    items={LINK_BEHAVIOR_ITEMS}
    value={LINK_BEHAVIOR_ITEMS.find((i) => i.value === linkBehavior) ?? null}
    onChange={(item) => settings.set("link-open-behavior", item.value as "default-browser" | "internal-browser")}
/>
```

### C7 — `<input type="checkbox">` + `<label htmlFor>` to UIKit `Checkbox`

**Concern.** UIKit `Checkbox` puts the label as `children`, removing the
need for `htmlFor`/`id` pairing.

**Resolution.** Replace each checkbox + adjacent `<label>` with:
```tsx
<Checkbox checked={mcpEnabled} onChange={handleToggle}>
    Enable MCP server
</Checkbox>
<Checkbox checked={!!browserToolsEnabled} disabled={!!mcpEnabled} onChange={handleBrowserToolsToggle}>
    Enable browser interaction
</Checkbox>
```
Preserve the disabled state on browser-tools toggle.

### C8 — `<h1 className="settings-title">` rendering

**Concern.** UIKit `Text` is `<span>`-based; semantic `<h1>` is lost.

**Resolution.** Use `Text size="xxl" bold align="left"` with a wrapping
`Panel paddingBottom="lg"`. The visual is preserved; semantic heading is lost.
Acceptable for an internal settings page (no SEO, no document outline). If
strong heading semantics are desired, use a plain `<h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, marginBottom: 24, color: color.text.default }}>` — also Rule-7-compliant since `<h1>` is a plain HTML element.
**Recommendation:** plain `<h1 style={...}>` to keep semantic heading; no Emotion involved.

### C9 — Scope is much larger than the original placeholder

**Concern.** The placeholder said "swap TextAreaField + WithPopupMenu". Actual
work also includes:
- Removing the entire `SettingsEditorRoot` `styled.div` block (~530 lines).
- Migrating ~12 inline `<input>` (text + checkbox + number-as-text) call sites.
- Migrating ~25+ inline `<button>` call sites.
- Migrating 1 native `<select>`.
- Migrating 7 `<hr className="divider">` to `<Divider />`.
- Converting layout `<div className="...">` containers to `Panel`s.
- Migrating visual atoms: colored circles (color-swatch, profile-color-dot, mcp-status-dot, color-picker MenuItem icons) to UIKit `Dot`; theme-card and theme-preview stay as inline-styled plain `<div>`s (Settings-specific bespoke chrome).

**Resolution.** Treat as one large task; budget ~4-6 hours of focused work.
Implementation plan below is sized accordingly.

### C10 — Files that need NO changes

- `src/renderer/editors/settings/index.ts` (if exists) — no logic.
- `src/renderer/api/settings.ts` — settings model untouched.
- `src/renderer/theme/themes/*` — theme definitions untouched.
- `src/renderer/theme/palette-colors.ts` — `TAG_COLORS` and `DEFAULT_BROWSER_COLOR` untouched.
- `src/renderer/theme/language-icons.tsx` — `IncognitoIcon`, `TorIcon` untouched (used as React nodes inside the settings page).
- All `src/renderer/components/*` old primitives — left in place per the project rule (no cleanup until the full migration is done).

## Implementation plan

All work happens in one file:
`src/renderer/editors/settings/SettingsPage.tsx`.

The work is incremental — do step 1 first, then verify the page still mounts;
each subsequent step swaps one section at a time so visual regressions are
isolatable.

### Step 0 — UIKit primitive prerequisites

Two small UIKit changes precede the SettingsPage rewrite. Both are independent
and could be done in either order; both are general-purpose improvements that
will benefit other migrations (US-499 through US-502) as well.

#### Step 0a — Refactor UIKit `Textarea` to spread DOM attributes (UIKit convention)

File: `src/renderer/uikit/Textarea/Textarea.tsx`

The current `TextareaProps` enumerates every supported prop, which means
`onBlur`, `onFocus`, `id`, `tabIndex`, `data-*`, `aria-*` (beyond the two it
explicitly lists), and most other standard DOM attributes are not bypassed to
the underlying `<div>`. This is inconsistent with every other UIKit primitive
(Input, Button, IconButton, Panel, …) which all extend
`Omit<React.HTMLAttributes<...>, "<owned props>">` and spread `{...rest}` onto
the root.

Bring Textarea in line:

**1. Replace the `TextareaProps` interface:**

```tsx
export interface TextareaProps
    extends Omit<
        React.HTMLAttributes<HTMLDivElement>,
        // Rule 7 — forbid style/className on UIKit components.
        | "style" | "className"
        // Reimplemented with a string-value API instead of an event API.
        | "onChange" | "onInput"
        // Owned by the component (single-line stripping, paste handling, contentEditable).
        | "onPaste" | "onKeyDown"
        | "contentEditable"
        // The component's content comes from `value`, not `children`.
        | "children"
        // Never make sense on a contentEditable surface.
        | "dangerouslySetInnerHTML"
    > {
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
    /** Minimum height in px. */
    minHeight?: number;
    /** Maximum height in px before vertical scrolling kicks in. */
    maxHeight?: number;
    /** Size variant — controls font size. Default: "md". */
    size?: "sm" | "md";
    /** Auto-focus on mount. Default: false. */
    autoFocus?: boolean;
}
```

Drop the now-redundant `aria-label?: string;` and `aria-labelledby?: string;`
fields — they come for free from `HTMLAttributes<HTMLDivElement>`.

**2. Update the destructure + spread in the function body:**

```tsx
export const Textarea = React.forwardRef<TextareaRef, TextareaProps>(
    function Textarea(props, ref) {
        const {
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
            ...rest        // ← bypassed to <Root> automatically
        } = props;
        ...
```

**3. Update the JSX so `{...rest}` comes BEFORE the props the component owns**
(so the caller can never accidentally overwrite the owned ones):

```tsx
return (
    <Root
        ref={divRef}
        {...rest}
        role="textbox"
        aria-multiline={!singleLine}
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
```

`{...rest}` placement matters — owned props after `rest` win, so
`data-type="textarea"` etc. cannot be overridden by callers. `style` is set by
the component (for `minHeight`/`maxHeight`); since `style` is in the `Omit`
list, callers can't pass their own style anyway.

**4. Update `Textarea.story.tsx`** — verify nothing in stories relied on the
removed explicit `aria-label`/`aria-labelledby` props (they still work, just via
the spread now).

**5. Verify other call sites** of `<Textarea>` in the repo (if any) still
type-check after the prop surface change.

**Why this is the right scope:** removes the per-prop-extension churn pattern
(next caller would have asked for `onFocus`, then `tabIndex`, then `id`…),
brings Textarea in line with the rest of UIKit, and resolves C5 permanently.
After this step the search-extensions field's `onBlur` works without any further
Textarea change.

#### Step 0b — Add `width` / `minWidth` / `maxWidth` props to UIKit `Input`

File: `src/renderer/uikit/Input/Input.tsx`

The current `Input` always fills 100% of its parent (the `Wrapper` styled
component has `width: "100%"`). Tor port / MCP port / VLC stream port inputs in
Settings are 56px / 72px / 56px wide — and similar fixed-width number inputs
will recur in upcoming migrations (US-501 RestClient port, US-500 TextEditor
toolbar inputs, etc.). Adding intrinsic-sizing props to the primitive avoids
the "wrap every tiny input in a Panel" noise.

Pattern matches what's already in the library:
- `Panel` exposes `width` / `minWidth` / `maxWidth` / `height` / `minHeight` / `maxHeight`.
- `Textarea` already exposes `minHeight` / `maxHeight` on the height axis (after Step 0a it'll keep these).

**1. Extend `InputProps`:**

```tsx
export interface InputProps
    extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "size"> {
    /** Change handler — receives the string value directly, not the event. */
    onChange?: (value: string) => void;
    /** Control height. Default: "md". */
    size?: "sm" | "md";
    /** Content rendered inside the input chrome, before the text. */
    startSlot?: React.ReactNode;
    /** Content rendered inside the input chrome, after the text. */
    endSlot?: React.ReactNode;
    /** Fixed width — number → px, string passes through. Default: fills parent (100%). */
    width?: number | string;
    /** Minimum width — number → px, string passes through. */
    minWidth?: number | string;
    /** Maximum width — number → px, string passes through. */
    maxWidth?: number | string;
}
```

**2. Apply the new props via inline `style` on `<Wrapper>`.** Pulled from
`props`, defaults preserved:

```tsx
function Input(
    { onChange, size = "md", disabled, readOnly, startSlot, endSlot,
      width, minWidth, maxWidth, ...rest },
    ref,
) {
    ...
    const wrapperStyle: React.CSSProperties = {};
    if (width !== undefined)     wrapperStyle.width = width;
    if (minWidth !== undefined)  wrapperStyle.minWidth = minWidth;
    if (maxWidth !== undefined)  wrapperStyle.maxWidth = maxWidth;

    return (
        <Wrapper
            data-type="input"
            data-size={size}
            data-disabled={disabled || undefined}
            data-readonly={readOnly || undefined}
            style={wrapperStyle}
        >
            ...
        </Wrapper>
    );
}
```

`Wrapper`'s baked-in `width: "100%"` stays as the default; the inline style
overrides only when the caller specifies a width-axis prop. Number values
pass through to React, which serializes plain numbers as `px` (same convention
Panel uses).

**3. Verify `Input.story.tsx`** — add a story demonstrating fixed-width
variants (e.g. `width={56}` for a port input).

**4. Update consumers (none right now)** — Select uses Input internally with
no width prop, so it remains 100%-of-popover-anchor as before.

**Where the line is.** `width` / `minWidth` / `maxWidth` are intrinsic sizing
("this input is N pixels wide") — primitive concern. `flex`, `margin`, sibling
positioning stay on the parent `Panel`. Don't add those to Input.

### Step 1 — Replace import block; remove `SettingsEditorRoot`

In `SettingsPage.tsx`:
- Remove: `import styled from "@emotion/styled";`
- Remove: `import { TextAreaField, TextAreaFieldRef } from "../../components/basic/TextAreaField";`
- Remove: `import { WithPopupMenu } from "../../components/overlay/WithPopupMenu";`
- Remove: `import { MenuItem } from "../../components/overlay/PopupMenu";`
- Add:
  ```tsx
  import {
      Panel, Button, IconButton, Input, Textarea, TextareaRef,
      Select, IListBoxItem, Checkbox, Divider, Text, Dot,
      WithMenu, MenuItem,
  } from "../../uikit";
  import { CloseIcon } from "../../theme/icons"; // verify exact name; pick close-x icon
  ```
- Delete the entire `SettingsEditorRoot = styled.div({...})` block (lines 29-564).
- Replace the outermost `<SettingsEditorRoot>` with a `<Panel>` wrapper (see step 2).

### Step 2 — Outer chrome: `<SettingsEditorRoot>` → `<Panel>`

Old (lines 1450-1452):
```tsx
<SettingsEditorRoot>
    <div className="settings-card">
        <h1 className="settings-title">Settings</h1>
```

New:
```tsx
<Panel
    flex
    direction="column"
    align="center"
    padding="xxxl"
    overflow="auto"
>
    <Panel
        direction="column"
        width="100%"
        maxWidth={500}
        padding="xxxl"
        background="light"
        rounded="md"
    >
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, color: color.text.default, marginBottom: 24 }}>
            Settings
        </h1>
        ...
    </Panel>
</Panel>
```

Note: `padding: 32` in old code → `padding="xxxl"` (or `"xl"` — verify token
scale — the spacing tokens are referenced from `uikit/tokens.ts`). If token
doesn't exist for 32, use a Panel `paddingX={32}` style — Panel accepts size
keys, not raw px, so we may need a pixel-equivalent token from the scale.
Confirm tokens by reading `src/renderer/uikit/tokens.ts` at implementation time.

### Step 3 — Section labels and hints (the typography classes)

Replace these inline styles using `Text`:
- `<div className="section-label">X</div>` → `<Text bold size="sm">X</Text>` (with a `<Panel paddingBottom="sm">` wrapper for the marginBottom: 12).
- `<div className="theme-section-label">X</div>` → `<Text variant="uppercased" color="light" bold size="xs">X</Text>` (with `<Panel paddingBottom="xs">`).
- `<div className="section-hint">X</div>` → `<Text color="light" size="xs">X</Text>` (with `<Panel paddingBottom="xs">`).

Keep these utilities consistent across all sections.

### Step 4 — `<hr className="divider">` → `<Divider />`

Replace each of the 8+ `<hr className="divider" />` occurrences with
`<Divider />`. Add a wrapping `<Panel paddingY="lg">` if the visual gap above/below
shifts.

### Step 5 — Theme grid (`renderThemeGrid`)

Convert:
```tsx
<div className="theme-grid">
    {themes.map((theme) => (
        <div className={`theme-card${currentThemeId === theme.id ? " active" : ""}`} onClick={...}>
            <ThemePreview ... />
            <span className="theme-name">{theme.name}</span>
        </div>
    ))}
</div>
```

To:
```tsx
<Panel direction="row" wrap gap="sm" paddingBottom="md">
    {themes.map((theme) => (
        <Panel
            key={theme.id}
            direction="column"
            align="center"
            gap="sm"
            paddingY="md"
            paddingX="md"
            minWidth={120}
            background="dark"
            border
            borderColor={currentThemeId === theme.id ? "active" : "default"}
            rounded="md"
            onClick={() => handleThemeChange(theme.id)}
        >
            <ThemePreview ... />
            <Text size="sm" align="center">{theme.name}</Text>
        </Panel>
    ))}
</Panel>
```

`Panel` accepts `onClick` since it spreads the rest of `HTMLAttributes`. Add a
`style={{ cursor: "pointer" }}` — wait, that's `style=` on Panel, forbidden.
Resolution: Panel **does not have a `cursor` prop**, and `style=` on Panel is a
TS error. **Action**: extend Panel with `cursor?: "pointer" | "default"` OR
wrap each card in a `<div style={{ cursor: "pointer" }}>` plain HTML element
that contains the Panel inside. The plain wrapper is cleaner — pick this.

Update plan: wrap each card in
```tsx
<div key={theme.id} onClick={() => handleThemeChange(theme.id)} style={{ cursor: "pointer" }}>
    <Panel direction="column" ...>...</Panel>
</div>
```

(`style={...}` on plain `<div>` is allowed; only forbidden on UIKit components.)

`ThemePreview` itself uses `<div className="theme-preview">` and children — convert to inline-styled plain `<div>`s (no className, all inline styles), since it's a presentation-only helper internal to this file.

### Step 6 — Search-extensions Textarea

Replace:
```tsx
<TextAreaField
    ref={extensionsRef}
    className="extensions-field"
    singleLine
    value={extensionsText}
    onBlur={handleExtensionsBlur}
/>
```

With:
```tsx
<Textarea
    ref={extensionsRef}
    singleLine
    value={extensionsText}
    onBlur={handleExtensionsBlur}
    maxHeight={200}
    size="sm"
/>
```

Update ref type: `useRef<TextareaRef>(null);` (was `TextAreaFieldRef`).
`extensionsRef.current?.getText()` — same API on UIKit Textarea ✓.

### Step 7 — Browser Profiles section

Major changes (spans `BrowserProfilesSection` and `TorProfileRow`):
- `<div className="profile-list">` → `<Panel direction="column" gap="xs" paddingBottom="sm">`
- `<div className="profile-row-group">` → `<Panel direction="column" rounded="sm" background="dark">` (drop hover-reveal — see C4).
- `<div className="profile-row">` → `<Panel direction="row" align="center" gap="sm" paddingX="sm" paddingY="xs">`
- `<div className="profile-bookmarks-line">` → `<Panel direction="row" align="center" gap="xs" paddingX="md" paddingTop="xs" paddingBottom="sm">` (preserve the indent via `paddingLeft`).
- `<span className="profile-color-dot">` (default-profile + incognito + tor rows — **non-clickable**) → `<Dot size="md" color={profile.color} bordered />` (or `color={DEFAULT_BROWSER_COLOR}` for the Default profile row).
- `<span className="profile-color-dot clickable">` (custom profile rows — **clickable**, inside `WithMenu` trigger) → wrap a clickable `Dot` inside `WithMenu`'s render-prop:
  ```tsx
  <WithMenu items={getColorMenuItems(profile.name, profile.color)}>
      {(setOpen) => (
          <Dot
              size="md"
              color={profile.color}
              bordered
              onClick={(e) => setOpen(e.currentTarget)}
              title="Change color"
          />
      )}
  </WithMenu>
  ```
  `Dot` spreads `HTMLAttributes<HTMLSpanElement>` so `onClick` and `title` flow through; presence of `onClick` activates the hover-ring affordance automatically.
- `getColorMenuItems` color-picker `MenuItem.icon` (10px circles in the popup menu, currently inline `<span style={{...borderRadius: "50%"...}}/>`):
  ```tsx
  icon: <Dot size={10} color={c.hex} />,
  ```
- `<span className="profile-name">` → `<Text size="sm" style={{ flex: 1 }}>` — wait, `style=` on Text is forbidden too. Use `<Panel flex direction="row" align="center"><Text size="sm">{name}</Text></Panel>` or wrap the whole row using `<Panel flex>` around the name. Better: parent profile-row Panel uses `gap` and the name Text is just a Text; the parent's flex layout handles spacing.
- `<span className="profile-default-badge">` → `<Panel paddingX="sm" paddingY="none" border rounded="sm"><Text variant="uppercased" color="light" size="xs">default</Text></Panel>`.
- `<button className="profile-set-default">` → `<Button variant="ghost" size="sm" onClick={...}>set default</Button>`.
- `<button className="profile-clear-data">` → `<Button variant="ghost" size="sm" onClick={...}>clear data</Button>` (always visible — see C4).
- `<button className="profile-remove">` → `<IconButton size="sm" icon={<CloseIcon />} onClick={...} />` (always visible).
- `<span className="profile-cleared">` → `<Text color="success" size="xs">Cleared</Text>`.
- `<span className="profile-bookmarks-path">` (clickable) → plain `<span style={{ cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={...} onClick={...}>{filename}</span>`. Inline `style=` on plain `<span>` is allowed.
- `<span className="profile-bookmarks-placeholder">` → plain `<span style={{ fontStyle: "italic", cursor: "pointer", color: color.text.light }} onClick={...}>...</span>`.
- `<button className="profile-bookmarks-clear">` → `<IconButton size="sm" icon={<CloseIcon />} title="Remove bookmarks file" onClick={...} />`.
- `<input className="profile-name-input">` → `<Input size="sm" placeholder="Profile name" value={newName} onChange={setNewName} onKeyDown={handleKeyDown} />`. (Wrap in `<Panel flex>` so it fills the row.)
- `<button className="profile-add-button">` → `<Button variant="default" size="sm" disabled={!canAdd} onClick={handleAddProfile}>Add</Button>`.
- `<div className="color-palette">` → `<Panel direction="row" wrap gap="xs">`.
- `<span className="color-swatch">` (18px palette swatch in the "Add profile" form) → `<Dot size="lg" color={c.hex} selected={newColor === c.hex} onClick={() => setNewColor(c.hex)} title={c.name} />`. `Dot` handles the selection ring (2px `text.default` `box-shadow`) without affecting layout.
- `<span className="settings-field-label">` (e.g., "tor.exe:", "Port:") → `<Text color="dark" size="xs">tor.exe:</Text>` (with appropriate min-width via wrapping Panel).

For the **port input** (TorProfileRow):
```tsx
<Input
    size="sm"
    width={56}
    type="text"
    value={portValue}
    onChange={setPortValue}
    onBlur={handlePortBlur}
    onKeyDown={handlePortKeyDown}
/>
```

### Step 8 — `LinkBehaviorSection`

Old: native `<select className="settings-select">` with `<option>`s.

New:
```tsx
const LINK_BEHAVIOR_ITEMS: IListBoxItem[] = [
    { value: "default-browser",  label: "Open in default OS browser" },
    { value: "internal-browser", label: "Open in internal Browser tab" },
];

function LinkBehaviorSection() {
    const linkBehavior = settings.use("link-open-behavior");
    return (
        <Panel maxWidth={300}>
            <Select
                items={LINK_BEHAVIOR_ITEMS}
                value={LINK_BEHAVIOR_ITEMS.find((i) => i.value === linkBehavior) ?? null}
                onChange={(item) => settings.set(
                    "link-open-behavior",
                    item.value as "default-browser" | "internal-browser",
                )}
            />
        </Panel>
    );
}
```

### Step 9 — `DefaultBrowserSection`

- `<div className="browser-reg-row">` → `<Panel direction="row" align="center" gap="sm" wrap>`.
- `<span className="browser-reg-status">` → `<Text size="sm" color="light">Checking...</Text>`.
- `<span className="browser-reg-status registered">` → `<Text size="sm" color="success">Registered</Text>`.
- `<button className="link-button">` → `<Button variant="link" size="sm" disabled={busy} onClick={...}>...</Button>`.

### Step 10 — `McpSection`

- `<div className="mcp-toggle-row">` → `<Panel direction="row" align="center" gap="sm" paddingBottom="sm">`.
- `<input type="checkbox">` + `<label>` → `<Checkbox checked={...} onChange={...}>label text</Checkbox>` (see C7).
- `<div className="mcp-field-row">` → same layout as toggle-row but with `<Text>` label and `<Input>`:
  ```tsx
  <Panel direction="row" align="center" gap="sm" paddingBottom="sm">
      <Text size="sm">Port:</Text>
      <Input
          size="sm"
          width={72}
          type="text"
          value={portValue}
          onChange={setPortValue}
          onBlur={handlePortBlur}
          onKeyDown={handlePortKeyDown}
          disabled={mcpEnabled}
      />
  </Panel>
  ```
- `<div className="mcp-status-line">` → `<Panel direction="row" align="center" gap="xs" paddingBottom="sm">`.
- `<span className="mcp-status-dot">` (8px running/idle indicator) → `<Dot size="sm" color={status.running ? "success" : "neutral"} />`.
- `<div className="mcp-url-row">` → `<Panel direction="row" align="center" gap="sm" paddingBottom="sm">`.
- `<span className="mcp-url">` → plain `<span style={{ fontSize: 12, fontFamily: "monospace", padding: "4px 8px", backgroundColor: color.background.dark, borderRadius: 4, border: \`1px solid \${color.border.default}\`, color: color.text.default, userSelect: "all" }}>{status.url}</span>`. Inline `style=` on plain `<span>` is allowed.
- `<button className="mcp-copy-button">` → `<Button variant="default" size="sm" onClick={...}>Copy</Button>`.
- `<div className="mcp-config">` → plain `<pre style={{ fontSize: 11, fontFamily: "monospace", lineHeight: 1.5, padding: "8px 12px", backgroundColor: color.background.dark, borderRadius: 4, border: \`1px solid \${color.border.default}\`, color: color.text.default, overflow: "auto", margin: 0 }}>{configJson}</pre>` — `<pre>` preserves the newlines that JSON.stringify produced; `<pre>` whitespace handling replaces `whiteSpace: "pre"` from the old class.

### Step 11 — `ScriptLibrarySection` and `DrawingLibrarySection`

Both have identical structure:
- `<div className="library-path-row">` → `<Panel direction="row" align="center" gap="sm" paddingBottom="sm">`.
- `<div className="library-path-display">` → `<Panel flex paddingY="sm" paddingX="sm" background="dark" border rounded="sm" overflow="hidden">` containing a `<Text size="sm" truncate>` (for the path) or `<Text size="sm" italic color="light">Not linked</Text>` (placeholder).
- `<button className="link-button">` → `<Button variant="link" size="sm">...</Button>`.

### Step 12 — `VideoPlayerSection`

Same patterns as `TorProfileRow`:
- profile-row-group → `<Panel direction="column" rounded="sm" background="dark">`.
- profile-bookmarks-line rows → `<Panel direction="row" align="center" gap="xs" paddingX="md" paddingY="xs">`.
- vlc.exe path link/placeholder → plain `<span style={...}>` like in step 7.
- × button → `<IconButton size="sm" icon={<CloseIcon />} title="Remove VLC path" />`.
- Stream port input → `<Input size="sm" width={56} .../>`.

### Step 13 — `BookmarksFileLine` helper

Replace the inline-element JSX with the same plain-element + `IconButton`
pattern used in step 7. This helper is used 4 times (default profile, each
custom profile, incognito, tor); migrating it once eliminates 4 duplicated
classNames.

### Step 14 — "View Settings File" button

Last button in the page:
```tsx
<button className="link-button" onClick={handleOpenSettingsFile}>
    View Settings File
</button>
```
→ `<Button variant="link" size="sm" onClick={handleOpenSettingsFile}>View Settings File</Button>`.

### Step 15 — Verification

- `npm run lint` — clean.
- `npx tsc --noEmit` — only pre-existing unrelated errors remain (record baseline in commit message).
- Open Settings tab, verify each section renders without layout regression.
- Toggle theme — active border highlights correctly.
- Add/remove browser profile — color picker (WithMenu) opens; row layout intact.
- Toggle MCP server — status line appears; checkbox click works.
- Save search-extensions on blur — value persists after focus leaves.
- All link buttons clickable.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/uikit/Textarea/Textarea.tsx` | Refactor `TextareaProps` to extend `Omit<HTMLAttributes<HTMLDivElement>, …owned props>` and spread `{...rest}` onto `<Root>` (Step 0a) — brings the component in line with the rest of UIKit |
| `src/renderer/uikit/Textarea/Textarea.story.tsx` | Verify stories still pass after the prop-surface change (Step 0a) |
| `src/renderer/uikit/Input/Input.tsx` | Add `width` / `minWidth` / `maxWidth` props (Step 0b); apply via inline `style` on `<Wrapper>` so the existing 100%-default is preserved when unset |
| `src/renderer/uikit/Input/Input.story.tsx` | Add a story demonstrating fixed-width variants (Step 0b) |
| `src/renderer/editors/settings/SettingsPage.tsx` | Full migration per steps 1-14 |

Files **not** changed (verified):
- `src/renderer/api/settings.ts`
- `src/renderer/theme/themes/*`
- `src/renderer/theme/palette-colors.ts`
- `src/renderer/theme/language-icons.tsx`
- `src/renderer/components/*` (old primitives stay)
- All other settings-adjacent code

## Acceptance criteria

- [ ] No imports from `components/basic|form|layout|overlay/` in `editors/settings/`.
- [ ] No `import styled from "@emotion/styled"` in `editors/settings/`.
- [ ] No `style=` or `className=` props passed to UIKit components.
- [ ] `npm run lint` clean.
- [ ] `npx tsc --noEmit` reports no new errors (baseline pre-existing errors unchanged).
- [ ] Manual smoke test passes:
    - All sections render without layout regression at default theme + sidebar widths.
    - Theme switcher: clicking a card applies and persists; active card is bordered.
    - Browser profiles: add, remove, set default, clear data, change color (popup menu) all work; profile color dots render correctly; clickable dot opens the color-picker menu; color swatches in the "Add profile" form show the selection ring on the chosen color.
    - MCP toggle, browser-tools toggle (disabled when MCP enabled): both checkboxes work; MCP status dot turns green when running.
    - Port inputs (Tor, MCP, Stream): edit + Enter/blur commits the value.
    - Link-open-behavior Select: dropdown opens, selection persists.
    - Search-extensions Textarea: edit + blur commits the parsed list.
    - Library paths: Browse, Unlink, Reset all functional.
    - "View Settings File" link opens the JSON.

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at
EPIC-025 close per the epic's deferred review model.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
