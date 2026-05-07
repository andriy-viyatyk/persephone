# US-504: UIKit ghost variants + hover-reveal pattern

## Status

**Implemented — pending user smoke test in Storybook.** Bundles all UIKit primitive additions required by
[US-499 TodoEditor migration](../US-499-todoeditor-migration/README.md) into a
single primitive-only task. Ships the primitives alone — per-screen retrofit
lives in US-499. Part of [EPIC-025](../../epics/EPIC-025.md) Phase 4 — UIKit
primitive infrastructure.

## Goal

Add three additive features to UIKit primitives that recur across multiple
upcoming per-screen migrations:

1. **`variant: "default" | "ghost"`** on `Input` and `Textarea` — transparent
   chrome for in-place / inline-edit fields.
2. **`revealChildrenOnHover` on `Panel`** + **`hideUntilParentHover` on
   `Button` / `IconButton` / `Dot`** — pure-CSS parent-hover-reveals-child
   pattern (replaces ad-hoc `useState` + `onMouseEnter`/`onMouseLeave`
   plumbing in app code).

Each feature is additive — the default behavior of every existing call site is
unchanged. No app-code retrofits in this task; consumers (US-499 and beyond)
opt in.

## Background

### Why ghost variants

Several per-screen migrations need transparent input chrome that only shows
its border on focus (or hover + focus), so an input "lives inside" a list row
without boxing the row.

| Consumer | Site | Behavior |
|---|---|---|
| US-499 TodoItemView | item title field | transparent at rest, blue border on focus, dim when `item.done` |
| US-499 TodoItemView | item comment field | transparent at rest, gray border on hover, blue border on focus |
| US-499 TodoListPanel | list/tag rename inputs | transparent at rest, focus border |
| Future: NotebookEditor cell title | cell title row | same shape |
| Future: LinkEditor row description | inline description edit | same shape |

The current UIKit `Input` and `Textarea` always render
`background-color: color.background.dark` + `border: 1px solid color.border.light`. This is correct for form inputs but visually intrusive for inline-edit. A `variant="ghost"` adds the second skin without disturbing the default.

### Why parent-hover-reveals-child

Multiple list/grid surfaces fade in action buttons when the parent row is
hovered (rename / delete / drag-handle / "+ tag" / "+ comment" / row dates,
etc.). Today this is done with CSS parent `:hover .child` cascades inside
Emotion `styled.div` blocks in app code. Rule 7 forbids `styled` in app code
outside `ui/`, leaving consumers two bad options:

- **Drop hover-reveal** — clutters dense rows (settings precedent for sparse
  rows; not workable for todo items, notebook cells, etc.).
- **Track `isHovered` in React state** — works but adds 2-3 lines per row,
  re-renders on hover, and the same plumbing repeats in every consumer.

A pure-CSS solution scoped to a UIKit primitive eliminates both problems.
Tailwind's `group` / `group-hover:` is the proven precedent for this pattern.

### Component coverage check (do we have everything we need?)

**Coverage: yes — these are the additions in this task.** Below: every
UIKit-primitive change with file path.

| File | Change |
|---|---|
| `uikit/Input/Input.tsx` | + `variant?: "default" \| "ghost"` |
| `uikit/Textarea/Textarea.tsx` | + `variant?: "default" \| "ghost"` |
| `uikit/Panel/Panel.tsx` | + `revealChildrenOnHover?: boolean` |
| `uikit/Button/Button.tsx` | + `hideUntilParentHover?: boolean` |
| `uikit/IconButton/IconButton.tsx` | + `hideUntilParentHover?: boolean` |
| `uikit/Dot/Dot.tsx` | + `hideUntilParentHover?: boolean` |

`Input.story.tsx`, `Textarea.story.tsx`, `Panel.story.tsx`, `Button.story.tsx`,
`IconButton.story.tsx`, `Dot.story.tsx` each get one new story demonstrating
the new feature.

## Concerns — resolved before implementation

### C1 — `display: none` vs `opacity: 0` for hover-reveal

**Concern.** `display: none` removes the element from layout — revealing it
on hover causes a layout reflow (row jumps when the cursor enters). Existing
todo CSS uses `opacity: 0` precisely to keep layout stable.

**Resolution.** Use `opacity: 0` + `pointer-events: none` while hidden,
toggling to `opacity: 1` + `pointer-events: auto` on parent hover/focus.
Layout-stable, non-interactive when hidden, with a soft fade
(`transition: opacity 0.15s`).

