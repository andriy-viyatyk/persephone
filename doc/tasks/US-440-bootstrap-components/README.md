# US-440: Bootstrap Component Set — Minimal Components for Storybook

## Goal

Implement the minimal set of UIKit components that the Storybook editor (US-434, Phase 3) needs to build its own UI. Pure new code — no replacement of existing components, no Storybook testing yet. This unblocks Phase 3.

## Background

Phase 1 delivered layout primitives (Flex, HStack, VStack, Panel, Card, Spacer) and design tokens. The Storybook editor UI (Phase 3) needs interactive controls beyond layout — buttons, inputs, labels, checkboxes — to build its component browser, live preview, and property editor panels.

### What the Storybook shell needs

- **Component browser** (left panel) — clickable list of components, section headers
- **Live preview** (center) — component rendered inside a Panel/Card
- **Property editor** (right/bottom panel) — form controls for editing props:
  - String/number values → Input
  - Boolean values → Checkbox
  - Enum values → can use existing ComboSelect temporarily; SegmentedControl added later
  - Section breaks → Divider
  - Prop labels → Label
- **Action buttons** — Button, IconButton for toolbar/actions
- **Text display** — component names, descriptions, section headings

### Existing patterns to follow

All components follow the rules in `src/renderer/uikit/CLAUDE.md`:
- `data-type` attribute on root element (kebab-case)
- `data-*` state attributes for interactive state (not CSS classes)
- Emotion styled with `{ label: "Name" }` second argument
- Controlled components (no internal state for primary value)
- Design tokens from `uikit/tokens.ts`
- Colors from `theme/color.ts`

### Reference: existing component implementations

| Old component | File | Relevant patterns |
|---------------|------|-------------------|
| `Button` | `src/renderer/components/basic/Button.tsx` | Variants (flat/raised/icon), sizes (small/medium), loading state, tooltip integration. Uses `clsx` for CSS classes (we use data attributes instead). Uses `forwardRef`. |
| `Checkbox` | `src/renderer/components/basic/Checkbox.tsx` | Icon-based (`CheckedIcon`/`UncheckedIcon` from `theme/icons.tsx`), fully controlled, `<label>` wrapper, gap 4px. |
| `InputBase` | `src/renderer/components/basic/InputBase.tsx` | `styled.input`, dark bg, light border, active/focus border color change. |
| `Input` | `src/renderer/components/basic/Input.tsx` | Wrapper with start/end adornments over `InputBase`. Uses `forwardRef`. |

## Components to Implement (7)

### 1. Button

Interactive button with variants and sizes.

**Folder:** `src/renderer/uikit/Button/`

**Props:**
```tsx
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** Visual style. Default: "default". */
    variant?: "default" | "primary" | "ghost" | "danger";
    /** Control height. Default: "md". */
    size?: "sm" | "md";
    /** Icon rendered before children. */
    icon?: React.ReactNode;
}
```

- Uses `children` from `HTMLButtonElement` attrs for label content
- `disabled` comes from native button attrs
- Uses `forwardRef` (needed for tooltip positioning, programmatic focus)

**Styled root:** `styled.button` with base styles:
```
display: inline-flex, alignItems: center, gap: gap.md (6px),
cursor: pointer, border: 1px solid transparent, borderRadius: radius.md (4px),
outline: none, userSelect: none, textWrap: nowrap,
fontSize: fontSize.base (14px), color: color.text.default
```

**Variant styles (via data-variant attribute selectors):**

| Variant | Background | Hover bg | Active bg | Border | Text |
|---------|-----------|----------|-----------|--------|------|
| `default` | `color.background.default` | `color.background.light` | `color.background.dark` | transparent | `color.text.default` |
| `primary` | `color.icon.active` | (10% lighter via filter) | (10% darker via filter) | transparent | `color.text.selection` |
| `ghost` | transparent | `color.background.light` | `color.background.dark` | transparent | `color.text.default` |
| `danger` | transparent | `color.error.background` | `color.error.background` | transparent | `color.error.text` |

**Size styles (via data-size attribute selectors):**

| Size | Height | Padding | Font size |
|------|--------|---------|-----------|
| `sm` | `height.controlSm` (24px) | `0 spacing.sm` (4px) | `fontSize.sm` (12px) |
| `md` | `height.controlMd` (26px) | `0 spacing.md` (8px) | `fontSize.base` (14px) |

**Disabled:** `data-disabled` → `opacity: 0.4, pointerEvents: "none"`

**Icon SVG sizing:** `& svg { width: height.iconMd (16px), height: height.iconMd (16px) }`

---

