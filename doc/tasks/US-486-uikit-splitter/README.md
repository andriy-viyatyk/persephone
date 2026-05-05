# US-486: UIKit Splitter — resizable divider primitive

**Epic:** [EPIC-025](../../epics/EPIC-025.md) — Phase 4 (layout infrastructure)

**Status:** Plan ready — awaiting user review.

---

## Goal

Add a `Splitter` primitive to the UIKit (`src/renderer/uikit/Splitter/`) that follows UIKit
authoring rules and replaces the legacy `src/renderer/components/layout/Splitter.tsx`. The
new primitive provides a draggable divider for resizable layouts (sidebars, bottom panels)
with a single, predictable prop surface and the data-attribute styling pattern that all
other UIKit primitives use.

**Out of scope:** migrating any of the 14 current `Splitter` callers. Caller migrations
happen in their respective per-screen tasks (US-465, US-460, US-478, etc.) once the new
primitive is available. The legacy Splitter at `components/layout/Splitter.tsx` stays in
place until its last caller has migrated.

---

## Background

### Current Splitter (legacy)

`src/renderer/components/layout/Splitter.tsx` (107 LoC) is a small but widely-used
component:

- 14 callers across editors and chrome (`Pages.tsx`, `LinkEditor`, `RestClientEditor`,
  `NotebookEditor`, `MenuBar`, `BookmarksDrawer`, all 3 MCP-inspector panels,
  `BrowserEditorView`, `ScriptPanel`, `TodoEditor`, `LinkTagsSecondaryEditor`).
- Drag implementation uses Pointer Events with `setPointerCapture` — modern, robust, no
  global listeners. The new primitive will reuse this approach unchanged.
- Visual: 6px thick, `color.background.default` background, `color.background.light` on
  hover, with a 1px border on one side.

### API quirks worth correcting

The legacy API splits the same concept across orientation-dependent prop pairs:

| Concept | Legacy | Why it's awkward |
|---|---|---|
| Direction | `type: "vertical" \| "horizontal"` | UIKit uses `orientation` everywhere else (Divider, RadioGroup) |
| Current size | `initialWidth` *or* `initialHeight` | Two props, only one used per orientation; "initial" misleads — it's read every drag |
| Size handler | `onChangeWidth` *or* `onChangeHeight` | Same pairing issue |
| Drag direction | `borderSized: "right" \| "left" \| "top" \| "bottom"` | Mixes vertical and horizontal vocabularies in one enum |

Caller pattern across all 14 callsites: pass current panel size as `initialWidth`/
`initialHeight`, receive new panel size in `onChangeWidth`/`onChangeHeight` continuously
during drag. None use clamping (`min`/`max`); each caller does its own `Math.max(120, w)` if
needed.

### UIKit conventions to follow

- **Naming** — `orientation` (not `type`), `value`/`onChange` for the primary scalar value
  (matches Input, Checkbox), `disabled` (not `isDisabled`), boolean adjectives.
- **Rule 1 — `data-*` for state:** `data-type="splitter"`, `data-orientation`, `data-side`,
  `data-disabled`, `data-dragging`. Pass `undefined` (not `false`) for absent boolean attrs.
- **Rule 2 — controlled:** `value`/`onChange` only; no internal state for the size. Internal
  `isDragging` is allowed (visual-only feedback per Rule 2 exceptions).
- **Rule 7 — type-level forbid `style`/`className`:** the `Props` interface extends
  `Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className">`. One legacy caller in
  chrome (`BrowserEditorView.tsx`) passes `style={{ left: tabsPanelWidth }}` for absolute
  positioning — that caller will wrap the splitter in a positioned `<div>` when it migrates.
  No new escape hatch needed.
- **Tokens:** colors from `color.ts`; thickness stays a hard-coded `6` (no token in scale —
  not worth adding a single-purpose token). Hover/border color from `color.background.light`.

### Reference primitives

- `uikit/Divider/Divider.tsx` — closest visual sibling. Uses `orientation` prop, single
  styled root, `role="separator"`, `aria-orientation`. The new Splitter is essentially a
  Divider that is also interactive.
- `uikit/Spinner/Spinner.story.tsx` — minimal story shape (id, name, section, component,
  props array).

---

## Files Changed

