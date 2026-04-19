# US-437: Design System HTML — Tokens, Component Library, and Persephone Screen Mockups

## Goal

Create a set of self-contained HTML files that define Persephone's visual language: all color tokens, typography, spacing scale, UI component states, and 3 screen-level mockups of the app. These files serve as the visual specification (equivalent to a Figma design system) that drives all EPIC-025 implementation phases. No React, no build step — open in a browser and review.

## Background

### What exists today

**Color system** (`/src/renderer/theme/color.ts`): CSS custom properties organized into groups — `background`, `text`, `icon`, `border`, `shadow`, `grid`, `misc`, `error`, `success`, `warning`, `highlight`, `minimapSlider`, `graph`.

**Theme values** (`/src/renderer/theme/themes/default-dark.ts`): Actual CSS variable values for the Default Dark theme (primary theme, VSCode-derived palette). This is what the HTML should use at `:root`.

**Existing components** in `/src/renderer/components/`:
- `basic/Button.tsx` — flat / raised / icon variants; small / medium sizes; disabled, loading states; background context (default/light/dark)
- `basic/Checkbox.tsx` — checked/unchecked/disabled using SVG icons
- `basic/Radio.tsx`
- `basic/Input.tsx` / `basic/InputBase.tsx` / `basic/TextField.tsx` — input with adornments, label (above or left), optional end-buttons
- `basic/Chip.tsx` — tag/chip element
- `basic/Breadcrumb.tsx` — path breadcrumb navigation
- `basic/Tooltip.tsx`
- `basic/CircularProgress.tsx` — spinner used inside Button loading state
- `form/ComboSelect.tsx` / `form/List.tsx` / `form/SwitchButtons.tsx`
- `layout/Elements.tsx` — just `FlexSpace` today (the only layout primitive)
- `layout/Splitter.tsx`
- `overlay/PopupMenu.tsx` / `overlay/Popper.tsx`

**No layout primitives yet** — Flex, HStack, VStack, Panel, Card are planned in EPIC-025 Phase 1. The HTML design system should show what they will look like.

### Design token scales (from EPIC-025 Design Decisions)

These should be reflected as CSS custom properties in the HTML files:

```
--space-xs: 2px   --space-sm: 4px   --space-md: 8px
--space-lg: 12px  --space-xl: 16px  --space-xxl: 24px  --space-xxxl: 32px

--radius-xs: 2px  --radius-sm: 3px  --radius-md: 4px
--radius-lg: 6px  --radius-xl: 8px  --radius-full: 50%

--size-icon-sm: 12px  --size-icon-md: 16px  --size-icon-lg: 20px
--size-control-sm: 24px  --size-control-md: 26px  --size-control-lg: 32px

--font-xs: 11px  --font-sm: 12px  --font-md: 13px
--font-base: 14px  --font-lg: 16px  --font-xl: 20px  --font-xxl: 24px

--gap-xs: 2px  --gap-sm: 4px  --gap-md: 6px
--gap-lg: 8px  --gap-xl: 12px  --gap-xxl: 16px
```

## Deliverables

Three HTML files in a new `/design/` directory at the project root:

| File | Contents |
|------|----------|
| `/design/design-system.html` | Full design system: tokens, typography, spacing, all components with states |
| `/design/mockup-main-window.html` | Persephone main window: title bar, tabs, sidebar, editor area, status bar |
| `/design/mockup-dialog.html` | Modal dialog with form fields — shows dialog anatomy and overlay |

Each file is fully self-contained (no external CSS, no external fonts, no CDN dependencies). Font: `'Segoe UI', system-ui, sans-serif` (matches Windows app).

## Implementation Plan

### Step 1 — Create `/design/` directory

Create `/design/` at project root. This is a design-only folder, not part of the build.

### Step 2 — `/design/design-system.html`

Structure: sticky left navigation sidebar + scrollable main content area.