### 2. IconButton

Icon-only button for compact UI (toolbars, actions).

**Folder:** `src/renderer/uikit/IconButton/`

**Props:**
```tsx
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** The icon to render. */
    icon: React.ReactNode;
    /** Control size. Default: "md". */
    size?: "sm" | "md";
}
```

- `title` for accessible tooltip (from native attrs)
- `disabled` from native attrs
- Uses `forwardRef`

**Styled root:** `styled.button` — transparent bg, no border:
```
display: inline-flex, alignItems: center, justifyContent: center,
cursor: pointer, border: none, background: transparent,
borderRadius: radius.sm (3px), outline: none, padding: spacing.xs (2px)
```

**Size styles:**

| Size | Dimensions | SVG size |
|------|-----------|----------|
| `sm` | `height.controlSm` (24px) square | `height.iconMd` (16px) |
| `md` | `height.controlMd` (26px) square | `height.iconLg` (20px) |

**Icon color states:**
- Default: `color.icon.light`
- Hover: `color.icon.default`
- Active: `color.icon.dark`
- Disabled: `color.icon.disabled`, `pointerEvents: "none"`

---

### 3. Input

Text input field.

**Folder:** `src/renderer/uikit/Input/`

**Props:**
```tsx
export interface InputProps
    extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "size"> {
    /** Change handler — receives the string value directly, not the event. */
    onChange?: (value: string) => void;
    /** Control height. Default: "md". */
    size?: "sm" | "md";
}
```

- `value`, `placeholder`, `disabled`, `readOnly`, `type` come from native attrs
- `onChange` simplified: passes `e.target.value` string directly
- `size` omitted from native attrs (conflicts with HTML `size` attribute meaning)
- Uses `forwardRef` (needed for programmatic focus in property editor)

**Styled root:** `styled.input`:
```
padding: spacing.sm spacing.md (4px 6px),
backgroundColor: color.background.dark,
color: color.text.dark,
border: 1px solid color.border.light,
borderRadius: radius.md (4px),
outline: none, boxSizing: border-box, width: 100%

&:focus / &:active → borderColor: color.border.active
&[data-disabled] → opacity: 0.5, pointerEvents: "none"
```

**Size styles:**

| Size | Height | Font size |
|------|--------|-----------|
| `sm` | `height.controlSm` (24px) | `fontSize.sm` (12px) |
| `md` | `height.controlMd` (26px) | `fontSize.base` (14px) |

---

### 4. Label

Form field label.

**Folder:** `src/renderer/uikit/Label/`

**Props:**
```tsx
export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
    /** Shows a red asterisk after the label text. */
    required?: boolean;
    /** Dims the label. */
    disabled?: boolean;
}
```

- `htmlFor` and `children` come from native attrs
- Semantic `<label>` element

**Styled root:** `styled.label`:
```
fontSize: fontSize.sm (12px),
color: color.text.light,
userSelect: none,
display: inline-flex, gap: spacing.xs (2px)

&[data-disabled] → opacity: 0.5
```

**Required indicator:** When `required` is true, render `<span>` with `*` in `color.error.text` after children.

---

### 5. Checkbox

Boolean toggle with label.

**Folder:** `src/renderer/uikit/Checkbox/`

**Props:**
```tsx
export interface CheckboxProps
    extends Omit<React.HTMLAttributes<HTMLLabelElement>, "onChange"> {
    /** Checked state (controlled). */
    checked: boolean;
    /** Change handler — receives the new boolean value. */
    onChange: (checked: boolean) => void;
    /** Disables interaction. */
    disabled?: boolean;
}
```

- `children` for label text (from HTMLAttributes)
- Uses `<label>` as root for accessibility (click on label toggles checkbox)
- Icon-based: imports `CheckedIcon` and `UncheckedIcon` from `../../theme/icons`

**Styled root:** `styled.label`:
```
display: inline-flex, alignItems: center, gap: gap.sm (4px),
cursor: pointer, userSelect: none, color: color.text.default

& [data-part="icon"] → flexShrink: 0, width: height.iconMd (16px),
                        height: height.iconMd (16px), color: color.text.light
&:hover [data-part="icon"] → color: color.text.default
&[data-disabled] → cursor: default, opacity: 0.5
&[data-disabled]:hover [data-part="icon"] → color: color.text.light (revert hover)
```

**Click handler:** Calls `onChange(!checked)` on click. Does nothing when `disabled`.

---

### 6. Divider

Horizontal or vertical separator line.

**Folder:** `src/renderer/uikit/Divider/`