| Path | Change | Notes |
|---|---|---|
| `src/renderer/uikit/Splitter/Splitter.tsx` | **Create** | View component (no model needed — well under thresholds) |
| `src/renderer/uikit/Splitter/Splitter.story.tsx` | **Create** | Storybook entry |
| `src/renderer/uikit/Splitter/index.ts` | **Create** | Re-exports |
| `src/renderer/uikit/index.ts` | Modify | Add `Splitter` to UIKit barrel exports under "Layout primitives" |
| `src/renderer/editors/storybook/storyRegistry.ts` | Modify | Import `splitterStory`; add to `ALL_STORIES` under Layout |
| `doc/active-work.md` | Modify | Replace unlinked US-486 line with link to this README |
| `doc/tasks/US-486-uikit-splitter/README.md` | **Create** | This document |

---

## Files NOT Changed

| Path | Why not |
|---|---|
| `src/renderer/components/layout/Splitter.tsx` | Legacy stays until all 14 callers migrate (per-screen tasks). Removing it is a follow-up after the last migration. |
| The 14 caller files (`Pages.tsx`, `LinkEditor.tsx`, etc.) | Caller migration is per-screen and happens in the dedicated migration tasks already on the dashboard (US-465, US-478, etc.). Migrating them in this task would either touch them only for one line (half-migration that drags Emotion + `components/basic/*` along) or balloon scope. |

---

## Implementation plan

### Step 1 — Create `uikit/Splitter/Splitter.tsx`

Single function component. View-only — well below the model-view threshold (no useState
beyond `isDragging`, three event handlers, no useEffect).

**Prop surface:**

```ts
export interface SplitterProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className"> {
    /** Bar direction. "vertical" = vertical bar (resizes width); "horizontal" = horizontal bar (resizes height). Default: "vertical". */
    orientation?: "vertical" | "horizontal";

    /** Current size of the panel adjacent to the splitter, in px. Re-read on every drag start. */
    value: number;

    /** Called continuously during drag with the new clamped size. */
    onChange: (value: number) => void;

    /**
     * Which side of the splitter the controlled panel sits on.
     * - "before" — panel is to the left ("vertical") or above ("horizontal"); drag away from panel grows it
     * - "after"  — panel is to the right ("vertical") or below ("horizontal"); drag toward panel grows it
     * Default: "before".
     */
    side?: "before" | "after";

    /** Minimum size, in px. Drag is clamped. Default: 0. */
    min?: number;

    /** Maximum size, in px. Drag is clamped. Default: Infinity. */
    max?: number;

    /** When true, splitter cannot be dragged. */
    disabled?: boolean;

    /**
     * Where to draw the 1px border line on the splitter, or "none" to omit it.
     * For "vertical": "before" = left edge, "after" = right edge.
     * For "horizontal": "before" = top edge, "after" = bottom edge.
     * Default: "after". Choose what makes the splitter feel visually attached to the
     * intended side — drawing on the "after" edge makes the splitter read as part of the
     * panel that sits before it; drawing on "before" makes it read as part of the area
     * after it.
     */
    border?: "before" | "after" | "none";

    /** Splitter background fill. Maps to color.background.{default,light,dark,overlay}. Default: "default". */
    background?: "default" | "light" | "dark" | "overlay";

    /** Splitter background while hovered or being dragged. Same scale as `background`. Default: "light". */
    hoverBackground?: "default" | "light" | "dark" | "overlay";
}
```

**Behavior:**

- Pointer Events with `setPointerCapture` — same approach as legacy. No window listeners.
- On `pointerdown` (when not disabled): capture pointer, store start clientX/Y and `value`
  in refs, set `isDragging = true`. The captured `value` is the drag origin and is *not*
  re-read during the drag, so external changes to `value` mid-drag do not produce a jump
  (matches legacy behavior).
- On `pointermove` (only when capture is held): compute delta `d = client[XY] - start[XY]`,
  apply `sign = side === "before" ? +1 : -1`, compute `next = clamp(start + d * sign, min, max)`,
  call `onChange(next)`.
- On `pointerup` / `pointercancel` (when capture is held): release capture, set
  `isDragging = false`.
- When `disabled` is true: render the bar without pointer handlers (no cursor change either).

**Styled root:**