**`:root` CSS variables** — define all color variables using exact values from `default-dark.ts`:
```css
:root {
  /* background */
  --color-bg-default: #1f1f1f;
  --color-bg-dark: #181818;
  --color-bg-light: #313131;
  --color-bg-selection: #0078d4;
  --color-bg-scrollbar: #313131;
  --color-bg-scrollbar-thumb: rgba(121, 121, 121, 0.2);
  --color-bg-message: #313131;
  --color-bg-overlay: rgba(0, 0, 0, 0.6);
  --color-bg-overlay-hover: rgba(0, 0, 0, 0.8);
  /* text */
  --color-text-default: #cccccc;
  --color-text-dark: #cccccc;
  --color-text-light: #969696;
  --color-text-selection: #ffffff;
  --color-text-strong: #dddddd;
  /* icon */
  --color-icon-default: #cccccc;
  --color-icon-dark: #cccccc;
  --color-icon-light: #969696;
  --color-icon-disabled: #585858;
  --color-icon-selection: #ffffff;
  --color-icon-active: #026ec1;
  /* border */
  --color-border-active: #007acc;
  --color-border-default: #3c3c3c;
  --color-border-light: #2b2b2b;
  /* shadow */
  --color-shadow-default: rgba(0, 0, 0, 0.36);
  /* misc */
  --color-misc-blue: #3794ff;
  --color-misc-green: #89d185;
  --color-misc-red: #f88070;
  --color-misc-yellow: #cca700;
  /* error / success / warning */
  --color-error-text: #f88070;
  --color-success-text: #2aaaff;
  --color-warning-text: #cca700;
  /* design tokens */
  --space-xs:2px; --space-sm:4px; --space-md:8px; --space-lg:12px;
  --space-xl:16px; --space-xxl:24px; --space-xxxl:32px;
  --radius-xs:2px; --radius-sm:3px; --radius-md:4px; --radius-lg:6px;
  --radius-xl:8px; --radius-full:50%;
  --font-xs:11px; --font-sm:12px; --font-md:13px; --font-base:14px;
  --font-lg:16px; --font-xl:20px; --font-xxl:24px;
  --gap-xs:2px; --gap-sm:4px; --gap-md:6px; --gap-lg:8px;
  --gap-xl:12px; --gap-xxl:16px;
  --size-control-sm:24px; --size-control-md:26px; --size-control-lg:32px;
}
```

**Section 1: Color Palette**
Show each color group as a row of labeled swatches. Each swatch: colored rectangle + variable name + hex value. Groups: background, text/icon (text samples on colored backgrounds), border, status colors (misc blue/green/red/yellow), error/success/warning.

**Section 2: Typography**
Show each font size with a sample text line: `"The quick brown fox"` at that size. Show alongside: variable name, px value. Also show font-weight variants: regular (400), medium (500), semibold (600).

**Section 3: Spacing Scale**
Visual ruler: for each step (xs→xxxl), show a colored block with width = spacing value, labeled with name and px value. Arrange left to right in a row so relative sizes are immediately visible.

**Section 4: Border Radius Scale**
Row of squares (32×32px solid fill) with border-radius applied for each step. Label each: `xs 2px`, `sm 3px`, etc. Include `full` as a circle.

**Section 5: Elevation**
Three box specimens: flat (no shadow), raised (`box-shadow: 0 1px 4px var(--color-shadow-default)`), overlay (`box-shadow: 0 4px 16px var(--color-shadow-default)`). Labels: "Flat — inline UI", "Raised — floating panel, toolbar button", "Overlay — dialogs, popups".

**Section 6: Components**

Each component subsection shows all variants and states as static specimens. No JavaScript needed — use CSS `:hover` / `:focus` where helpful for reference, but all states should be visible simultaneously in separate specimen boxes.

**6.1 Button**
Grid showing:
- Variants (columns): `flat`, `raised`, `icon`
- States (rows): `default`, `hover`, `active/pressed`, `disabled`, `loading`
- For flat/raised: show with text + icon, text only, icon only
- Size variants: medium (32px) and small (24px)
- Background context variants: on `bg-default`, on `bg-light`, on `bg-dark`

**6.2 Checkbox & Radio**
Pairs: unchecked/checked for each; then disabled variants. Use inline SVG for the check icon (matching the actual icons used in the app — checkmark in a square outline for checked, empty square for unchecked).

**6.3 Input / TextField**
States: default, focused (active border), disabled, with label above, with label left, with start adornment (icon), with end buttons (1-2 small icon buttons). Also show error state (red border hint). Height: 26px (matches existing TextField).

**6.4 Chip / Tag**
Default, with close button, disabled.

**6.5 Breadcrumb**
A 3-segment path: `Root > Category > Item`. Show separator style.

**6.6 Layout Primitives (planned — showing intended design)**
These don't exist in code yet but are planned in Phase 1. Show as annotated diagrams:
- `HStack` — horizontal row with gap, items labeled A/B/C
- `VStack` — vertical column with gap
- `Panel` — box with border, background, padding callouts
- `Card` — Panel with shadow
- `Spacer` — greyed-out flex-fill between two items

Add a note: "Planned in US-427 — shown here for design review."

**6.7 Dropdown / ComboSelect**
Show the closed state (input-like with chevron icon) and the open dropdown list below (3-4 items, one highlighted).