**Props:**
```tsx
export interface DividerProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Line direction. Default: "horizontal". */
    orientation?: "horizontal" | "vertical";
}
```

**Styled root:** `styled.div` with `role="separator"`:
```
flexShrink: 0, backgroundColor: color.border.default

Horizontal (default):
  height: 1px, width: 100%

Vertical (data-orientation="vertical"):
  width: 1px, alignSelf: stretch (fills parent height)
```

Uses `aria-orientation` for accessibility.

---

### 7. Text

Text display component with consistent typography.

**Folder:** `src/renderer/uikit/Text/`

**Props:**
```tsx
export interface TextProps extends React.HTMLAttributes<HTMLSpanElement> {
    /** Typography preset. Default: "body". */
    variant?: "heading" | "body" | "caption" | "code";
}
```

- Renders `<span>` by default
- Uses `children` for content

**Variant styles (via data-variant attribute selectors):**

| Variant | Font size | Color | Weight | Extra |
|---------|-----------|-------|--------|-------|
| `heading` | `fontSize.lg` (16px) | `color.text.default` | 600 | — |
| `body` | `fontSize.base` (14px) | `color.text.default` | normal | — |
| `caption` | `fontSize.sm` (12px) | `color.text.light` | normal | — |
| `code` | `fontSize.md` (13px) | `color.text.default` | normal | `fontFamily: monospace` |

---

## Implementation Plan

### Step 1: Create Button and IconButton

1. Create `src/renderer/uikit/Button/Button.tsx`:
   - Define `ButtonProps` extending `React.ButtonHTMLAttributes<HTMLButtonElement>`
   - `Root = styled.button(...)` with base styles + variant/size/disabled attribute selectors
   - Export `Button` as a `forwardRef` component
   - Set `data-type="button"`, `data-variant`, `data-size`, `data-disabled`
   - Render: `<Root data-type="button" data-variant={variant} data-size={size} data-disabled={disabled || undefined} type="button" {...rest}>{icon}{children}</Root>`

2. Create `src/renderer/uikit/Button/index.ts`:
   - Export `Button` and `ButtonProps`

3. Create `src/renderer/uikit/IconButton/IconButton.tsx`:
   - Define `IconButtonProps` extending `React.ButtonHTMLAttributes<HTMLButtonElement>`
   - `Root = styled.button(...)` with transparent bg + icon color states
   - Export `IconButton` as a `forwardRef` component
   - Set `data-type="icon-button"`, `data-size`, `data-disabled`
   - Render: `<Root ... type="button" {...rest}><span data-part="icon">{icon}</span></Root>`

4. Create `src/renderer/uikit/IconButton/index.ts`:
   - Export `IconButton` and `IconButtonProps`

### Step 2: Create Input

1. Create `src/renderer/uikit/Input/Input.tsx`:
   - Define `InputProps` extending `Omit<InputHTMLAttributes, "onChange" | "size">`
   - `Root = styled.input(...)` with dark bg, light border, focus state
   - Export `Input` as a `forwardRef` component
   - Internal `handleChange` extracts `e.target.value` and passes to `onChange`
   - Set `data-type="input"`, `data-size`, `data-disabled`

2. Create `src/renderer/uikit/Input/index.ts`:
   - Export `Input` and `InputProps`

### Step 3: Create Label, Checkbox, Divider, Text

1. Create `src/renderer/uikit/Label/Label.tsx`:
   - `Root = styled.label(...)` with small font, light color
   - Set `data-type="label"`, `data-disabled`
   - Render required asterisk as `<span style={{ color: color.error.text }}>*</span>` when `required`

2. Create `src/renderer/uikit/Label/index.ts`

3. Create `src/renderer/uikit/Checkbox/Checkbox.tsx`:
   - `Root = styled.label(...)` with icon + label layout
   - Import `CheckedIcon`, `UncheckedIcon` from `../../theme/icons`
   - Set `data-type="checkbox"`, `data-checked={String(checked)}`, `data-disabled`
   - Click handler calls `onChange(!checked)` when not disabled

4. Create `src/renderer/uikit/Checkbox/index.ts`

5. Create `src/renderer/uikit/Divider/Divider.tsx`:
   - `Root = styled.div(...)` with 1px bg color, orientation variants
   - Set `data-type="divider"`, `data-orientation`, `role="separator"`, `aria-orientation`

6. Create `src/renderer/uikit/Divider/index.ts`

7. Create `src/renderer/uikit/Text/Text.tsx`:
   - `Root = styled.span(...)` with variant typography selectors
   - Set `data-type="text"`, `data-variant`

8. Create `src/renderer/uikit/Text/index.ts`