```ts
const Root = styled.div(
    {
        flexShrink: 0,
        flexGrow: 0,
        boxSizing: "border-box",
        backgroundColor: color.background.default,

        // Default: vertical (resizes width). 6px thickness matches legacy splitter.
        width: 6,
        cursor: "ew-resize",

        '&[data-orientation="horizontal"]': {
            width: "auto",
            height: 6,
            cursor: "ns-resize",
        },

        // Border placement — driven by data-border ("before" | "after" | "none").
        // For "vertical": "before" = left edge, "after" = right edge.
        // For "horizontal": "before" = top edge, "after" = bottom edge.
        '&[data-orientation="vertical"][data-border="before"]':   { borderLeft:   `1px solid ${color.background.light}` },
        '&[data-orientation="vertical"][data-border="after"]':    { borderRight:  `1px solid ${color.background.light}` },
        '&[data-orientation="horizontal"][data-border="before"]': { borderTop:    `1px solid ${color.background.light}` },
        '&[data-orientation="horizontal"][data-border="after"]':  { borderBottom: `1px solid ${color.background.light}` },

        "&:hover, &[data-dragging]": {
            backgroundColor: color.background.light,
        },

        "&[data-disabled]": {
            cursor: "default",
            pointerEvents: "none",
        },
    },
    { label: "Splitter" },
);
```

**Render:**

```tsx
<Root
    data-type="splitter"
    data-orientation={orientation}
    data-side={side}
    data-border={border}
    data-disabled={disabled || undefined}
    data-dragging={isDragging || undefined}
    role="separator"
    aria-orientation={orientation}
    aria-valuenow={value}
    aria-valuemin={min !== 0 ? min : undefined}
    aria-valuemax={max !== Infinity ? max : undefined}
    onPointerDown={disabled ? undefined : handlePointerDown}
    onPointerMove={disabled ? undefined : handlePointerMove}
    onPointerUp={disabled ? undefined : handlePointerUp}
    onPointerCancel={disabled ? undefined : handlePointerUp}
    {...rest}
/>
```

### Step 2 — Create `uikit/Splitter/Splitter.story.tsx`

Self-contained demo that owns the size state. The Storybook property editor doesn't drive
`value`/`onChange` directly — they belong to the controlled state internal to the demo.

```tsx
function SplitterDemo({
    orientation = "vertical",
    side = "before",
    min = 80,
    max = 400,
    disabled = false,
}: {
    orientation?: "vertical" | "horizontal";
    side?: "before" | "after";
    min?: number;
    max?: number;
    disabled?: boolean;
}) {
    const [size, setSize] = useState(200);
    // Render two Panels with the splitter between them, oriented per `orientation` and `side`.
    // Panel sizes are driven by `size` so the user sees the drag take effect immediately.
}

export const splitterStory: Story = {
    id: "splitter",
    name: "Splitter",
    section: "Layout",
    component: SplitterDemo,
    props: [
        { name: "orientation", type: "enum", options: ["vertical", "horizontal"], default: "vertical" },
        { name: "side", type: "enum", options: ["before", "after"], default: "before" },
        { name: "border", type: "enum", options: ["before", "after", "none"], default: "after" },
        { name: "min", type: "number", default: 80, min: 40, max: 200, step: 10 },
        { name: "max", type: "number", default: 400, min: 200, max: 800, step: 20 },
        { name: "disabled", type: "boolean", default: false },
    ],
};
```

### Step 3 — Create `uikit/Splitter/index.ts`

```ts
export { Splitter } from "./Splitter";
export type { SplitterProps } from "./Splitter";
```

### Step 4 — Wire UIKit barrel

In `src/renderer/uikit/index.ts`, under the "Layout primitives" block, add:

```ts
export { Splitter } from "./Splitter";
export type { SplitterProps } from "./Splitter";
```

### Step 5 — Wire storybook registry

In `src/renderer/editors/storybook/storyRegistry.ts`:

- Add import: `import { splitterStory } from "../../uikit/Splitter/Splitter.story";` under "Layout".
- Append `splitterStory` to `ALL_STORIES` in the layout group.

### Step 6 — Update dashboard

Replace line 51 of `doc/active-work.md`:

```
- [ ] US-486: UIKit Splitter — resizable divider primitive *(Phase 4 — layout infrastructure)*
```

with:

```
- [ ] [US-486: UIKit Splitter — resizable divider primitive](tasks/US-486-uikit-splitter/README.md) *(Phase 4 — layout infrastructure)*
```

### Step 7 — Lint + typecheck

`npm run lint` should pass. The Splitter file should be under ~120 LoC.

---

## Concerns / Open questions — resolved

1. **`side` enum naming.** Use `side: "before" | "after"`. ✅
2. **`min`/`max` clamping internal to the Splitter.** Include both, default `min = 0` and
   `max = Infinity`. Consumers may continue to set min/max width/height (often as
   percentages) on the resizable panel itself; the Splitter props are an optional
   additional clamp at the drag layer. ✅