### C2 — `:focus-within` for keyboard accessibility

**Concern.** `:hover` doesn't fire on touch and isn't reachable by keyboard.
Hover-revealed action buttons must also appear when something inside the
parent has keyboard focus — otherwise tab-navigation can't reach them.

**Resolution.** OR the two states in the parent's selector:

```css
[data-reveal-on-hover]:hover [data-visibility="parent-hover"],
[data-reveal-on-hover]:focus-within [data-visibility="parent-hover"] {
    opacity: 1;
    pointer-events: auto;
}
```

Now hover **and** keyboard focus reveal the children. No additional API
surface.

### C3 — CSS scope (parent's styled block, not global)

**Concern.** A `data-visibility="parent-hover"` attribute outside any
hover-reveal parent should do nothing. Putting the rule in a global
stylesheet would leak: every element with that attribute would be hidden
unconditionally.

**Resolution.** Put the entire rule inside Panel's `styled.div` block.
Emotion scopes the selector to Panel's class, so `[data-visibility="parent-hover"]` only takes effect when its ancestor Panel has
`data-reveal-on-hover`. No global stylesheet, no leakage.

### C4 — `data-visibility="parent-hover"` is the underlying mechanism; typed props are the public surface

**Concern.** Consumers writing `<IconButton data-visibility="parent-hover" />` works (TypeScript allows arbitrary `data-*` via `HTMLAttributes`), but
isn't IDE-discoverable and depends on consumers remembering a magic string.

**Resolution.** Each child UIKit primitive that may be hover-revealed
(Button, IconButton, Dot) exposes a typed boolean prop
`hideUntilParentHover?: boolean`. Internally it sets
`data-visibility={hideUntilParentHover ? "parent-hover" : undefined}` on the
root. Plain HTML elements (spans, divs) in app code can still set the
attribute directly — the typed prop is a UIKit-side ergonomic, not a
requirement.

**Why those three primitives.** They cover every hover-revealed-action site
in todo and other migrations queued so far. `Text` and `Input` are nearly
always always-visible; if a future migration needs the prop on them, add it
in that task.

### C5 — Naming consistency with existing UIKit prop surface

**Concern.** Other UIKit boolean props read as adjectives (`disabled`,
`active`, `loading`, `selected`, `bordered`). `revealChildrenOnHover` and
`hideUntilParentHover` are verbose and read as imperative phrases.

**Resolution.** Accept the verbosity in exchange for self-documentation.
Both prop names contain enough context that an AI agent (or a developer
reading JSX cold) understands intent without opening the file. The shorter
forms (`hover` / `hidden`, `groupHover` / `revealOnHover`) all sacrifice
clarity for brevity. Match the precedent of `placeholder`, `singleLine`,
`autoFocus` (descriptive names where short adjectives are ambiguous).

### C6 — Ghost variant: focus-only border vs. hover + focus border

**Concern.** Two slightly different inline-edit visuals exist in todo:

| Site | Behavior |
|---|---|
| Item title field | transparent at rest, **focus border only** (no hover border) |
| Item comment field | transparent at rest, **gray border on hover**, blue border on focus |
| List/tag rename inputs | transparent at rest, focus border |

Encoding two ghost sub-variants (e.g., `ghost-strict` / `ghost-with-hover`)
adds API surface for a marginal difference.