### Step 4: Update barrel exports

Edit `src/renderer/uikit/index.ts` — add exports for all 7 new components:
```typescript
// Bootstrap components (US-440)
export { Button } from "./Button";
export type { ButtonProps } from "./Button";
export { IconButton } from "./IconButton";
export type { IconButtonProps } from "./IconButton";
export { Input } from "./Input";
export type { InputProps } from "./Input";
export { Label } from "./Label";
export type { LabelProps } from "./Label";
export { Checkbox } from "./Checkbox";
export type { CheckboxProps } from "./Checkbox";
export { Divider } from "./Divider";
export type { DividerProps } from "./Divider";
export { Text } from "./Text";
export type { TextProps } from "./Text";
```

### Step 5: Verify

- Run `npx tsc --noEmit` — zero new TypeScript errors
- Verify all 7 components have: `data-type`, design tokens, color imports, Emotion label

## Concerns

1. **Button primary variant — no semantic color token.** The color system has no `button.primary.*` tokens. Proposed workaround: use `color.icon.active` for primary bg and `color.text.selection` for primary text. These map to VSCode's `button.background` and `list.activeSelectionForeground` — semantically close. If this proves inadequate, we can add dedicated `button.*` tokens later (requires updating all 10 theme files).

2. **Checkbox icons.** The existing `CheckedIcon` and `UncheckedIcon` in `src/renderer/theme/icons.tsx` (lines 532, 555) are 16x16 SVG icons. The new Checkbox will import these directly. No new icons needed.

3. **Input onChange signature.** The new Input passes `string` via `onChange` (not `ChangeEvent`). This is intentional — matches the controlled component pattern in CLAUDE.md. Callers needing the raw event can use `onInput` or wrap the component.

4. **forwardRef scope.** Only Button, IconButton, and Input use `forwardRef`. Label, Checkbox, Divider, and Text skip it for simplicity — can be added later if needed.

## Acceptance Criteria

- [ ] All 7 components created in `src/renderer/uikit/` with own subfolder
- [ ] Each component has `data-type` attribute on root element
- [ ] Each component uses design tokens (no hardcoded px values for sizes in token scale)
- [ ] Each component uses `color.*` tokens (no hardcoded colors)
- [ ] Each component has Emotion `{ label: "Name" }` for DevTools
- [ ] Controlled components: Checkbox and Input have no internal state for primary value
- [ ] All components exported from `src/renderer/uikit/index.ts`
- [ ] TypeScript builds with zero new errors
- [ ] Dashboard and epic updated

## Files Changed

| File | Action | Notes |
|------|--------|-------|
| `src/renderer/uikit/Button/Button.tsx` | Create | Button component |
| `src/renderer/uikit/Button/index.ts` | Create | Barrel export |
| `src/renderer/uikit/IconButton/IconButton.tsx` | Create | IconButton component |
| `src/renderer/uikit/IconButton/index.ts` | Create | Barrel export |
| `src/renderer/uikit/Input/Input.tsx` | Create | Input component |
| `src/renderer/uikit/Input/index.ts` | Create | Barrel export |
| `src/renderer/uikit/Label/Label.tsx` | Create | Label component |
| `src/renderer/uikit/Label/index.ts` | Create | Barrel export |
| `src/renderer/uikit/Checkbox/Checkbox.tsx` | Create | Checkbox component |
| `src/renderer/uikit/Checkbox/index.ts` | Create | Barrel export |
| `src/renderer/uikit/Divider/Divider.tsx` | Create | Divider component |
| `src/renderer/uikit/Divider/index.ts` | Create | Barrel export |
| `src/renderer/uikit/Text/Text.tsx` | Create | Text component |
| `src/renderer/uikit/Text/index.ts` | Create | Barrel export |
| `src/renderer/uikit/index.ts` | Edit | Add exports for 7 new components |
| `doc/active-work.md` | Edit | Link US-440 to task doc |
| `doc/epics/EPIC-025.md` | Edit | Update US-440 status |

### Files that need NO changes

- `src/renderer/uikit/tokens.ts` — existing tokens sufficient
- `src/renderer/theme/color.ts` — existing colors sufficient (see Concern #1)
- `src/renderer/theme/themes/*.ts` — no new CSS variables needed
- `src/renderer/theme/icons.tsx` — existing CheckedIcon/UncheckedIcon reused as-is
- `src/renderer/uikit/CLAUDE.md` — no rule changes needed
- `src/renderer/uikit/Flex/`, `Panel/`, `Card/`, `Spacer/` — Phase 1 components unchanged