3. **Keyboard support (Arrow keys to resize).** Defer. The role and aria-* attrs are in
   place so a future task can add it additively without a breaking change. ✅
4. **`onResizeStart` / `onResizeEnd`.** Drop. Persephone has no consumer that debounces
   drag persistence today; add later when a concrete consumer needs it. ✅
5. **Thickness — token vs hard-coded.** Keep hard-coded `6` (px), with a one-line comment
   near the styled root noting the value matches the legacy splitter. ✅
6. **Border placement is now caller-controlled.** New prop `border: "before" | "after" | "none"`,
   default `"after"`. Rationale: when the splitter sits adjacent to a panel, the border
   line determines whether the splitter reads as part of the panel (border on the
   "panel-far" edge) or as part of the area on the other side (border on the
   "panel-near" edge). For "vertical": "before" = left, "after" = right. For
   "horizontal": "before" = top, "after" = bottom. The legacy hard-coded `borderRight`
   (vertical) / `borderTop` (horizontal) is no longer assumed — each caller picks what
   looks right for its layout. ✅
7. **External `value` change during drag.** Drag origin is captured on `pointerdown`
   and not re-read until `pointerup` — matches legacy behavior; prevents drag jumps. ✅
8. **`role="separator"` — right ARIA role?** Yes. WAI-ARIA defines `separator` with
   `aria-orientation` and `aria-valuenow`/`min`/`max` for resizable separators. ✅
9. **`setPointerCapture` reliability in Electron/Chromium.** Proven across all 14 legacy
   callers. ✅
10. **Folder layout for a single-component primitive.** Yes — own subfolder regardless of
    complexity (consistent with `Divider`, `Spacer`, `Spinner`). ✅
11. **Migrating the 14 callers — in this task or follow-up?** Out of scope; per-screen
    migrations adopt the new primitive opportunistically. ✅
12. **`BrowserEditorView` `style={{ left: tabsPanelWidth }}`.** Migration concern, not a
    US-486 concern — flagging for the chrome migration task. ✅
13. **Removing legacy `components/layout/Splitter.tsx`.** Tracking-only — removed once the
    last caller migrates, as a standalone cleanup task or tucked onto the final migration. ✅
14. **Caller-controlled splitter colors.** `background` and `hoverBackground` props match the
    `Panel` background scale (`"default" | "light" | "dark" | "overlay"`). Defaults
    `"default"` / `"light"` reproduce the legacy look. The right values depend on the
    surrounding panel/area colors and the visual decision of which side the splitter
    belongs to (e.g., a dark adjacent panel with a default-bg area: pick `background="dark"`
    to attach the splitter visually to the panel and `hoverBackground="default"` to
    lighten on hover). Border color is intentionally not parameterized in this task —
    can be added later if a caller actually needs it. ✅

---

## Acceptance criteria

- [ ] `src/renderer/uikit/Splitter/Splitter.tsx` exists, exports `Splitter` and
      `SplitterProps`, has `data-type="splitter"` and the listed `data-*` state attributes
      on its root, and conforms to UIKit Rules 1, 2, and 7.
- [ ] `SplitterProps` extends `Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className">`.
- [ ] Drag works in Storybook for all four (orientation × side) combinations: width
      grows/shrinks correctly when `side="before"`/`"after"`; height likewise for horizontal.
- [ ] Min/max clamping works: dragging past `min` snaps at `min`, past `max` snaps at `max`.
- [ ] `disabled` prop disables drag and the cursor change.
- [ ] `border` prop draws the 1px line on the chosen edge (`"before"` / `"after"`) or omits
      it when `"none"`. Edge mapping respects orientation.
- [ ] External changes to `value` during drag do not produce a jump (drag origin is captured
      on pointerdown and held until pointerup).
- [ ] `background` and `hoverBackground` props change the splitter fill in normal and
      hover/drag states; defaults `"default"` / `"light"` reproduce legacy visuals.
- [ ] `Splitter` appears in the Storybook Layout section with editable orientation, side,
      border, background, hoverBackground, min, max, disabled props.
- [ ] `Splitter` is exported from `src/renderer/uikit/index.ts` under "Layout primitives".
- [ ] `npm run lint` passes.
- [ ] No callers of the legacy `components/layout/Splitter.tsx` are touched.
- [ ] `doc/active-work.md` line 51 links to this task document.