**Resolution.** One ghost variant with **both** hover and focus borders —
matches the comment-field behavior. The title-field today has no hover
border, but adding one is unobtrusive (border only appears when the cursor
is over the field; doesn't affect resting layout) and improves
discoverability ("oh, this is editable"). Visual delta on title field is
minor. If a future consumer needs the strict-no-hover version, it's a
follow-up.

### C7 — Ghost variant interaction with `disabled` / `readOnly`

**Concern.** Existing UIKit `Input` and `Textarea` keep the border at
`color.border.light` when `data-readonly` is set even on focus. Ghost should
follow the same convention — read-only ghost stays transparent on focus.

**Resolution.** Combine `data-variant="ghost"` and `data-readonly` selectors:

```css
&[data-variant="ghost"][data-readonly]:focus-within {
    borderColor: transparent;
}
```

Disabled keeps the existing `opacity: 0.5` on top of any variant.

### C8 — Files that need NO changes

- `src/renderer/uikit/tokens.ts` — no new tokens needed (transitions inline).
- `src/renderer/uikit/Tooltip/Tooltip.tsx` — unrelated.
- All non-listed UIKit primitives (`Checkbox`, `RadioGroup`, `Select`, `Tree`,
  `ListBox`, `Splitter`, `Menu`, `Spinner`, `Spacer`, `Divider`, `Tag`, etc.)
  — left unchanged.
- All app code — unchanged. Per-screen retrofits live in their own tasks
  (US-499, …).

## Implementation plan

### Step 1 — `Input` ghost variant

File: `src/renderer/uikit/Input/Input.tsx`

1. Add to `InputProps`:
   ```ts
   /** Visual variant. "ghost" = transparent bg + border, hover/focus borders only.
    *  Use for inline-edit fields embedded in list rows. Default: "default". */
   variant?: "default" | "ghost";
   ```
2. In the `Wrapper` styled rules, add:
   ```ts
   '&[data-variant="ghost"]': {
       backgroundColor: "transparent",
       borderColor: "transparent",
   },
   '&[data-variant="ghost"]:hover':           { borderColor: color.border.default },
   '&[data-variant="ghost"]:focus-within':    { borderColor: color.border.active  },
   '&[data-variant="ghost"][data-readonly]:focus-within': { borderColor: "transparent" },
   ```
3. Render `data-variant={variant}` on the wrapper.
4. Default-arg `variant = "default"` in the destructuring.

File: `src/renderer/uikit/Input/Input.story.tsx`

5. Add a "Ghost" story showing two inputs side-by-side: default vs. ghost on
   a list-row backdrop, with focus and hover demonstrated.

### Step 2 — `Textarea` ghost variant

File: `src/renderer/uikit/Textarea/Textarea.tsx`

Mirror Step 1 on the `Root` styled component (Textarea has a single root
element, not a wrapper + field):

1. Add `variant?: "default" | "ghost"` to `TextareaProps`.
2. Add the same four data-variant rules to `Root`'s styled definition.
3. Render `data-variant={variant}` on the contentEditable div.
4. Default-arg `variant = "default"`.

File: `src/renderer/uikit/Textarea/Textarea.story.tsx`

5. Add a "Ghost" story (single-line ghost for inline title, multi-line ghost
   for inline comment).

### Step 3 — `Panel` `revealChildrenOnHover`

File: `src/renderer/uikit/Panel/Panel.tsx`

1. Add to `PanelProps`:
   ```ts
   /** When true, descendant elements with `data-visibility="parent-hover"`
    *  (set automatically by `hideUntilParentHover` on UIKit primitives, or
    *  manually on plain HTML elements) start hidden and fade in when this
    *  Panel is hovered or contains keyboard focus. */
   revealChildrenOnHover?: boolean;
   ```
2. In Panel's styled `Root`, add three rules:
   ```ts
   '&[data-reveal-on-hover] [data-visibility="parent-hover"]': {
       opacity: 0,
       pointerEvents: "none",
       transition: "opacity 0.15s",
   },
   '&[data-reveal-on-hover]:hover [data-visibility="parent-hover"], &[data-reveal-on-hover]:focus-within [data-visibility="parent-hover"]': {
       opacity: 1,
       pointerEvents: "auto",
   },
   ```
3. Render `data-reveal-on-hover={revealChildrenOnHover || undefined}` on the
   root.

File: `src/renderer/uikit/Panel/Panel.story.tsx`

4. Add a "Hover-reveal children" story showing a list row with an action
   button that fades in on hover. Include keyboard focus demo (tab into the
   row → action button visible).

### Step 4 — `hideUntilParentHover` on Button, IconButton, Dot

For each of the three files:

- `src/renderer/uikit/Button/Button.tsx`
- `src/renderer/uikit/IconButton/IconButton.tsx`
- `src/renderer/uikit/Dot/Dot.tsx`

1. Add to the props interface:
   ```ts
   /** When true, sets `data-visibility="parent-hover"` so an ancestor Panel
    *  with `revealChildrenOnHover` keeps this element hidden until hovered or
    *  focused. */
   hideUntilParentHover?: boolean;
   ```
2. Destructure `hideUntilParentHover` and render
   `data-visibility={hideUntilParentHover ? "parent-hover" : undefined}` on
   the root element. Spread `...rest` after — consumer-set `data-visibility`
   on the same element would override, but that's acceptable (rare).

For each of the three story files, add a "Hidden until parent hover" story
that pairs the primitive with a hover-reveal Panel.

### Step 5 — Verify

1. `npx tsc --noEmit` — no errors.
2. `npm run lint` — clean.
3. Open Storybook and walk through the six new stories. For each:
   - Default behavior unchanged (existing stories still render correctly).
   - New variant / behavior works as described.
   - Keyboard-tab into a hover-reveal Panel reveals children (focus-within
     case).

## Test surface (manual smoke)

- **Input default vs ghost.** Default: dark bg, gray border, focuses to blue.
  Ghost: transparent bg + border, hovers to gray, focuses to blue.
  Read-only ghost: transparent both at rest and focus.
- **Textarea default vs ghost.** Same shape on the contentEditable root.
  Single-line ghost: Enter still suppressed; ghost chrome blends with row.
- **Panel `revealChildrenOnHover` + child `hideUntilParentHover`.** Nesting:
  `<Panel revealChildrenOnHover><Text>Row</Text><IconButton hideUntilParentHover .../></Panel>`. Child invisible at rest; hovering the
  Panel fades it in; mouse leaving fades it out; tabbing into the Panel
  (focus enters any descendant) reveals it.
- **Plain HTML descendants.** `<Panel revealChildrenOnHover><span data-visibility="parent-hover">+ Add</span></Panel>` works the same way as
  UIKit children.
- **Independence.** A `<IconButton hideUntilParentHover />` outside any
  hover-reveal Panel is fully visible (the rule is scoped to the Panel).
- **Layout stability.** The reveal/hide animation does not change row
  height — children occupy layout space at all times (only opacity changes).

## Acceptance criteria

- [x] `Input` exposes `variant: "default" | "ghost"`. Default unchanged.
- [x] `Textarea` exposes `variant: "default" | "ghost"`. Default unchanged.
- [x] `Panel` exposes `revealChildrenOnHover: boolean`. Default unchanged.
- [x] `Button`, `IconButton`, `Dot` each expose `hideUntilParentHover: boolean`. Default unchanged.
- [x] Each new prop has a Storybook story demonstrating it.
- [ ] All existing stories still render without visual regression. *(pending user smoke test)*
- [x] `npm run lint` clean (no new errors or warnings introduced; pre-existing unrelated errors in other files left untouched).
- [x] `npx tsc --noEmit` reports no new errors (pre-existing unrelated errors in other files left untouched).

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at
EPIC-025 close per the epic's deferred review model.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/uikit/Input/Input.tsx` | + `variant` prop + data-variant rules on `Wrapper` |
| `src/renderer/uikit/Input/Input.story.tsx` | + Ghost story |
| `src/renderer/uikit/Textarea/Textarea.tsx` | + `variant` prop + data-variant rules on `Root` |
| `src/renderer/uikit/Textarea/Textarea.story.tsx` | + Ghost story |
| `src/renderer/uikit/Panel/Panel.tsx` | + `revealChildrenOnHover` prop + descendant selector rules on `Root` |
| `src/renderer/uikit/Panel/Panel.story.tsx` | + Hover-reveal children story |
| `src/renderer/uikit/Button/Button.tsx` | + `hideUntilParentHover` prop + `data-visibility` attr |
| `src/renderer/uikit/Button/Button.story.tsx` | + Hidden-until-parent-hover story |
| `src/renderer/uikit/IconButton/IconButton.tsx` | + `hideUntilParentHover` prop + `data-visibility` attr |
| `src/renderer/uikit/IconButton/IconButton.story.tsx` | + Hidden-until-parent-hover story |
| `src/renderer/uikit/Dot/Dot.tsx` | + `hideUntilParentHover` prop + `data-visibility` attr |
| `src/renderer/uikit/Dot/Dot.story.tsx` | + Hidden-until-parent-hover story |

## Files NOT changed

- `src/renderer/uikit/tokens.ts` — no new tokens.
- All other UIKit primitives (`Checkbox`, `RadioGroup`, `Select`, `Tree`,
  `ListBox`, `Splitter`, `Menu`, `Spinner`, `Spacer`, `Divider`, `Tag`,
  `Tooltip`, `Popover`, etc.) — left unchanged.
- All app code — unchanged. Per-screen retrofits live in their own tasks
  (US-499 first; future migrations as needed).

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — UIKit primitive infrastructure
- Unblocks: [US-499 TodoEditor migration](../US-499-todoeditor-migration/README.md)
- Authoring rules: [`uikit/CLAUDE.md`](../../../src/renderer/uikit/CLAUDE.md)