**6.8 SwitchButtons**
Segmented control: 3 options, one active.

**6.9 Popup Menu**
A context menu specimen: 5 items, one separator, one item with sub-arrow, one disabled item. Positioned with shadow.

**6.10 Tooltip**
A button with a tooltip shown above it.

**6.11 Circular Progress / Spinner**
Three sizes: small (16px), medium (24px), large (32px). Use CSS animation `@keyframes spin`.

### Step 3 — `/design/mockup-main-window.html`

A pixel-close mockup of Persephone's main window at ~1280×800.

Layout structure (from top to bottom):
1. **Title bar** (`height: 30px`, `bg-dark`): app icon (16px square placeholder), "Persephone" title text, traffic-light buttons placeholder on right
2. **Tab bar** (`height: 34px`, `bg-dark`, `border-bottom: 1px solid bg-light`): 5 tabs — 2 inactive, 1 active (bg-default, bottom border accent blue), 1 with unsaved dot, 1 with close button hovered. Add "+" new tab button at right.
3. **Main area** (flex row, fills remaining height):
   - **Icon sidebar** (`width: 36px`, `bg-dark`, flex column): 5-6 icon buttons (SVG placeholders 16px), one active (accent color), tooltips implied
   - **Sidebar panel** (`width: 220px`, `bg-dark`, `border-right: border-default`): panel header (title "Links" + 2 icon buttons), tree of link groups (3 groups, one expanded with 4 children, one item selected)
   - **Editor area** (flex: 1, `bg-default`): Monaco editor placeholder — line numbers column (light text), 12-15 lines of fake code text with syntax coloring (keywords blue/teal, strings yellow-brown, comments grey), current line highlight, cursor blink placeholder
4. **Status bar** (`height: 22px`, `bg-dark`, `border-top: border-default`): left: file name + language; right: line/col indicator, encoding "UTF-8", theme name

Use `position: relative` for the whole container so the mockup looks like a real window.

### Step 4 — `/design/mockup-dialog.html`

Shows the overlay + dialog pattern. Use the "Open URL" dialog as the reference case.

Structure:
- Full-page dark overlay background (`bg-overlay` = rgba(0,0,0,0.6))
- Centered dialog box (`width: 480px`, `bg-default`, `radius-xl`, `box-shadow: overlay elevation`):
  - Header row: title "Open URL" + close (×) icon button
  - Body: 
    - TextField with label "URL" (wide, full width), placeholder "https://..."
    - TextField with label "Title" (optional)
    - Two Checkbox rows: "Open in grouped view" / "Use cache"
  - Footer (right-aligned): Cancel button (flat) + OK button (raised)
- Add a small note below the dialog: "bg-overlay · radius-xl · elevation-overlay"

### Step 5 — Verify all files

- Open each in a browser, confirm no external resource loads
- Confirm color values visually match the existing Persephone dark theme
- Confirm all component states are visible as static specimens

## Concerns / Open Questions

1. **Icon representation** — Real Persephone icons are SVG components from `../../theme/icons`. For the HTML prototype, use inline SVG placeholders or Unicode characters (✓ □ › ×). Exact icon shapes don't need to match — the goal is component anatomy, not pixel-perfect icons.
2. **Screen mockup fidelity** — The mockup should feel like Persephone, not be a perfect pixel replica. Focus on proportions, spacing, and color — not exact text rendering.
3. **Light theme variant** — Not in scope for US-437. The design system uses default-dark only. Light theme adaptation is a follow-up concern.
4. **Component patterns discussion** — After reviewing the HTML files, there will be a design discussion session about component API patterns, composition approaches, and best practices from other libraries. The HTML prototype is a starting point, not a final decision.

## Acceptance Criteria

- [ ] `/design/design-system.html` opens in browser with no network requests
- [ ] All color swatches use the exact hex values from `default-dark.ts`
- [ ] All 11 component groups are shown with all states (no state requires hovering to see)
- [ ] Layout primitives section exists, clearly labeled as "planned"
- [ ] `/design/mockup-main-window.html` shows recognizable Persephone UI: tabs, sidebar tree, editor lines, status bar
- [ ] `/design/mockup-dialog.html` shows overlay + dialog with form fields and button row
- [ ] All HTML files are self-contained (zero external dependencies)

## Files Changed

| File | Action |
|------|--------|
| `/design/design-system.html` | Create |
| `/design/mockup-main-window.html` | Create |
| `/design/mockup-dialog.html` | Create |

No existing source files are modified by this task.
